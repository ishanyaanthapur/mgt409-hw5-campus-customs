# Campus Customs Dashboard — Design Notes

The dashboard (`frontend/`, React + Vite + TypeScript) is a live control desk for the five-agent
team. It talks only to the Problem 7 backend at `http://localhost:8000` and never touches the
database or moves money on its own. Run it with `npm run dev` from `frontend/` (port 5173) while the
backend runs `uvicorn main:app --reload --port 8000` from `backend/`.

The style is an old-school arcade cabinet: a black screen, neon-green outlines, a pixel font for
headings, faint CRT scanlines, and small "pixel studs" in the panel corners. Body text uses a
plain, readable monospace, so the style never gets in the way of reading what the agents said.

## Layout: left to right, the way work flows

| Column | What's there | Why |
|---|---|---|
| **Left — Tickets** | One card per ticket (#101, #102, #103) with its state, requester, item, DB status, and a START / CONTINUE / RETRY button. | This is where work comes in. You pick a ticket here. |
| **Center — Agent activity** | Five agent tiles, a "who did what" summary for the selected ticket, and a live feed of messages, handoffs, and tool calls. | This is where the work happens. It's the widest column because it has the most to read. |
| **Right — Cash and approvals** | The checking balance (coin pile plus the exact number) and approval cards for every prepared payment or purchase. | This is where the human decides. Money and approvals sit side by side, so you see the balance when you approve something. |

The top bar holds the score ("TICKETS CLEARED: 2/3"), a 24-segment arcade progress bar, sound
controls, and a **NEW RUN** button. NEW RUN resets the shop's data through `POST /reset` but keeps
the audit history. Clicking a ticket card selects it, and the center column then shows only that
ticket's activity. Click it again to see all activity. Below 1100px wide, the columns stack.

## How agents are told apart

Each agent gets three cues at once, so you never have to rely on color alone:

| Agent | Pixel icon | Color | Role line |
|---|---|---|---|
| Boss | crown | neon green | Runs the desk, hands off work |
| Inventory | crate | cyan | Stock, vendors, discounts |
| Accounting | calculator | yellow | Proposes payments |
| Facilities | gear | orange | Lease & rent |
| Customer Service | speech bubble | magenta | Drafts replies (never sends) |

- **Agent tiles** show each agent's live status. A tile glows and bobs with "● WORKING" while that
  agent is inside the current run. After that it shows "✓ reported" and a count of its tool calls.
- **Feed lines** start with the agent's icon and name in its color, plus a colored left edge.
  There are different line types for each kind of event:
  - **starts** — the task the agent was handed
  - **⇒ HANDOFF ⇒** — one agent passing work to another, on a yellow-tinted line
  - **⚙ tool** — the MCP tool name, its arguments, and a short result
  - **says** — the agent's message, shortened, with a "more" link for the full markdown
  - **👤 Human approved/denied** — the decision, the approver, and whether the team resumed
- **"Who did what on #N"** gives one line per agent for the selected ticket: the tools it used
  (×count), how many handoffs it made, and the first sentences of its last report. Agents that
  weren't needed show "not involved (yet)". This makes it easy to see that the Boss only called
  the specialists each ticket needed.

All of this comes from real `output/audit_trail.json` events (`GET /events?after=<seq>`). The feed
and summaries only cover the current run (everything since the last reset).

## Ticket states

A card's state comes only from backend fields: DB `status`, live `run_state`, and the
`awaiting_approval` count. Every state has a **color, an icon, and a text label**, so color is
never the only signal:

| State | Color | Badge | When |
|---|---|---|---|
| Open | red | ● OPEN · NOT STARTED | Nobody has worked the ticket yet |
| Processing | yellow (blinking) | ◐ PROCESSING… | An agent run is live on this ticket |
| Awaiting approval | yellow | ⏳ AWAITING APPROVAL | Something is prepared and waiting on you. The card also says "N actions waiting on you → see Approvals". |
| In progress | yellow | ◔ IN PROGRESS · NOT RESOLVED | Worked on, but not finished (for example, after a denial) |
| Error | red | ⚠ ERROR | The run crashed or hit its token/request limit. The reason is shown on the card. |
| Resolved | **green** | ✓ RESOLVED | **Only** when the database says `resolved` |

Waiting for approval or hitting an error never counts as done. The backend backs this up:
`update_ticket_status` refuses `resolved` while an approval is still pending. After you approve
something, the backend automatically restarts the agent team on that ticket. The card turns yellow
again, and it only turns green once the team confirms it is finished.

## Cash: a pile of gold coins

The checking balance is shown as a heap of up to 24 gold coins in four stacks. The pile's size is
**current balance ÷ starting balance**. The starting balance is not hardcoded. It is the current
balance plus every payment that was actually executed (cash only goes out in this shop). When a
payment clears, the coins on top fade and float away one by one, so you can see where the money
went. The **exact figure** (for example `$160.00`) is always shown in large type next to the pile,
with "started $3,400.00 · paid out $3,240.00" under it. The coins show the trend at a glance, and
the number gives the exact amount. The balance refreshes right after every successful approval.

## Approvals

Every pending action gets a yellow card that pulses gently. Each card shows:

- **the kind** — PAYMENT · VENDOR INVOICE, PAYMENT · RENT, or PURCHASE · RESTOCK ORDER
- **the amount** — for restocks, this is marked "est. cost, billed later"
- **who gets paid**
- **the reason**
- **the ticket it belongs to**

You must type an approver name before you can approve. The backend rejects approvals without a
name anyway. APPROVE and DENY call `POST /pending-actions/{id}/decide`, which is the only route that
can move money. Both buttons lock while a request is running, so a double-click can't send the
decision twice. Refusals from the backend, such as insufficient funds, show up in red on that card.
A "Recent decisions" list shows what was decided and by whom. Payments read **PAID $X**. Restocks
read **ORDERED … (est. $X, not charged)** in blue, because a purchase order doesn't take cash from
checking. That keeps the list consistent with the cash panel's "paid out" total.

**Making waiting approvals hard to miss.** While anything is waiting, the dashboard escalates in
several places at once:

- **Approvals move to the top of the right column**, above cash.
- **The whole panel lights up.** Its border turns yellow with a pulsing glow, and a scrolling
  black-and-yellow hazard-stripe header reads "⚠ ACTION REQUIRED ⚠ — N items need your approval".
- **Each approval card pulses brighter**, with a thicker border.
- **A full-width alert bar flashes under the score**: "N APPROVALS WAITING ON YOU — the team can't
  finish until you decide → REVIEW NOW". Clicking it scrolls to the approvals.
- **The browser tab title changes** to "(N) ⚠ Approval needed", so you can see it from other tabs.
- **With reduced motion**, the pulsing and flashing stop. The yellow colors, glow, and stripes
  stay, so the alert is still loud without moving.

**Reminders.** Each waiting card has a **⏰ REMIND ME LATER** button with three options: **30 MIN,
1 HR, or 24 HRS**. A set reminder shows "⏰ Reminder at 9:56 AM" and can be cancelled. When it
comes due:

- **Banner:** a magenta banner appears at the top with GO TO APPROVAL (scrolls to the card and
  focuses APPROVE) and DISMISS.
- **The card itself changes:** it turns magenta, gets a "REMINDER — STILL WAITING ON YOU" tag, and
  shakes slightly. Its button becomes SNOOZE, which lets you pick a new time.
- **Sound:** an alarm-clock chime plays once.
- **System notification:** a browser notification pops up too, if you allowed notifications when
  you set the reminder.

Reminders are saved in the browser's localStorage, so they survive a page reload. They fire while
the dashboard is open, or right away the next time you open it if one came due while it was
closed. A reminder is removed automatically when its action is approved or denied, and all
reminders are cleared on NEW RUN. Each reminder also stores its action's description, so after a
reset, a reused id for a different action can never set off an old reminder.

## Sounds

All sounds are made in the browser with the Web Audio API (square, triangle, and sine "chip"
tones), so there are no audio files to load. Each agent has its own **start** cue and its own
**finish** cue, for **ten different cues** in total:

| Agent | Start (when an `agent_start` event arrives) | Finish (when an `agent_end` event arrives) |
|---|---|---|
| Boss | command beep (two quick high square beeps) | victory chirp (rising C-E-G-C arpeggio) |
| Inventory | scanner blip (two fast upward sine sweeps) | item-collected jingle (triangle G-C-E) |
| Accounting | calculator ticks (three tiny clicks) | ledger-complete chime (two-note ringing bell) |
| Facilities | mechanical click (noise burst plus a low thunk) | power-up tone (square sweep 220→880 Hz) |
| Customer Service | message bloop (a falling "bloop") | cheerful reply melody (five bouncy notes) |

There are also a few other cues:

- **Ticket pickup** — a two-note "insert coin" sound on `run_start`
- **Ka-ching** — a register rattle plus two bells. It plays **only when the decide response says
  `executed` for a payment**, never when you click and never for a restock.
- **Small extra cues** — one for an approved restock, one for a denial, one for an error, and a
  fanfare for the celebration

**Rules that stop the sounds from getting annoying:**

- **Only new events make sound.** The first event fetch when the page loads (the history) is
  silent. After that, the dashboard only asks for events newer than the last sequence number it
  saw. Reloading the page or a background refresh never replays anything.
- **No overlap or spam.** Cues go through a queue:
  - at least 160 ms between cues
  - the same cue can't repeat within 400 ms
  - a cue that's already waiting isn't added again
  - extra cues are dropped once 4 are waiting

  So a burst of 20 events still sounds like a short, clear phrase.
- **Controls:** there's a mute toggle and a volume slider, and both are saved between visits.
  Audio only starts after your first click or key press, as browsers require. Until then, a hint
  says "click anywhere to enable audio".

## Celebration

When the backend confirms that **all three** tickets are `resolved`, a popup appears with:

- **"ALL TICKETS CLEARED!"**
- falling pixel confetti
- a **dancing purple Labubu** (tall ears, toothy grin, waving arms) wearing a neon-green T-shirt
  that says **"SMALL MONSTER. BIG SERVICE."**

You can close it with the CONTINUE button, by clicking outside it, or with Esc. It plays **once
per completed run**. The run is identified by the sequence number of the latest `db_reset` event,
and that key is saved, so reloading the page or the next refresh won't show it again. After NEW
RUN, a fresh run can earn its own celebration. Any refresh that started before a reset is thrown
away, so leftover "resolved" data can't trigger a false celebration.

## Accessibility and reduced motion

- Every color-coded state also has an icon and a text label.
- Keyboard focus shows a thick yellow outline. Each ticket's title is a real button for keyboard
  selection.
- The feed uses `aria-live="polite"`, so screen readers announce new activity.
- With `prefers-reduced-motion: reduce`, all animations and transitions turn off: blinking,
  bobbing tiles, coin drops, the Labubu's dance, and confetti. Nothing is lost, because every
  state is still shown by its color, icon, and label, and the Labubu just stands still.

## Why this makes the dashboard enjoyable and easy to use

- **You can read it at a glance.** Red, yellow, and green cards, the score, and the coin pile tell
  you where things stand without reading a word. When you want detail, the feed and summaries
  have it.
- **The layout follows the work.** Tickets come in on the left, agents work in the middle, and
  decisions and money sit on the right. You never have to search for what needs your attention.
  An "AWAITING APPROVAL" card always points you to the right column.
- **Feedback matches what really happened.** Each sound is tied to a real backend event, so you
  can follow a run by ear: the Boss beeps, the Inventory scanner blips, the Accounting chime
  rings. The ka-ching only plays when money really moved. Because of that, the sounds and
  animations can be trusted instead of just being decoration.
- **It feels like a game, but it's honest.** The score, progress bar, and Labubu celebration make
  clearing tickets feel like a win. They only reward real resolution confirmed by the backend,
  which is exactly what the shop rules require.
- **It's safe by design.** The UI has no way to pay anything except the human approval route.
  Customer Service's tile reads "Drafts replies (never sends)". The "Recent decisions" list and
  the audit feed show who approved what.
