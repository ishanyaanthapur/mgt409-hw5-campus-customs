# Campus Customs — Harness

This file maps everything the AI team uses to run the shop, in this order:

1. the database tables (original and added)
2. the MCP tools
3. the five agents and their limits
4. the FastAPI routes
5. the React dashboard
6. the safety rules

Source database: `data/campus_customs.db` (seed/original — never edited directly).
Working copy for agent runs: `data/campus_customs_new.db` (reset from the seed file before every
full run, through `POST /reset` or the dashboard's NEW RUN button).

**Final run (Problem 9, 2026-10-13):** all three tickets resolved, and checking went from $3,400.00
to $160.00 (two human-approved payments totaling $3,240.00, plus one approved purchase order that
moved no cash). See `output/desk_tickets.html`, `output/resolved_tickets.json`,
`output/resolved_board.html`, and `output/audit_trail.json` events #469–#587.

# Part 1 — Database tables

## `desk`

| field | type |
|---|---|
| date_today | TEXT |
| notes | TEXT |

One row. `date_today` is the shop's simulated "today" (currently `2026-08-31`) — every overdue/due-date check (invoices, rent) must compare against this field, never the real wall-clock date. `notes` is a free-text scratchpad for the desk.

## `inventory`

| field | type |
|---|---|
| sku | TEXT |
| name | TEXT |
| size | TEXT |
| qty | INTEGER |
| location | TEXT |

One row per (sku, size) combination (e.g. the hoodie SKU has four rows, one per size S/M/L/XL). This is the stock the fulfillment agent checks before promising or shipping a customer order, and what it decrements when an order ships. `qty = 0` rows (e.g. tee size S, mug) signal items that need reordering from a vendor.

## `pricing`

| field | type |
|---|---|
| sku | TEXT |
| unit_cost | REAL |
| list_price | REAL |

One row per SKU (not per size). Gives the agents what they need to evaluate discount requests (ticket 103's bulk-discount ask) against margin, and what a reorder from a vendor should cost at `unit_cost`.

## `vendors`

| field | type |
|---|---|
| id | INTEGER |
| name | TEXT |
| specialty | TEXT |
| lead_days | INTEGER |

Three vendors, each with a `lead_days` field the agents must use to estimate when a reorder would arrive. `invoices.vendor_id` links a vendor to what it's owed — a vendor with an open unpaid invoice will not ship new stock, so the agents must check this before placing/promising a reorder.

## `leases`

| field | type |
|---|---|
| id | INTEGER |
| space_name | TEXT |
| landlord | TEXT |
| monthly_rent | REAL |
| next_due | TEXT |
| notes | TEXT |

One row, the shop's single lease (Chapel Street). `next_due` is the rent due date to compare against `desk.date_today`. `tickets.lease_id` links the rent-notice ticket (102) to this row so the agent knows which lease and amount it concerns.

## `cash_accounts`

| field | type |
|---|---|
| name | TEXT |
| balance | REAL |
| date | TEXT |

One row (`checking`, balance 3400.00). This is the single source of truth for available cash — the pay tool must check this balance before any payment and refuse if a payment would take it negative. Cash only decreases in this assignment (invoices, rent); nothing here increases it.

## `payments`

| field | type |
|---|---|
| id | INTEGER |
| kind | TEXT |
| ref_id | INTEGER |
| amount | REAL |
| account | TEXT |
| paid_at | TEXT |
| approved_by | TEXT |

Empty at the start (0 rows) — this is the ledger the pay tool must append to every time a human-approved payment goes out. `kind`/`ref_id` tie a payment back to what it paid (e.g. `kind='invoice', ref_id=501` or `kind='rent', ref_id=1`), and `approved_by` records who gave the required human approval, which matters for the grading rule that every payment needs sign-off.

## `invoices`

| field | type |
|---|---|
| id | INTEGER |
| vendor_id | INTEGER |
| amount | REAL |
| due_date | TEXT |
| status | TEXT |
| description | TEXT |

One open invoice (#501, $840 to vendor 1 "Bulldog Print Co", due 2026-08-28 — already overdue relative to `desk.date_today`). `status` moves from `open` to `paid` once a payment is recorded. This table is what ticket 101 references (`invoice_id=501`) and what blocks that vendor from shipping new product until it's paid.

## `tickets`

| field | type |
|---|---|
| id | INTEGER |
| type | TEXT |
| requester | TEXT |
| subject | TEXT |
| sku | TEXT |
| size | TEXT |
| qty | INTEGER |
| lease_id | INTEGER |
| invoice_id | INTEGER |
| status | TEXT |
| notes | TEXT |
| created_at | TEXT |

The agents' inbox — three open tickets to resolve, each exercising a different part of the schema:

- **#101 `customer_order`** — Tauhid Zaman wants 1 tee, size S. `sku`/`size`/`qty` point into `inventory` (where size-S tee stock is 0) and `invoice_id` points at invoice 501, the open unpaid invoice to the same vendor (Bulldog Print Co) that would need to reprint/reship this item — so this ticket can't resolve until that invoice is paid off, per the shop rule that a vendor won't ship while they have an unpaid invoice.
- **#102 `rent_notice`** — Elm City Properties flags rent due in 2 days. `lease_id=1` points at the `leases` row for amount ($2400) and due date; resolving this ticket means proposing/having a human approve a rent payment before `next_due`.
- **#103 `price_override`** — Yale AI Club requests a bulk discount on 20 navy hoodies, size M. `sku`/`size`/`qty` point into `inventory` (8 in stock, short by 12) and `pricing` (to evaluate what discount still clears cost), with no linked invoice/lease — this one is purely an inventory + pricing decision, possibly triggering a reorder from a vendor for the shortfall.

## Tables added by this project

The MCP server creates these on connect (`_ensure_schema`) if they're missing. It never changes an
original row. A reset copies the seed file, which doesn't have these tables, so each run starts
with them empty.

### `drafts`

| field | type |
|---|---|
| id | INTEGER |
| audience | TEXT (`customer` / `vendor`) |
| recipient | TEXT |
| subject | TEXT |
| body | TEXT |
| ticket_id | INTEGER |
| created_at | TEXT |

This is where customer and vendor messages go instead of being sent. It's the "drafts stay on the
board" shop rule in table form. Only `draft_message` writes here. Final run: draft #1 to Tauhid
Zaman (#101), and drafts #2 and #3 to the Yale AI Club (#103, where #3 replaced an outdated #2).

### `purchase_orders`

| field | type |
|---|---|
| id | INTEGER |
| vendor_id | INTEGER |
| sku | TEXT |
| qty | INTEGER |
| status | TEXT |
| ticket_id | INTEGER |
| created_at | TEXT |
| expected_arrival | TEXT |

Restock orders placed with a vendor. A row is only created when a human approves a `restock`
pending action, and `expected_arrival` = `desk.date_today` + the vendor's `lead_days`. A purchase
order does **not** move cash. Final run: PO #1, 12 × CC-HOOD-NAVY (M) from Bulldog Print Co,
ETA 2026-09-05.

### `pending_actions`

| field | type |
|---|---|
| id | INTEGER |
| action_type | TEXT (`pay_invoice` / `pay_rent` / `restock`) |
| ref_id | INTEGER (invoice id, lease id, or vendor id) |
| sku | TEXT |
| qty | INTEGER |
| amount | REAL |
| recipient | TEXT |
| description | TEXT |
| ticket_id | INTEGER |
| status | TEXT (`pending` → `approved` → `executed` / `refused`, or `denied`) |
| created_at | TEXT |
| decided_at | TEXT |
| approved_by | TEXT |
| result | TEXT (JSON of what execution did) |

This is the human-approval queue. Agents can only *add* rows (`prepare_payment` /
`prepare_restock`). Only a human decision through the API can move a row out of `pending`. The
dashboard's approval cards are built from this table. Final run: #1 $840 invoice, #2 $2,400 rent,
and #3 12-hoodie restock, all `executed` and all `approved_by` Ishanya Anthapur.

# Part 2 — MCP server

## MCP server tools (`mcp_server/server.py`)

All database reads and writes the agents (and, as of Problem 7, the FastAPI backend) make go
through this server. `drafts`, `purchase_orders`, and `pending_actions` are three tables this
project added to support it (auto-created on connect, never touching the original seed rows).
`pending_actions` (id, action_type, ref_id, sku, qty, amount, description, ticket_id, status,
created_at, decided_at, approved_by, result) is the proposal queue behind every payment/purchase
— see "Prepare → approve → execute" below.

| tool | table(s) used | ticket it helps address | why it's useful |
|---|---|---|---|
| `get_inventory_item(sku, size=None)` | reads `inventory`, `pricing` | #101, #103 | Returns live stock, location, and cost/list price for a SKU so the agent can confirm the tee (S) is at 0 qty for #101 and the hoodie (M) is at 8 of the 20 requested for #103. |
| `get_vendor_invoice_status(vendor_id=None)` | reads `vendors`, `invoices` | #101, #103 | Returns each vendor's lead time plus any open invoices and a computed `can_ship` flag, so the agent can see that Bulldog Print Co (vendor 1) has open invoice #501 and therefore cannot reship/reprint the tee for #101, or restock the hoodie for #103, until it's paid. |
| `get_financial_snapshot()` | reads `desk`, `cash_accounts`, `leases`, `invoices` | #102 | Returns today's date, the checking balance, the lease's rent amount/due date, and all invoices in one call, so the agent can see that rent (#102) is due 2026-09-02 against `desk.date_today` of 2026-08-31, and whether the $3,400 balance covers it alongside invoice #501. |
| `list_open_tickets()` | reads `tickets` | all | The Boss agent's entry point — shows which of #101/#102/#103 still need work. |
| `get_ticket(ticket_id)` | reads `tickets` | all | Lets any agent re-check a ticket's sku/size/qty, lease_id, invoice_id, and notes mid-task. |
| `evaluate_bulk_discount(sku, size, qty, requested_discount_pct=None)` | reads `inventory`, `pricing` | #103 | Computes the shortfall against stock and the lowest unit price that still clears unit cost, so the Yale AI Club's bulk-discount ask can be evaluated against real numbers instead of a guess. |
| `fulfill_or_backorder_order(ticket_id)` | reads/writes `tickets`, `inventory`; reads `vendors`, `invoices` | #101 | Ships the customer's tee from stock if possible, or reports precisely why it can't (out of stock, vendor blocked on an unpaid invoice, or just waiting out lead time). |
| `draft_message(audience, recipient, subject, body, ticket_id=None)` | writes `drafts` | #101, #103 | Lets Customer Service propose a reply to Tauhid Zaman (#101) or the Yale AI Club (#103) without ever sending anything for real. |
| `update_ticket_status(ticket_id, status, notes=None)` | reads/writes `tickets` | all | Lets any agent close out or mark pending #101, #102, or #103 with a note trail of the reasoning. |
| `prepare_payment(kind, ref_id, ticket_id=None)` | reads `invoices`/`leases`; writes `pending_actions` | #101, #102 | Lets Accounting propose paying invoice #501 or lease #1's rent, without paying anything — refuses on a duplicate pending request. |
| `prepare_restock(vendor_id, sku, qty, ticket_id=None)` | reads `vendors`, `invoices`, `pricing`; writes `pending_actions` | #103 | Lets Inventory propose a restock order for the hoodie shortfall — refuses immediately if the vendor has an open invoice. |
| `list_pending_actions(status=None)` | reads `pending_actions` | all | What the dashboard shows a human to decide on. |
| `decide_pending_action(pending_id, approved, approved_by)` | reads/writes `pending_actions`; on approval, internally reuses `pay_invoice`/`pay_rent`/`request_restock` and `update_ticket_status` | all | **The only place money moves or a purchase order is placed.** Not in any agent's tool set — only `backend/main.py` calls it, after a real human decision. |
| `reset_database()` | copies `campus_customs.db` → `campus_customs_new.db` | n/a | Lets the backend reset shop data to seed values for a fresh run without touching `output/audit_trail.json`. |

`pay_invoice`, `pay_rent`, and `request_restock` (from Problem 5) still exist and still carry their
own checks (insufficient-cash refusal, vendor-block refusal, same-day-duplicate-rent refusal) —
`decide_pending_action` calls them directly as plain functions. As of Problem 7 they are no longer
exposed to any agent; see the agent table below.

# Part 3 — Agents

## The agent team (`backend/`)

Built with PydanticAI, every agent running `gpt-6-luna` through Portkey (see
`backend/agents.py::_build_model`). Each agent has its own role-specific prompt in
`backend/prompts/`, its own filtered view of the MCP tools above (`backend/mcp_toolsets.py`), and
a shared `delegate` tool that lets it hand a task to any of the other four agents (including back
to Boss), not just down a fixed hierarchy.

| agent | prompt file | MCP tools it can call | role |
|---|---|---|---|
| **Boss** | `backend/prompts/boss.md` | `list_open_tickets`, `get_ticket`, `list_pending_actions`, `update_ticket_status` | Entry point for a ticket; decides which specialists to delegate to, in what order, and closes the ticket out once resolved (or correctly left pending — including "pending human approval"). |
| **Inventory** | `backend/prompts/inventory.md` | `get_inventory_item`, `get_vendor_invoice_status`, `evaluate_bulk_discount`, `fulfill_or_backorder_order`, `prepare_restock`, `get_ticket`, `update_ticket_status` | Stock, vendor-shipping eligibility, and discount math; fulfills orders from stock or *proposes* a restock — cannot place one itself. |
| **Accounting** | `backend/prompts/accounting.md` | `get_financial_snapshot`, `get_vendor_invoice_status`, `prepare_payment`, `get_ticket`, `update_ticket_status` | Assesses whether a payment is needed and *proposes* it — has no tool that can actually pay anything. |
| **Facilities** | `backend/prompts/facilities.md` | `get_financial_snapshot`, `get_ticket`, `update_ticket_status` | Confirms lease terms and urgency against `desk.date_today`; delegates the payment proposal to Accounting. |
| **Customer Service** | `backend/prompts/customer_service.md` | `get_ticket`, `draft_message`, `get_inventory_item`, `update_ticket_status` | Drafts (never sends) responses to customers/requesters, grounded in real stock/ticket facts. |

As of Problem 7, tool access is a **hard boundary, not just a convention**: `pay_invoice`,
`pay_rent`, `request_restock`, and `decide_pending_action` are not in *any* agent's filtered
toolset (`backend/mcp_toolsets.py`) — an agent cannot call them no matter what it's told to do.
Only `backend/main.py`, acting on a real dashboard decision, ever calls `decide_pending_action`.
This replaces Problem 5's terminal-based `request_human_approval` tool entirely (removed from
`backend/agents.py`) — approval now happens asynchronously, outside the agent conversation.

### Loop, delegation, and token limits

- **Delegation budget:** a shared, mutable `RunBudget(delegations_remaining=6)` travels with every
  delegated sub-run for one ticket (`backend/agents.py`). Once exhausted, the `delegate` tool
  refuses and logs a `limit_hit` audit event instead of looping.
- **Token/request budget:** `backend/orchestrator.py` sets `UsageLimits(request_limit=40,
  total_tokens_limit=60_000)` per ticket and passes the same `RunUsage` object through every
  delegated `agent.run()` call, so the cap is shared across the whole team, not per-agent.
  Exceeding it raises `UsageLimitExceeded`, which the orchestrator catches and logs as a
  `limit_hit` event rather than letting the run hang or error out ungracefully.

### Audit trail

Every tool call (via `process_tool_call` on the MCP toolset), delegation, agent start/end,
dashboard payment/purchase decision, database reset, and limit hit is appended as one JSON object
to `output/audit_trail.json` (`backend/audit.py`). The file is read-append-written on every event,
so prior runs — and dashboard decisions made between runs — are never deleted; it's one growing
array across the life of the project. `POST /reset` explicitly does not touch this file.

# Part 4 — API

## Backend API routes (`backend/main.py`)

Run with `uvicorn main:app --reload --port 8000` from inside `backend/`. Every route goes through
MCP (`backend/mcp_client.py` for direct calls, the agent team for ticket runs) — none of them
touch the database directly.

| method | route | purpose |
|---|---|---|
| GET | `/` | Health check — confirms the server is up. |
| GET | `/tickets` | Tickets 101, 102, and 103 with their DB status (open/pending/resolved), live `run_state` (idle/running/error), `run_error`, and `awaiting_approval` count. |
| POST | `/tickets/{ticket_id}/run` | Starts the agent team on one ticket in the background (refuses a second overlapping run); returns immediately so the dashboard can poll `/events`. |
| GET | `/events?after=-1&limit=500` | Agent-loop events newer than sequence number `after`, each tagged with its `seq` — lets the dashboard fetch only new events (and play sounds only for those). |
| GET | `/pending-actions?status=` | Prepared payments/purchases (with amount, recipient, and reason) awaiting or past human approval. |
| POST | `/pending-actions/{pending_id}/decide` | Executes a prepared payment or purchase — but only after this call supplies a human decision (`approved`, `approved_by`); refuses insufficient funds, a vendor block, or a pending action already decided. If an approved action executes but its ticket isn't resolved yet, automatically resumes the agent team on that ticket. |
| GET | `/cash` | The current checking balance, from `cash_accounts`. |
| POST | `/reset` | Resets the working database to its seed values (refused while a run is in progress); leaves `output/audit_trail.json` untouched. |

CORS allows only the Vite dev origin (`http://localhost:5173` / `http://127.0.0.1:5173`). As of
Problem 8 the API keeps one long-lived MCP connection (`backend/mcp_client.py`) instead of one per
request, since the dashboard polls every 1–2 seconds.

**Resolution rule (Problem 8):** `update_ticket_status` now refuses `resolved` while any action
for that ticket is still `pending` approval, and the Boss prompt defines resolved as: every needed
payment/restock *executed*, nothing awaiting approval, and a reply drafted to the requester. The
dashboard only turns a ticket green when the DB itself says `resolved`.

# Part 5 — Dashboard

## React dashboard (`frontend/`)

React + Vite + TypeScript. Start it with `npm run dev` from `frontend/` (port 5173) while the
backend is running. It only talks to the API above (`http://localhost:8000`), never to the
database, and it has no way to move money except the approval route. Full design rationale is in
`output/design.md`.

| Area | What it shows / does | Backend data it uses |
|---|---|---|
| **Top bar** | "TICKETS CLEARED: N/3" with an arcade progress bar, mute toggle and volume slider, and **NEW RUN** (reset; disabled while a run is live) | `GET /tickets`, `POST /reset` |
| **Approval alert** | A flashing full-width bar, plus "(N) ⚠ Approval needed" in the browser tab title, whenever anything is waiting on a human | `GET /pending-actions` |
| **Tickets (left)** | One card per ticket, with color, icon, and text: red OPEN, yellow PROCESSING / AWAITING APPROVAL / IN PROGRESS, red ERROR, green RESOLVED (only when the DB says so). Each card has START TEAM, CONTINUE, or RETRY. | `GET /tickets`, `POST /tickets/{id}/run` |
| **Agent activity (center)** | Five agent tiles (pixel icon, color, role, live WORKING status, tool-call count), a per-ticket "who did what" summary, and a live feed of messages, handoffs, tool calls, and human decisions | `GET /events?after=<seq>` (only the current run, since the last reset) |
| **Checking (right)** | A gold-coin pile that shrinks with the balance, the exact balance, and "started $X · paid out $Y" | `GET /cash`, `GET /pending-actions` |
| **Approvals (right)** | Moves to the top while anything waits, under a hazard-stripe "ACTION REQUIRED" header. Each card shows amount, recipient, reason, and ticket, with APPROVE / DENY (approver name required) and REMIND ME LATER (30 min / 1 hr / 24 hrs). Recent decisions read PAID $X or ORDERED … (not charged). | `GET /pending-actions`, `POST /pending-actions/{id}/decide` |
| **Celebration** | A dancing purple Labubu ("SMALL MONSTER. BIG SERVICE.") plus "ALL TICKETS CLEARED!", shown once per run after the backend confirms 3/3 resolved | `GET /tickets`, the `db_reset` event marks the run |
| **Sounds** | 10 agent start/finish cues, ticket pickup, and a ka-ching only after a confirmed payment. Only new events make sound, there's a queue so cues never pile up, and audio starts after your first click. | `GET /events`, the decide response |
| **Deep links** | `?ticket=101` opens with a ticket selected; `&nocelebration=1` keeps the popup closed (used for the automatic Problem 9 screenshots) | — |

# Part 6 — Safety

## Shop rules and where each is enforced

| Shop rule | Enforced by |
|---|---|
| `desk.date_today` is "today" | `get_financial_snapshot`, `fulfill_or_backorder_order`, `request_restock`, and `prepare_payment` all read `desk`. The Boss, Inventory, Accounting, and Facilities prompts say never to use the real date. |
| Vendor lead times come from `vendors` | ETAs are calculated from `vendors.lead_days` (e.g. 2026-08-31 + 5 = 2026-09-05). |
| No shipping while a vendor has an open invoice | `get_vendor_invoice_status` (`can_ship`), and `prepare_restock` / `request_restock` refuse a blocked vendor. |
| Human approval for any payment (and purchase) | Tool visibility: no agent can see `pay_*`, `request_restock`, or `decide_pending_action`. Only `POST /pending-actions/{id}/decide` with an approver name can execute. |
| Update records after payment | `pay_invoice` / `pay_rent` update `cash_accounts`, `invoices` / `leases`, and `payments`. `decide_pending_action` updates `pending_actions` and the ticket. |
| Refuse if cash is insufficient; no negative balance | `pay_invoice` / `pay_rent` check the balance before writing and refuse with no partial change. |
| Cash only goes out | No tool ever adds to `cash_accounts`. Purchase orders move no cash. |
| Reset before a full run | `POST /reset` / NEW RUN copies the seed database, refuses while a run is live, and logs a `db_reset` marker. Problem 9 was verified row by row against the seed after reset. |
| Don't email customers or call vendors | `draft_message` only writes to `drafts`. Nothing anywhere can send. |
| Only `gpt-6-luna` via Portkey | One `MODEL_NAME = "gpt-6-luna"` in `backend/agents.py`, used for every agent through the Portkey gateway. |
| Token and loop limits | A delegation budget (6 per ticket) and `UsageLimits(request_limit=40, total_tokens_limit=60_000)` shared across the whole team. Hitting either is logged as `limit_hit` and shown as ERROR on the board. |

## Safety section

- **Agents cannot approve their own payments — this is enforced by tool visibility, not just
  prompting.** `pay_invoice`, `pay_rent`, `request_restock`, and `decide_pending_action` are not
  in any agent's filtered MCP toolset (`backend/mcp_toolsets.py`). Accounting/Inventory can only
  *propose* a payment or purchase (`prepare_payment`/`prepare_restock`); only `POST
  /pending-actions/{id}/decide`, triggered by a real human via the dashboard, can execute one.
- **No negative cash, ever.** `pay_invoice`/`pay_rent` (called internally by
  `decide_pending_action`) check the checking balance before writing anything and refuse (no
  partial state change) if the payment would overdraw it — verified live via the API with an
  under-funded rent payment.
- **No duplicate execution.** `decide_pending_action` refuses outright if a pending action was
  already decided (`pending`/`approved`/`denied`/`executed`/`refused`), so retrying or double-
  clicking "approve" on the dashboard can't pay or order something twice. `pay_rent` separately
  refuses a same-day duplicate regardless of how it's invoked.
- **Customers and vendors are never contacted for real.** `draft_message` only ever writes a row
  to the `drafts` table; there is no send/email/call capability anywhere in the MCP server or the
  agent prompts, and every role prompt explicitly says so.
- **Bounded agent loops.** The shared delegation budget and shared token/request budget (above)
  mean a confused or looping conversation between agents stops on its own rather than running (or
  spending) indefinitely.
- **Every dashboard action is audited too, not just agent activity.** `POST
  /pending-actions/{id}/decide` and `POST /reset` both append a `payment_decision`/`db_reset` event
  to `output/audit_trail.json`, so a human's approvals and denials show up in the same trail as the
  agents' own actions.
- **Observed failure mode, now fixed (Problem 5):** during testing, the Boss agent once
  re-delegated an already-resolved rent payment back to Accounting "to verify," which read a
  post-payment cash balance and incorrectly reported the rent as unpaid, flipping a resolved
  ticket back to pending. Fixed two ways: the Boss prompt now explicitly says not to re-delegate a
  payment a specialist already reported as completed, and `pay_rent` independently refuses a
  same-day duplicate payment regardless of what the agents decide to do. Problem 7's prepare/
  approve/execute split also makes this class of bug less likely: agents can no longer re-trigger
  a payment at all, only ever re-propose one, and a duplicate proposal is refused outright.
- **Observed design gap, now fixed (Problem 7):** the first version of `decide_pending_action`
  marked *every* successfully executed payment's ticket "resolved," including ticket #101 right
  after only its blocking invoice was paid — before the tee had actually shipped. Fixed by making
  resolution ticket-type-aware: only a `pay_rent` action on a `rent_notice` ticket fully resolves
  it; a payment that merely unblocks a vendor, or a restock order, leaves the ticket "pending."
  (As of Problem 8, the backend then resumes the agent team on that ticket to finish the job.)
- **Nothing awaiting approval can count as done.** `update_ticket_status` refuses `resolved` while
  a ticket has any `pending` action. The dashboard only turns a card green when the DB status is
  `resolved`, never while it's awaiting approval or in an error state.
- **Observed in the final run (Problem 9):**
  - *Duplicate restock avoided.* The Inventory prompt now treats a paid reprint invoice (#501) as
    stock already on its way. In the final run, #101 was resolved without the extra $8 tee order
    seen in earlier tests.
  - *Invented approval requirement, fixed.* On #103, the Boss decided a 20% discount needed human
    approval. That rule doesn't exist, and nothing can create such an approval, so the ticket
    stalled with an empty queue. Fixed by stating in the Boss, Inventory, and Customer Service
    prompts that discounts within cost limits are the desk's decision and that only actions listed
    as `pending` can block a ticket. The backend was restarted to load the prompts, with no data
    changes.
  - *Known gap, not yet fixed.* If a human approves while that ticket's run is still in progress,
    the backend doesn't queue a follow-up run, so the operator presses CONTINUE. The fix would be
    to start one more run when the current one ends if an approval came in during it.
  - *Minor.* Agents signed drafts with invented shop names, and Inventory once wrote a
    non-standard status (`pending_approval`). A human should review drafts before they're used
    outside the board.
