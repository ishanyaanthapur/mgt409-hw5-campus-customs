from __future__ import annotations

import sys
from pathlib import Path

from fastmcp.client.transports import StdioTransport
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.tools import RunContext

from backend.models import AgentName, AuditEvent

HW5_ROOT = Path(__file__).resolve().parent.parent
SERVER_SCRIPT = HW5_ROOT / "mcp_server" / "server.py"

# Role-based tool access: each agent only *sees* the MCP tools relevant to its
# job. This is a convention enforced in-process (not a server-side ACL) — see
# the safety section of output/harness.md for why that's an acceptable
# tradeoff at this stage of the project.
TOOLS_BY_AGENT: dict[AgentName, set[str]] = {
    AgentName.BOSS: {"list_open_tickets", "get_ticket", "list_pending_actions", "update_ticket_status"},
    AgentName.INVENTORY: {
        "get_inventory_item",
        "get_vendor_invoice_status",
        "evaluate_bulk_discount",
        "fulfill_or_backorder_order",
        "prepare_restock",
        "get_ticket",
        "update_ticket_status",
    },
    AgentName.ACCOUNTING: {
        "get_financial_snapshot",
        "get_vendor_invoice_status",
        "prepare_payment",
        "get_ticket",
        "update_ticket_status",
    },
    AgentName.FACILITIES: {"get_financial_snapshot", "get_ticket", "update_ticket_status"},
    AgentName.CUSTOMER_SERVICE: {"get_ticket", "draft_message", "get_inventory_item", "update_ticket_status"},
}
# Note: pay_invoice, pay_rent, request_restock, and decide_pending_action are
# deliberately absent from every agent's tool set above. As of Problem 7,
# those only run from backend/main.py after a real human decides on a
# prepared action via the dashboard — no agent can see or call them, which
# makes "agents must not approve their own payments" a hard tool-visibility
# boundary instead of just a prompt instruction.


async def _log_tool_call(ctx: RunContext, call_tool, name: str, args: dict):
    deps = ctx.deps
    result = await call_tool(name, args)
    deps.audit.append(
        AuditEvent(
            run_id=deps.run_id,
            ticket_id=deps.ticket_id,
            agent=deps.agent_name,
            event_type="tool_call",
            detail={"tool": name, "args": args, "result": result},
        )
    )
    return result


def make_toolset(agent_name: AgentName) -> MCPToolset:
    """Build a fresh MCP connection to mcp_server/server.py, filtered to one agent's tools."""
    transport = StdioTransport(command=sys.executable, args=[str(SERVER_SCRIPT)])
    toolset = MCPToolset(transport, process_tool_call=_log_tool_call)
    allowed = TOOLS_BY_AGENT[agent_name]
    return toolset.filtered(lambda ctx, tool_def: tool_def.name in allowed)
