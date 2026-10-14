export type AgentId = "boss" | "inventory" | "accounting" | "facilities" | "customer_service";

export interface Ticket {
  id: number;
  type: "customer_order" | "rent_notice" | "price_override";
  requester: string;
  subject: string;
  sku: string | null;
  size: string | null;
  qty: number | null;
  lease_id: number | null;
  invoice_id: number | null;
  status: string;
  notes: string | null;
  created_at: string;
  run_state: "idle" | "running" | "error";
  run_error: string | null;
  awaiting_approval: number;
}

export interface AuditEvent {
  seq: number;
  run_id: string;
  ticket_id: number | null;
  timestamp: string;
  agent: AgentId | null;
  event_type:
    | "run_start"
    | "run_end"
    | "agent_start"
    | "agent_end"
    | "tool_call"
    | "delegation"
    | "payment_decision"
    | "db_reset"
    | "limit_hit"
    | "error";
  detail: Record<string, any>;
}

export interface PendingAction {
  id: number;
  action_type: "pay_invoice" | "pay_rent" | "restock";
  ref_id: number;
  sku: string | null;
  qty: number | null;
  amount: number | null;
  recipient: string | null;
  description: string;
  ticket_id: number | null;
  status: "pending" | "approved" | "denied" | "executed" | "refused";
  created_at: string;
  decided_at: string | null;
  approved_by: string | null;
  result: string | null;
}

export interface Cash {
  name: string;
  balance: number;
  date: string;
}

export interface DecideResponse {
  status: "executed" | "denied" | "refused";
  pending_id: number;
  ticket_id: number | null;
  action_type: PendingAction["action_type"];
  ticket_resolved?: boolean;
  continued: boolean;
  result?: Record<string, any>;
}

/**
 * A "remind me to approve this" timer, stored in the browser. `description`
 * guards against a reset reusing the same pending id for a different action.
 */
export interface Reminder {
  pendingId: number;
  description: string;
  ticketId: number | null;
  dueAt: number; // epoch ms
  notified?: boolean;
}

/** What a ticket card shows. Only "resolved" counts as complete. */
export type TicketVisualState = "open" | "processing" | "awaiting" | "pending" | "error" | "resolved";
