import { AGENT_ORDER } from "./agents";
import type { CueName } from "./sound";
import type { AgentId, AuditEvent, Ticket, TicketVisualState } from "./types";

/**
 * Card state from real backend fields only. Order matters: a live run or an
 * error always wins, and anything awaiting approval is never shown as done —
 * only the DB's own "resolved" status turns a card green.
 */
export function ticketVisualState(t: Ticket): TicketVisualState {
  if (t.run_state === "running") return "processing";
  if (t.run_state === "error") return "error";
  if (t.awaiting_approval > 0) return "awaiting";
  if (t.status === "resolved") return "resolved";
  if (t.status === "open") return "open";
  return "pending";
}

export const STATE_META: Record<TicketVisualState, { label: string; icon: string; tone: "red" | "yellow" | "green" }> = {
  open: { label: "OPEN · NOT STARTED", icon: "●", tone: "red" },
  processing: { label: "PROCESSING…", icon: "◐", tone: "yellow" },
  awaiting: { label: "AWAITING APPROVAL", icon: "⏳", tone: "yellow" },
  pending: { label: "IN PROGRESS · NOT RESOLVED", icon: "◔", tone: "yellow" },
  error: { label: "ERROR", icon: "⚠", tone: "red" },
  resolved: { label: "RESOLVED", icon: "✓", tone: "green" },
};

export const TICKET_TYPE_LABEL: Record<Ticket["type"], string> = {
  customer_order: "Customer order",
  rent_notice: "Rent notice",
  price_override: "Price override",
};

export interface AgentSummary {
  agent: AgentId;
  tools: Record<string, number>;
  handoffsOut: number;
  lastMessage: string | null;
  active: boolean;
}

/** What each agent did on one ticket, across every run (including continuations). */
export function summarizeTicket(events: AuditEvent[], ticketId: number): Record<AgentId, AgentSummary> {
  const out = Object.fromEntries(
    AGENT_ORDER.map((a) => [a, { agent: a, tools: {}, handoffsOut: 0, lastMessage: null, active: false }]),
  ) as Record<AgentId, AgentSummary>;

  const ticketEvents = events.filter((e) => e.ticket_id === ticketId);
  const lastRunId = [...ticketEvents].reverse().find((e) => e.event_type === "run_start")?.run_id;
  const lastRunEnded = ticketEvents.some((e) => e.run_id === lastRunId && e.event_type === "run_end");
  const openCount: Partial<Record<AgentId, number>> = {};

  for (const e of ticketEvents) {
    const agent = e.agent;
    if (!agent || !(agent in out)) continue;
    const s = out[agent];
    if (e.event_type === "tool_call") {
      const tool = String(e.detail.tool);
      s.tools[tool] = (s.tools[tool] ?? 0) + 1;
    } else if (e.event_type === "delegation") {
      s.handoffsOut += 1;
    } else if (e.event_type === "agent_end" && typeof e.detail.output === "string") {
      s.lastMessage = e.detail.output;
    }
    if (e.run_id === lastRunId && !lastRunEnded) {
      if (e.event_type === "agent_start") openCount[agent] = (openCount[agent] ?? 0) + 1;
      if (e.event_type === "agent_end") openCount[agent] = (openCount[agent] ?? 0) - 1;
    }
  }
  for (const a of AGENT_ORDER) out[a].active = (openCount[a] ?? 0) > 0;
  return out;
}

/** Map a *new* backend event to a sound cue. Payments ring only from the decide response. */
export function cueForEvent(e: AuditEvent): CueName | null {
  switch (e.event_type) {
    case "run_start":
      return "pickup";
    case "agent_start":
      return e.agent ? (`${e.agent}_start` as CueName) : null;
    case "agent_end":
      return e.agent ? (`${e.agent}_end` as CueName) : null;
    case "error":
    case "limit_hit":
      return "error";
    default:
      return null;
  }
}

export function firstSentences(text: string, max = 180): string {
  const clean = text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
