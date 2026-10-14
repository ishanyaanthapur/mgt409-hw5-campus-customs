# Campus Customs MCP Server

A FastMCP server that gives the Campus Customs agent team (see `backend/`) and the FastAPI backend
(`backend/main.py`) all of their access to shop data and shop actions. Every database read and
write — from an agent or from the API — goes through this server; there is no separate tool layer
or invented data.

**Database:** `data/campus_customs_new.db` (the working copy of the shop database; the original
seed file `data/campus_customs.db` is never written to, only copied from when resetting). On
connect, the server also creates three tables this project added — `drafts`, `purchase_orders`,
and `pending_actions` — on whichever database file it's pointed at, if they don't already exist,
so both the seed and working copies share the same schema without ever touching the original seed
rows.

This server is not run standalone for the assignment; it's launched as a subprocess per agent via
`backend/mcp_toolsets.py` (each agent only sees a role-appropriate subset of the tools below) and
per direct call via `backend/mcp_client.py` (used by the FastAPI routes that aren't agent runs).

## Tools

### Read tools

- **`get_inventory_item(sku, size=None)`** — stock level, location, unit cost, and list price for
  a SKU (optionally one size).
- **`get_vendor_invoice_status(vendor_id=None)`** — a vendor's lead time, open invoices, and a
  `can_ship` flag.
- **`get_financial_snapshot()`** — today's shop date, the checking balance, the lease, and every
  invoice.
- **`list_open_tickets()`** — every ticket still awaiting resolution.
- **`get_ticket(ticket_id)`** — the full record for one ticket.
- **`list_pending_actions(status=None)`** — prepared payments/purchases awaiting (or past) human
  approval; this is what the dashboard shows a human to decide on.

### Decision/calculation tool

- **`evaluate_bulk_discount(sku, size, qty, requested_discount_pct=None)`** — stock vs. a bulk
  order, shortfall, and the lowest unit price that still clears unit cost.

### Propose tools — available to agents, commit nothing on their own

- **`prepare_payment(kind, ref_id, ticket_id=None)`** — records a proposal (amount, recipient,
  reason) to pay an invoice (`kind="invoice"`) or a lease's rent (`kind="rent"`). Refuses if that
  invoice isn't open, rent was already paid today, or the same payment is already pending approval.
- **`prepare_restock(vendor_id, sku, qty, ticket_id=None)`** — records a proposal to order stock
  from a vendor. Refuses if that vendor has an open unpaid invoice, or the same restock is already
  pending approval.

### Execute tools — not exposed to any agent

- **`pay_invoice(invoice_id, approved_by)`** — pays an open vendor invoice from checking. Refuses
  (no state change) without a human approver, if the invoice isn't open, or if cash is
  insufficient.
- **`pay_rent(lease_id, approved_by)`** — pays a lease's monthly rent from checking and advances
  `next_due` by one month. Refuses without a human approver, if cash is insufficient, or if rent
  for that lease was already paid today (prevents an accidental double payment).
- **`request_restock(vendor_id, sku, qty, ticket_id=None)`** — places a purchase order with a
  vendor for a shortfall. Refuses if that vendor has an open unpaid invoice.
- **`decide_pending_action(pending_id, approved, approved_by)`** — approves or denies a prepared
  payment/purchase. On approval, calls `pay_invoice`/`pay_rent`/`request_restock` directly
  (reusing all of their checks) and updates the related ticket. Refuses if the pending action was
  already decided (prevents double execution). **This is the only tool that can make the first
  three tools in this section actually run** — it's called by `backend/main.py` after a real human
  decision from the dashboard, never by an agent.

### Other action tools

- **`fulfill_or_backorder_order(ticket_id)`** — ships a `customer_order` ticket from stock if
  possible (decrements inventory, resolves the ticket), or reports exactly why it can't yet
  (out of stock, vendor blocked on an unpaid invoice, or waiting out lead time).
- **`draft_message(audience, recipient, subject, body, ticket_id=None)`** — saves a customer or
  vendor message as a draft row. Never sends anything.
- **`update_ticket_status(ticket_id, status, notes=None)`** — updates a ticket's status and
  appends a note. Refuses `resolved` while any action for that ticket is still awaiting approval.
- **`reset_database()`** — copies `campus_customs.db` over `campus_customs_new.db`. Doesn't touch
  `output/audit_trail.json`.

## Shop rules these tools enforce

- `pay_invoice`, `pay_rent`, `prepare_payment`, `prepare_restock`, and `get_vendor_invoice_status`
  all key off the real `desk.date_today`/`invoices.status`, never the real calendar date or a
  guess.
- `prepare_restock`, `request_restock`, and `get_vendor_invoice_status` enforce "a vendor won't
  ship with an open invoice."
- `pay_invoice` and `pay_rent` both require a non-empty `approved_by` and refuse outright without
  one. The only caller that can ever provide one is `decide_pending_action`, driven by a real
  human decision via `POST /pending-actions/{id}/decide` in `backend/main.py` — agents cannot
  reach these tools at all (see `backend/mcp_toolsets.py`).
- `pay_invoice` and `pay_rent` never let `cash_accounts.balance` go negative.
- `decide_pending_action` refuses to act on a pending action that's already been decided, so a
  payment or purchase can't be executed twice.
- `draft_message` only ever writes a draft row — there is no email/vendor-call capability
  anywhere in this server.
