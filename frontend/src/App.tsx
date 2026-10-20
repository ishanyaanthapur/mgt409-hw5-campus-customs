import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { AgentPanel } from "./components/AgentPanel";
import { ApprovalPanel } from "./components/ApprovalPanel";
import { CashPanel } from "./components/CashPanel";
import { Celebration } from "./components/Celebration";
import { TicketCard } from "./components/TicketCard";
import { cueForEvent, money, ticketVisualState } from "./derive";
import { sound } from "./sound";
import type { AuditEvent, Cash, PendingAction, Reminder, Ticket } from "./types";

const EVENTS_POLL_MS = 1200;
const STATE_POLL_MS = 2000;
const SEGMENTS = 24;
const REMINDER_TICK_MS = 15_000;

function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => localStorage.setItem(key, JSON.stringify(value)), [key, value]);
  return [value, setValue] as const;
}

// Deep links: `?ticket=101` opens with that ticket selected; `&nocelebration=1` keeps the
// popup closed (used for automatic per-ticket screenshots of the board).
const URL_PARAMS = new URLSearchParams(window.location.search);
const INITIAL_TICKET = Number(URL_PARAMS.get("ticket")) || null;
const SUPPRESS_CELEBRATION = URL_PARAMS.has("nocelebration");

export default function App() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [cash, setCash] = useState<Cash | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(INITIAL_TICKET);
  const [offline, setOffline] = useState(false);
  const [startErrors, setStartErrors] = useState<Record<number, string>>({});
  const [showCelebration, setShowCelebration] = useState(false);

  const [approverName, setApproverName] = useLocalStorage("cc_approver", "");
  const [muted, setMuted] = useLocalStorage("cc_muted", false);
  const [volume, setVolume] = useLocalStorage("cc_volume", 0.6);
  const [celebratedRun, setCelebratedRun] = useLocalStorage<string | null>("cc_celebrated_run", null);
  const [soundReady, setSoundReady] = useState(false);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [actionsLoaded, setActionsLoaded] = useState(false);
  const [reminders, setReminders] = useLocalStorage<Record<number, Reminder>>("cc_reminders", {});
  const [now, setNow] = useState(() => Date.now());

  const lastSeq = useRef(-1);
  const initialLoadDone = useRef(false);
  const polling = useRef({ events: false, state: false });
  // Bumped on reset so a state poll that started before the reset can't repaint stale data.
  const resetEpoch = useRef(0);

  // ---- sound setup: audio only unlocks after a real user interaction ----
  useEffect(() => {
    sound.setMuted(muted);
    sound.setVolume(volume);
  }, [muted, volume]);

  useEffect(() => {
    const unlock = () => {
      sound.unlock();
      setSoundReady(true);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // ---- polling ----
  const pollEvents = useCallback(async () => {
    if (polling.current.events) return;
    polling.current.events = true;
    try {
      const fresh = await api.events(lastSeq.current);
      setOffline(false);
      if (fresh.length > 0) {
        lastSeq.current = fresh[fresh.length - 1].seq;
        // The first fetch is history — show it, but never replay its sounds.
        if (initialLoadDone.current) {
          for (const e of fresh) {
            const cue = cueForEvent(e);
            if (cue) sound.play(cue);
          }
        }
        setEvents((prev) => [...prev, ...fresh].slice(-2000));
      }
      initialLoadDone.current = true;
      setEventsLoaded(true);
    } catch {
      setOffline(true);
    } finally {
      polling.current.events = false;
    }
  }, []);

  const pollState = useCallback(async () => {
    if (polling.current.state) return;
    polling.current.state = true;
    const epoch = resetEpoch.current;
    try {
      const [t, a, c] = await Promise.all([api.tickets(), api.pendingActions(), api.cash()]);
      if (epoch !== resetEpoch.current) return;
      setTickets(t);
      setActions(a);
      setActionsLoaded(true);
      setCash(c);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      polling.current.state = false;
    }
  }, []);

  useEffect(() => {
    void pollEvents();
    void pollState();
    const e = window.setInterval(pollEvents, EVENTS_POLL_MS);
    const s = window.setInterval(pollState, STATE_POLL_MS);
    return () => {
      window.clearInterval(e);
      window.clearInterval(s);
    };
  }, [pollEvents, pollState]);

  // ---- derived ----
  const resolvedCount = tickets.filter((t) => ticketVisualState(t) === "resolved").length;
  const allResolved = tickets.length === 3 && resolvedCount === 3;
  const anyRunning = tickets.some((t) => t.run_state === "running");
  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  // A "run" is everything since the most recent shop reset; celebrate once per run,
  // and only show/summarize agent activity from the current run.
  const lastResetSeq = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) if (events[i].event_type === "db_reset") return events[i].seq;
    return -1;
  }, [events]);
  const runKey = lastResetSeq >= 0 ? `reset-${lastResetSeq}` : "initial";
  const runEvents = useMemo(() => events.filter((e) => e.seq >= lastResetSeq), [events, lastResetSeq]);

  useEffect(() => {
    if (allResolved && eventsLoaded && !SUPPRESS_CELEBRATION && celebratedRun !== runKey) {
      setCelebratedRun(runKey);
      setShowCelebration(true);
      sound.play("fanfare");
    }
  }, [allResolved, eventsLoaded, runKey, celebratedRun, setCelebratedRun]);

  // Starting balance = current balance + every payment actually executed (cash only goes out).
  const startingBalance = useMemo(() => {
    if (!cash) return null;
    const paid = actions
      .filter((a) => a.status === "executed" && a.action_type !== "restock")
      .reduce((sum, a) => sum + (a.amount ?? 0), 0);
    return cash.balance + paid;
  }, [cash, actions]);

  // ---- approval reminders (stored in this browser; they fire while the dashboard is open) ----
  const pendingActions = useMemo(() => actions.filter((a) => a.status === "pending"), [actions]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), REMINDER_TICK_MS);
    return () => window.clearInterval(t);
  }, []);

  // Drop reminders whose action was decided, or whose id now points at a different action.
  useEffect(() => {
    if (!actionsLoaded) return;
    const live = new Map(pendingActions.map((a) => [a.id, a.description]));
    const stale = Object.values(reminders).filter((r) => live.get(r.pendingId) !== r.description);
    if (stale.length === 0) return;
    setReminders((prev) => {
      const next = { ...prev };
      for (const r of stale) delete next[r.pendingId];
      return next;
    });
  }, [actionsLoaded, pendingActions, reminders, setReminders]);

  const dueReminders = useMemo(
    () =>
      pendingActions.filter((a) => {
        const r = reminders[a.id];
        return r && r.description === a.description && r.dueAt <= now;
      }),
    [pendingActions, reminders, now],
  );
  const dueReminderIds = useMemo(() => new Set(dueReminders.map((a) => a.id)), [dueReminders]);

  // Ring once per reminder when it comes due (and pop a system notification if allowed).
  useEffect(() => {
    const fresh = dueReminders.filter((a) => !reminders[a.id]?.notified);
    if (fresh.length === 0) return;
    sound.play("reminder");
    if ("Notification" in window && Notification.permission === "granted") {
      for (const a of fresh) {
        new Notification("Campus Customs: approval waiting", {
          body: `#${a.id} ${a.description} — ${money(a.amount)} to ${a.recipient ?? "?"}`,
          tag: `cc-approval-${a.id}`,
        });
      }
    }
    setReminders((prev) => {
      const next = { ...prev };
      for (const a of fresh) if (next[a.id]) next[a.id] = { ...next[a.id], notified: true };
      return next;
    });
  }, [dueReminders, reminders, setReminders]);

  // Show waiting approvals in the browser tab title too, so they're visible from other tabs.
  useEffect(() => {
    document.title =
      pendingActions.length > 0
        ? `(${pendingActions.length}) ⚠ Approval needed · Campus Customs`
        : "Campus Customs · Desk Arcade";
  }, [pendingActions.length]);

  function setReminder(action: PendingAction, minutes: number) {
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    setReminders((prev) => ({
      ...prev,
      [action.id]: {
        pendingId: action.id,
        description: action.description,
        ticketId: action.ticket_id,
        dueAt: Date.now() + minutes * 60_000,
      },
    }));
  }

  function cancelReminder(pendingId: number) {
    setReminders((prev) => {
      const next = { ...prev };
      delete next[pendingId];
      return next;
    });
  }

  function scrollToApproval(pendingId?: number) {
    const el = document.getElementById(pendingId ? `approval-${pendingId}` : "approvals");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.querySelector<HTMLButtonElement>(".btn-approve")?.focus({ preventScroll: true });
  }

  // ---- actions ----
  async function startTicket(id: number) {
    setSelectedId(id);
    setStartErrors((e) => ({ ...e, [id]: "" }));
    try {
      await api.runTicket(id);
      await pollState();
    } catch (err) {
      setStartErrors((e) => ({ ...e, [id]: (err as Error).message }));
      sound.play("error");
    }
  }

  async function decide(action: PendingAction, approved: boolean): Promise<string | null> {
    try {
      const res = await api.decide(action.id, approved, approverName.trim());
      if (res.status === "executed") {
        // Ka-ching only once the backend confirms money actually moved.
        if (res.action_type === "pay_invoice" || res.action_type === "pay_rent") sound.play("kaching");
        else sound.play("approve_purchase");
      } else if (res.status === "denied") {
        sound.play("deny");
      }
      await pollState();
      return null;
    } catch (err) {
      sound.play("error");
      await pollState();
      return (err as Error).message;
    }
  }

  async function resetShop() {
    if (!window.confirm("Reset the shop to its starting data for a fresh run? Agent history is kept.")) return;
    try {
      await api.reset();
      resetEpoch.current += 1;
      polling.current.state = false;
      setTickets([]);
      setActions([]);
      setReminders({});
      setStartErrors({});
      setShowCelebration(false);
      await pollState();
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  const filledSegments = Math.round((resolvedCount / 3) * SEGMENTS);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-title">CAMPUS CUSTOMS</span>
          <span className="brand-sub">DESK ARCADE · AI SHOP TEAM</span>
        </div>

        <div className="score" aria-label={`Tickets cleared: ${resolvedCount} of 3`}>
          <div className="score-label">
            TICKETS CLEARED: <span className="score-num">{resolvedCount}/3</span>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={3} aria-valuenow={resolvedCount}>
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <span key={i} className={`seg ${i < filledSegments ? "on" : ""}`} />
            ))}
          </div>
          <div className="score-hint">
            {allResolved ? "PERFECT RUN!" : resolvedCount === 0 ? "INSERT COIN · PICK A TICKET" : "KEEP GOING!"}
          </div>
        </div>

        <div className="controls">
          <div className="sound-controls">
            <button className="btn btn-small" onClick={() => setMuted(!muted)} aria-pressed={muted}>
              {muted ? "🔇 MUTED" : "🔊 SOUND"}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volume"
              disabled={muted}
            />
            {!soundReady && !muted && <span className="sound-hint">click anywhere to enable audio</span>}
          </div>
          <button className="btn btn-small btn-reset" onClick={resetShop} disabled={anyRunning}>
            ⟲ NEW RUN
          </button>
        </div>
      </header>

      {pendingActions.length > 0 && (
        <button className="approval-alert" onClick={() => scrollToApproval()}>
          ⚠ {pendingActions.length} {pendingActions.length === 1 ? "APPROVAL" : "APPROVALS"} WAITING ON YOU — the team
          can't finish until you decide → REVIEW NOW
        </button>
      )}

      {dueReminders.map((a) => (
        <div key={a.id} className="reminder-banner" role="alert">
          <span>
            ⏰ <strong>REMINDER:</strong> approval #{a.id} is still waiting — {a.description} ·{" "}
            <strong>{money(a.amount)}</strong> to {a.recipient ?? "—"}
            {a.ticket_id ? ` (ticket #${a.ticket_id})` : ""}
          </span>
          <span className="reminder-banner-actions">
            <button className="btn btn-small" onClick={() => scrollToApproval(a.id)}>
              GO TO APPROVAL
            </button>
            <button className="btn btn-small btn-deny" onClick={() => cancelReminder(a.id)}>
              DISMISS
            </button>
          </span>
        </div>
      ))}

      {offline && (
        <div className="offline" role="alert">
          ⚠ BACKEND OFFLINE — start it with <code>uvicorn main:app --reload --port 8000</code> in <code>backend/</code>
        </div>
      )}

      <main className="layout">
        <section className="panel tickets-panel" aria-label="Tickets">
          <h2 className="panel-title">TICKETS</h2>
          <div className="ticket-list">
            {tickets.map((t) => (
              <TicketCard
                key={t.id}
                ticket={t}
                selected={t.id === selectedId}
                onSelect={() => setSelectedId(t.id === selectedId ? null : t.id)}
                onStart={() => startTicket(t.id)}
                startError={startErrors[t.id] || null}
              />
            ))}
          </div>
          <p className="fine-print">Red = open · Yellow = working / waiting on you · Green = resolved by the backend.</p>
        </section>

        <AgentPanel events={runEvents} ticket={selected} />

        {/* Approvals jump above cash whenever something is waiting, so they're the first thing on the right. */}
        <div className={`right-col ${pendingActions.length > 0 ? "approvals-first" : ""}`}>
          <CashPanel cash={cash} startingBalance={startingBalance} />
          <ApprovalPanel
            actions={actions}
            approverName={approverName}
            onApproverName={setApproverName}
            onDecide={decide}
            reminders={reminders}
            dueReminderIds={dueReminderIds}
            onSetReminder={setReminder}
            onCancelReminder={cancelReminder}
          />
        </div>
      </main>

      {showCelebration && <Celebration onClose={() => setShowCelebration(false)} />}
    </div>
  );
}
