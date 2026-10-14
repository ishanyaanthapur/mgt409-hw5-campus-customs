import { useState } from "react";
import { money } from "../derive";
import type { PendingAction, Reminder } from "../types";

interface Props {
  actions: PendingAction[];
  approverName: string;
  onApproverName: (name: string) => void;
  onDecide: (action: PendingAction, approved: boolean) => Promise<string | null>;
  reminders: Record<number, Reminder>;
  dueReminderIds: Set<number>;
  onSetReminder: (action: PendingAction, minutes: number) => void;
  onCancelReminder: (pendingId: number) => void;
}

const KIND_LABEL: Record<PendingAction["action_type"], string> = {
  pay_invoice: "PAYMENT · VENDOR INVOICE",
  pay_rent: "PAYMENT · RENT",
  restock: "PURCHASE · RESTOCK ORDER",
};

const STATUS_TONE: Record<PendingAction["status"], string> = {
  pending: "yellow",
  approved: "yellow",
  executed: "green",
  denied: "dim",
  refused: "red",
};

export const REMINDER_OPTIONS = [
  { label: "30 MIN", minutes: 30 },
  { label: "1 HR", minutes: 60 },
  { label: "24 HRS", minutes: 24 * 60 },
];

function formatDue(dueAt: number): string {
  const d = new Date(dueAt);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

export function ApprovalPanel({
  actions,
  approverName,
  onApproverName,
  onDecide,
  reminders,
  dueReminderIds,
  onSetReminder,
  onCancelReminder,
}: Props) {
  const [busy, setBusy] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [pickerOpen, setPickerOpen] = useState<number | null>(null);

  const pending = actions.filter((a) => a.status === "pending");
  const decided = actions.filter((a) => a.status !== "pending").slice(-5).reverse();
  const needsAttention = pending.length > 0;

  async function decide(action: PendingAction, approved: boolean) {
    if (approved && !approverName.trim()) {
      setErrors((e) => ({ ...e, [action.id]: "Type your name above before approving." }));
      return;
    }
    setBusy(action.id);
    setErrors((e) => ({ ...e, [action.id]: "" }));
    const err = await onDecide(action, approved);
    if (err) setErrors((e) => ({ ...e, [action.id]: err }));
    setBusy(null);
  }

  return (
    <section
      id="approvals"
      className={`panel approval-panel ${needsAttention ? "needs-attention" : ""}`}
      aria-label="Human approvals"
    >
      {needsAttention && (
        <div className="hazard-banner" role="status">
          <span>⚠ ACTION REQUIRED ⚠</span>
          <span className="hazard-sub">
            {pending.length} {pending.length === 1 ? "item needs" : "items need"} your approval
          </span>
        </div>
      )}
      <h2 className="panel-title">
        APPROVALS {needsAttention && <span className="count-pill">{pending.length}</span>}
      </h2>
      <label className="approver">
        <span>Approver name</span>
        <input value={approverName} onChange={(e) => onApproverName(e.target.value)} placeholder="your name" />
      </label>

      {pending.length === 0 ? (
        <p className="dim empty-approvals">Nothing waiting. Agents can only propose payments — you decide here.</p>
      ) : (
        <ul className="approval-list">
          {pending.map((a) => {
            const reminder = reminders[a.id];
            const due = dueReminderIds.has(a.id);
            return (
              <li key={a.id} id={`approval-${a.id}`} className={`approval-card ${due ? "reminder-due" : ""}`}>
                {due && <div className="reminder-due-tag">⏰ REMINDER — STILL WAITING ON YOU</div>}
                <div className="approval-kind">
                  {KIND_LABEL[a.action_type]} <span className="dim">#{a.id}</span>
                </div>
                <div className="approval-amount">
                  {money(a.amount)}
                  {a.action_type === "restock" && <span className="dim small"> est. cost, billed later</span>}
                </div>
                <dl className="approval-facts">
                  <dt>To</dt>
                  <dd>{a.recipient ?? "—"}</dd>
                  <dt>Why</dt>
                  <dd>{a.description}</dd>
                  <dt>Ticket</dt>
                  <dd>{a.ticket_id ? `#${a.ticket_id}` : "—"}</dd>
                </dl>
                <div className="approval-buttons">
                  <button className="btn btn-approve" disabled={busy !== null} onClick={() => decide(a, true)}>
                    {busy === a.id ? "…" : "✓ APPROVE"}
                  </button>
                  <button className="btn btn-deny" disabled={busy !== null} onClick={() => decide(a, false)}>
                    ✕ DENY
                  </button>
                </div>

                <div className="reminder-row">
                  {reminder && !due ? (
                    <>
                      <span className="reminder-set">⏰ Reminder at {formatDue(reminder.dueAt)}</span>
                      <button className="link-btn" onClick={() => onCancelReminder(a.id)}>
                        cancel
                      </button>
                    </>
                  ) : pickerOpen === a.id ? (
                    <div className="reminder-picker" role="group" aria-label={`Remind me about approval ${a.id} in`}>
                      <span className="dim small">Remind me in:</span>
                      {REMINDER_OPTIONS.map((opt) => (
                        <button
                          key={opt.minutes}
                          className="btn btn-small btn-remind"
                          onClick={() => {
                            onSetReminder(a, opt.minutes);
                            setPickerOpen(null);
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                      <button className="link-btn" onClick={() => setPickerOpen(null)}>
                        close
                      </button>
                    </div>
                  ) : (
                    <button className="btn btn-small btn-remind" onClick={() => setPickerOpen(a.id)}>
                      ⏰ {due ? "SNOOZE" : "REMIND ME LATER"}
                    </button>
                  )}
                </div>

                {errors[a.id] && <p className="approval-error">⚠ {errors[a.id]}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {decided.length > 0 && (
        <>
          <h3 className="sub-title">RECENT DECISIONS</h3>
          <ul className="decided-list">
            {decided.map((a) => {
              // Restocks are purchase orders, not cash payments — label them so the list
              // never looks like more money left checking than actually did.
              const isOrder = a.action_type === "restock";
              const executed = a.status === "executed";
              const label = executed ? (isOrder ? "ORDERED" : "PAID") : a.status.toUpperCase();
              const tone = isOrder && executed ? "blue" : STATUS_TONE[a.status];
              return (
                <li key={a.id}>
                  <span className={`tone-text-${tone}`}>{label}</span> #{a.id}{" "}
                  {isOrder ? (
                    <>
                      {a.qty}× {a.sku} <span className="dim">(est. {money(a.amount)}, not charged)</span>
                    </>
                  ) : (
                    money(a.amount)
                  )}{" "}
                  → {a.recipient ?? "—"}
                  {a.approved_by ? <span className="dim"> · by {a.approved_by}</span> : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
