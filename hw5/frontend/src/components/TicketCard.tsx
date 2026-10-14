import { STATE_META, TICKET_TYPE_LABEL, ticketVisualState } from "../derive";
import type { Ticket } from "../types";

interface Props {
  ticket: Ticket;
  selected: boolean;
  onSelect: () => void;
  onStart: () => void;
  startError: string | null;
}

export function TicketCard({ ticket, selected, onSelect, onStart, startError }: Props) {
  const state = ticketVisualState(ticket);
  const meta = STATE_META[state];
  const item =
    ticket.sku !== null ? `${ticket.qty} × ${ticket.sku}${ticket.size ? ` (${ticket.size})` : ""}` : `Lease #${ticket.lease_id}`;

  const startLabel =
    state === "open" ? "▶ START TEAM" : state === "error" ? "↻ RETRY" : state === "pending" ? "▶ CONTINUE" : null;
  const canStart = startLabel !== null;

  return (
    <article className={`ticket-card tone-${meta.tone} ${selected ? "selected" : ""}`} onClick={onSelect}>
      <header className="ticket-head">
        <span className="ticket-id">#{ticket.id}</span>
        <span className={`state-badge tone-${meta.tone} ${state === "processing" ? "blink" : ""}`}>
          <span aria-hidden="true">{meta.icon}</span> {meta.label}
        </span>
      </header>
      <div className="ticket-type">{TICKET_TYPE_LABEL[ticket.type]}</div>
      <button
        className="ticket-subject"
        aria-pressed={selected}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        {ticket.subject}
        <span className="sr-only"> — show ticket {ticket.id} activity</span>
      </button>
      <dl className="ticket-facts">
        <dt>From</dt>
        <dd>{ticket.requester}</dd>
        <dt>Item</dt>
        <dd>{item}</dd>
        <dt>DB status</dt>
        <dd>{ticket.status}</dd>
      </dl>
      {state === "awaiting" && (
        <p className="ticket-note tone-yellow">
          {ticket.awaiting_approval} action{ticket.awaiting_approval > 1 ? "s" : ""} waiting on you → see Approvals
        </p>
      )}
      {state === "error" && ticket.run_error && <p className="ticket-note tone-red">⚠ {ticket.run_error}</p>}
      {startError && <p className="ticket-note tone-red">⚠ {startError}</p>}
      {canStart && (
        <button
          className="btn btn-start"
          onClick={(e) => {
            e.stopPropagation();
            onStart();
          }}
        >
          {startLabel}
        </button>
      )}
    </article>
  );
}
