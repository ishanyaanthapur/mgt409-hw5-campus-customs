"""FastAPI backend for Campus Customs.

Run from the backend/ folder:
    uvicorn main:app --reload --port 8000

Connects the dashboard (frontend/) to the agent team (backend/agents.py,
backend/orchestrator.py) and, for everything that isn't an agent run, directly
to the MCP server (backend/mcp_client.py) — so every piece of shop data or
shop action the API touches goes through MCP, exactly like the agents' own
access does.
"""

from __future__ import annotations

import asyncio
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Run as `uvicorn main:app` from inside backend/, so `main` loads with no
# parent package — put the project root on sys.path first so `backend.*` still resolves
# the same way it does for backend/run.py and the agent code itself.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.audit import AuditLog
from backend.mcp_client import call_mcp, mcp_connection
from backend.models import AuditEvent
from backend.orchestrator import resolve_ticket


@asynccontextmanager
async def lifespan(app: FastAPI):
    await mcp_connection.start()
    yield
    await mcp_connection.stop()


app = FastAPI(title="Campus Customs Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

AUDIT = AuditLog()
TICKET_IDS = (101, 102, 103)

# In-memory run state per ticket: "running", "error", or absent (idle).
# A second "run" request on a ticket already in flight is refused, so two
# agent conversations never overlap on the same ticket.
_RUN_STATE: dict[int, str] = {}
_RUN_ERROR: dict[int, str] = {}


class ApprovalDecision(BaseModel):
    approved: bool
    approved_by: str | None = None


@app.get("/")
async def root() -> dict:
    return {"status": "ok", "service": "campus-customs-backend"}


@app.get("/tickets")
async def get_tickets() -> list[dict]:
    """Tickets 101-103 with DB status, live run state, and whether anything awaits approval."""
    pending = await call_mcp("list_pending_actions", status="pending")
    awaiting: dict[int, int] = {}
    for action in pending:
        if action["ticket_id"] is not None:
            awaiting[action["ticket_id"]] = awaiting.get(action["ticket_id"], 0) + 1

    tickets = []
    for ticket_id in TICKET_IDS:
        ticket = await call_mcp("get_ticket", ticket_id=ticket_id)
        if ticket is None:
            continue
        ticket["run_state"] = _RUN_STATE.get(ticket_id, "idle")
        ticket["run_error"] = _RUN_ERROR.get(ticket_id)
        ticket["awaiting_approval"] = awaiting.get(ticket_id, 0)
        tickets.append(ticket)
    return tickets


async def _run_ticket_in_background(ticket_id: int) -> None:
    try:
        _output, outcome = await resolve_ticket(ticket_id)
        if outcome == "ok":
            _RUN_STATE.pop(ticket_id, None)
        else:
            _RUN_STATE[ticket_id] = "error"
            _RUN_ERROR[ticket_id] = "The agent team hit its token/request limit before finishing."
    except Exception as exc:  # surface any crash to the dashboard instead of losing it
        _RUN_STATE[ticket_id] = "error"
        _RUN_ERROR[ticket_id] = f"{type(exc).__name__}: {exc}"
        AUDIT.append(
            AuditEvent(run_id="backend", ticket_id=ticket_id, agent=None, event_type="error", detail={"error": _RUN_ERROR[ticket_id]})
        )


def _start_run(ticket_id: int) -> bool:
    if _RUN_STATE.get(ticket_id) == "running":
        return False
    _RUN_STATE[ticket_id] = "running"
    _RUN_ERROR.pop(ticket_id, None)
    asyncio.create_task(_run_ticket_in_background(ticket_id))
    return True


@app.post("/tickets/{ticket_id}/run")
async def run_ticket(ticket_id: int) -> dict:
    """Start the agent team on one ticket in the background; poll /events to follow it."""
    if ticket_id not in TICKET_IDS:
        raise HTTPException(status_code=404, detail=f"No ticket {ticket_id}.")
    if not _start_run(ticket_id):
        return {"status": "already_running", "ticket_id": ticket_id}
    return {"status": "started", "ticket_id": ticket_id}


@app.get("/events")
async def get_events(after: int = -1, limit: int = 500) -> list[dict]:
    """Agent-loop events newer than sequence number `after` (each tagged with `seq`)."""
    return AUDIT.since(after, limit)


@app.get("/pending-actions")
async def get_pending_actions(status: str | None = None) -> list[dict]:
    """Prepared payments/purchases awaiting (or past) human approval."""
    return await call_mcp("list_pending_actions", status=status)


@app.post("/pending-actions/{pending_id}/decide")
async def decide_pending_action(pending_id: int, decision: ApprovalDecision) -> dict:
    """Execute a prepared payment or purchase, but only after a human decides here.

    This is the only path in the whole project that can move money or place a
    restock order — no agent has this tool. The MCP tool itself still checks
    cash sufficiency and refuses duplicate/already-decided actions. If an
    approved action executes but its ticket isn't resolved yet, the agent team
    is automatically picked back up on that ticket to finish the remaining work.
    """
    result = await call_mcp(
        "decide_pending_action",
        pending_id=pending_id,
        approved=decision.approved,
        approved_by=decision.approved_by or "",
    )
    ticket_id = result.get("ticket_id")
    continued = False
    if result.get("status") == "executed" and ticket_id is not None and not result.get("ticket_resolved"):
        continued = _start_run(ticket_id)

    AUDIT.append(
        AuditEvent(
            run_id="dashboard",
            ticket_id=ticket_id,
            agent=None,
            event_type="payment_decision",
            detail={"pending_id": pending_id, "decision": decision.model_dump(), "result": result, "continued": continued},
        )
    )
    if result.get("status") == "refused":
        reason = result.get("reason") or (result.get("result") or {}).get("reason") or "Refused."
        raise HTTPException(status_code=400, detail=reason)
    return {**result, "continued": continued}


@app.get("/cash")
async def get_cash() -> dict:
    """The current checking balance, straight from cash_accounts."""
    snapshot = await call_mcp("get_financial_snapshot")
    return snapshot["cash_accounts"][0]


@app.post("/reset")
async def reset_database() -> dict:
    """Reset the working database to its seed values. Does not touch the audit trail."""
    if any(state == "running" for state in _RUN_STATE.values()):
        raise HTTPException(status_code=409, detail="Can't reset while an agent run is in progress.")
    result = await call_mcp("reset_database")
    _RUN_STATE.clear()
    _RUN_ERROR.clear()
    AUDIT.append(AuditEvent(run_id="dashboard", ticket_id=None, agent=None, event_type="db_reset", detail=result))
    return result
