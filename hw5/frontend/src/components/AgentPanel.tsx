import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AGENTS, AGENT_ORDER, agentMeta } from "../agents";
import { firstSentences, money, summarizeTicket } from "../derive";
import type { AuditEvent, Ticket } from "../types";
import { PixelIcon } from "./PixelIcon";
import { RichText } from "./RichText";

interface Props {
  events: AuditEvent[];
  ticket: Ticket | null;
}

function compact(value: unknown, max = 90): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function resultSummary(result: unknown): string {
  if (Array.isArray(result)) return `${result.length} row${result.length === 1 ? "" : "s"}`;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.status === "string") return r.reason ? `${r.status}: ${compact(r.reason, 70)}` : r.status;
    return compact(r, 70);
  }
  return compact(result, 70);
}

function FeedLine({ e }: { e: AuditEvent }) {
  const [open, setOpen] = useState(false);
  const meta = agentMeta(e.agent);
  const time = new Date(e.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const who = meta ? (
    <span className="feed-agent" style={{ color: meta.color }}>
      <PixelIcon grid={meta.icon} color={meta.color} size={14} /> {meta.label}
    </span>
  ) : null;

  let kind = "";
  let body: ReactNode = null;
  switch (e.event_type) {
    case "run_start":
      kind = "system";
      body = <>▶ Ticket #{e.ticket_id} picked up — agent team starting</>;
      break;
    case "run_end":
      kind = e.detail.outcome === "limit_hit" ? "bad" : "system";
      body = <>■ Run finished{e.detail.outcome === "limit_hit" ? " — stopped by token/request limit" : ""}</>;
      break;
    case "agent_start":
      kind = "start";
      body = (
        <>
          {who} <span className="dim">starts</span>
          {e.detail.task ? <>: {compact(e.detail.task, 160)}</> : null}
        </>
      );
      break;
    case "delegation": {
      const to = agentMeta(e.detail.to_agent);
      kind = "handoff";
      body = (
        <>
          {who} <span className="handoff-arrow">⇒ HANDOFF ⇒</span>{" "}
          <span style={{ color: to?.color }}>{to?.label ?? e.detail.to_agent}</span>: {compact(e.detail.task, 160)}
        </>
      );
      break;
    }
    case "tool_call":
      kind = "tool";
      body = (
        <>
          {who} <span className="tool-name">⚙ {e.detail.tool}</span>
          <span className="dim">({compact(e.detail.args, 60)})</span> → {resultSummary(e.detail.result)}
        </>
      );
      break;
    case "agent_end": {
      kind = "message";
      const text = String(e.detail.output ?? "");
      body = (
        <>
          {who} <span className="dim">says:</span>
          {open ? <RichText text={text} /> : <span> {firstSentences(text, 200)}</span>}
          {text.length > 200 && (
            <button className="link-btn" onClick={() => setOpen(!open)}>
              {open ? "less" : "more"}
            </button>
          )}
        </>
      );
      break;
    }
    case "payment_decision": {
      const r = e.detail.result ?? {};
      const approved = e.detail.decision?.approved;
      kind = r.status === "executed" ? "good" : r.status === "refused" ? "bad" : "system";
      body = (
        <>
          👤 Human {approved ? "approved" : "denied"} action #{e.detail.pending_id}
          {e.detail.decision?.approved_by ? ` (${e.detail.decision.approved_by})` : ""} → <strong>{r.status}</strong>
          {r.result?.amount ? ` · ${money(r.result.amount)}` : ""}
          {r.reason ? ` · ${r.reason}` : ""}
          {e.detail.continued ? " · team resuming ticket" : ""}
        </>
      );
      break;
    }
    case "db_reset":
      kind = "system";
      body = <>⟲ Shop reset to starting values (history kept)</>;
      break;
    case "limit_hit":
      kind = "bad";
      body = (
        <>
          {who} ⚠ Limit reached: {compact(e.detail.limit)}
        </>
      );
      break;
    case "error":
      kind = "bad";
      body = <>⚠ Error: {compact(e.detail.error, 200)}</>;
      break;
  }

  return (
    <li className={`feed-line kind-${kind}`} style={meta ? { borderLeftColor: meta.color } : undefined}>
      <span className="feed-time">{time}</span>
      <div className="feed-body">{body}</div>
    </li>
  );
}

export function AgentPanel({ events, ticket }: Props) {
  const ticketId = ticket?.id ?? null;
  const summaries = useMemo(() => (ticketId === null ? null : summarizeTicket(events, ticketId)), [events, ticketId]);
  const feed = useMemo(
    () =>
      events
        .filter((e) => (ticketId === null ? true : e.ticket_id === ticketId || e.event_type === "db_reset"))
        .slice(-150),
    [events, ticketId],
  );

  const listRef = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [feed.length, ticketId]);

  return (
    <section className="panel agent-panel" aria-label="Agent activity">
      <h2 className="panel-title">
        AGENT ACTIVITY {ticket ? <span className="dim">· TICKET #{ticket.id}</span> : <span className="dim">· ALL</span>}
      </h2>

      <div className="roster">
        {AGENT_ORDER.map((id) => {
          const meta = AGENTS[id];
          const s = summaries?.[id];
          const toolCount = s ? Object.values(s.tools).reduce((a, b) => a + b, 0) : 0;
          return (
            <div key={id} className={`roster-tile ${s?.active ? "active" : ""}`} style={{ borderColor: meta.color }}>
              <PixelIcon grid={meta.icon} color={meta.color} size={30} title={meta.label} />
              <div className="roster-text">
                <div className="roster-name" style={{ color: meta.color }}>
                  {meta.label}
                </div>
                <div className="roster-role">{meta.role}</div>
                <div className="roster-status">
                  {s?.active ? <span className="blink">● WORKING</span> : s?.lastMessage ? "✓ reported" : "○ idle"}
                  {toolCount > 0 && <span className="dim"> · {toolCount} tool calls</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {ticket && summaries && (
        <div className="summaries">
          <h3 className="sub-title">WHO DID WHAT ON #{ticket.id}</h3>
          <ul>
            {AGENT_ORDER.map((id) => {
              const s = summaries[id];
              const meta = AGENTS[id];
              const tools = Object.entries(s.tools);
              if (!s.lastMessage && tools.length === 0 && s.handoffsOut === 0) {
                return (
                  <li key={id} className="summary-line dim">
                    <span style={{ color: meta.color }}>{meta.label}</span>: not involved (yet)
                  </li>
                );
              }
              return (
                <li key={id} className="summary-line">
                  <span style={{ color: meta.color }}>{meta.label}</span>
                  {tools.length > 0 && (
                    <span className="dim"> [{tools.map(([t, n]) => (n > 1 ? `${t}×${n}` : t)).join(", ")}]</span>
                  )}
                  {s.handoffsOut > 0 && <span className="dim"> · {s.handoffsOut} handoff{s.handoffsOut > 1 ? "s" : ""}</span>}
                  {s.lastMessage && <div className="summary-msg">{firstSentences(s.lastMessage, 220)}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <h3 className="sub-title">LIVE FEED</h3>
      <ol
        className="feed"
        ref={listRef}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {feed.length === 0 ? (
          <li className="feed-empty">No activity yet — pick a ticket and press START TEAM.</li>
        ) : (
          feed.map((e) => <FeedLine key={e.seq} e={e} />)
        )}
      </ol>
    </section>
  );
}
