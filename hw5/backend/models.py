from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class AgentName(StrEnum):
    BOSS = "boss"
    INVENTORY = "inventory"
    ACCOUNTING = "accounting"
    FACILITIES = "facilities"
    CUSTOMER_SERVICE = "customer_service"


ALL_AGENT_NAMES = tuple(AgentName)


class TicketRecord(BaseModel):
    """Mirrors a row of the `tickets` table."""

    id: int
    type: Literal["customer_order", "rent_notice", "price_override"]
    requester: str
    subject: str
    sku: str | None = None
    size: str | None = None
    qty: int | None = None
    lease_id: int | None = None
    invoice_id: int | None = None
    status: str
    notes: str | None = None
    created_at: str


class DelegationRequest(BaseModel):
    """What one agent hands to another via the shared `delegate` tool."""

    to_agent: AgentName
    task: str = Field(description="A clear, self-contained instruction for the receiving agent.")


class DelegationResult(BaseModel):
    to_agent: AgentName
    summary: str


AuditEventType = Literal[
    "run_start",
    "run_end",
    "agent_start",
    "agent_end",
    "tool_call",
    "delegation",
    "payment_decision",
    "db_reset",
    "limit_hit",
    "error",
]


class AuditEvent(BaseModel):
    """One line in output/audit_trail.json."""

    run_id: str
    ticket_id: int | None
    timestamp: str = Field(default_factory=lambda: datetime.now().isoformat())
    agent: AgentName | None
    event_type: AuditEventType
    detail: dict[str, Any] = Field(default_factory=dict)
