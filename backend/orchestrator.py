from __future__ import annotations

import uuid

from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.usage import RunUsage, UsageLimits

from backend.agents import AGENT_REGISTRY, RunBudget, ShopDeps
from backend.audit import AuditLog
from backend.models import AgentName, AuditEvent

# Caps for one ticket's whole agent loop, shared across every delegated sub-run
# via the same RunUsage object — this is what keeps a multi-agent chat from
# burning tokens indefinitely.
DEFAULT_USAGE_LIMITS = UsageLimits(request_limit=40, total_tokens_limit=60_000)


async def resolve_ticket(ticket_id: int, *, usage_limits: UsageLimits | None = None) -> tuple[str, str]:
    """Hand one ticket to the Boss agent and let the team work it end to end.

    Returns (output, outcome) where outcome is "ok" or "limit_hit".
    """
    run_id = uuid.uuid4().hex[:12]
    usage_limits = usage_limits or DEFAULT_USAGE_LIMITS
    audit = AuditLog()
    deps = ShopDeps(
        run_id=run_id,
        ticket_id=ticket_id,
        agent_name=AgentName.BOSS,
        audit=audit,
        budget=RunBudget(),
    )

    audit.append(AuditEvent(run_id=run_id, ticket_id=ticket_id, agent=None, event_type="run_start", detail={}))
    audit.append(
        AuditEvent(run_id=run_id, ticket_id=ticket_id, agent=AgentName.BOSS, event_type="agent_start", detail={})
    )

    prompt = (
        f"Work ticket #{ticket_id}. Start by calling get_ticket({ticket_id}) and "
        "list_pending_actions() — the ticket may already have history from an earlier run, in "
        "which case continue from where it left off. Delegate to whichever specialists you still "
        "need, and finish by updating the ticket's status."
    )

    try:
        result = await AGENT_REGISTRY[AgentName.BOSS].run(
            prompt, deps=deps, usage=RunUsage(), usage_limits=usage_limits
        )
        output = result.output
        outcome = "ok"
        audit.append(
            AuditEvent(
                run_id=run_id, ticket_id=ticket_id, agent=AgentName.BOSS, event_type="agent_end", detail={"output": output}
            )
        )
    except UsageLimitExceeded as exc:
        output = f"Stopped early: {exc}"
        outcome = "limit_hit"
        audit.append(
            AuditEvent(
                run_id=run_id,
                ticket_id=ticket_id,
                agent=AgentName.BOSS,
                event_type="limit_hit",
                detail={"limit": "usage_limits", "error": str(exc)},
            )
        )

    audit.append(
        AuditEvent(
            run_id=run_id,
            ticket_id=ticket_id,
            agent=None,
            event_type="run_end",
            detail={"output": output, "outcome": outcome},
        )
    )
    return output, outcome
