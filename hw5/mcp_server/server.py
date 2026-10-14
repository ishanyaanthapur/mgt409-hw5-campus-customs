import json
import shutil
import sqlite3
from datetime import date, timedelta
from pathlib import Path

from fastmcp import FastMCP

HW5_ROOT = Path(__file__).resolve().parent.parent
SEED_DB_PATH = HW5_ROOT / "data" / "campus_customs.db"
DB_PATH = HW5_ROOT / "data" / "campus_customs_new.db"

mcp = FastMCP("campus-customs")


def _connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    _ensure_schema(con)
    return con


def _ensure_schema(con: sqlite3.Connection) -> None:
    """Create tables this server added beyond the original seed schema, if missing.

    Runs on every connection so both campus_customs.db (seed) and
    campus_customs_new.db (working copy) end up with the same structure,
    without ever touching the original seed rows.
    """
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS drafts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            audience TEXT NOT NULL,
            recipient TEXT NOT NULL,
            subject TEXT NOT NULL,
            body TEXT NOT NULL,
            ticket_id INTEGER,
            created_at TEXT NOT NULL
        )
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS purchase_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vendor_id INTEGER NOT NULL,
            sku TEXT NOT NULL,
            qty INTEGER NOT NULL,
            status TEXT NOT NULL,
            ticket_id INTEGER,
            created_at TEXT NOT NULL,
            expected_arrival TEXT NOT NULL
        )
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS pending_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action_type TEXT NOT NULL,
            ref_id INTEGER NOT NULL,
            sku TEXT,
            qty INTEGER,
            amount REAL,
            recipient TEXT,
            description TEXT NOT NULL,
            ticket_id INTEGER,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            decided_at TEXT,
            approved_by TEXT,
            result TEXT
        )
        """
    )
    con.commit()


def _today(con: sqlite3.Connection) -> date:
    return date.fromisoformat(con.execute("SELECT date_today FROM desk").fetchone()["date_today"])


def _add_months(d: date, months: int) -> date:
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, 28)
    return date(year, month, day)


# ---------------------------------------------------------------------------
# Read tools (Problem 3 + Problem 5 additions)
# ---------------------------------------------------------------------------


@mcp.tool
def get_inventory_item(sku: str, size: str | None = None) -> list[dict]:
    """Look up stock, location, and pricing for a SKU (optionally one size).

    Reads: inventory, pricing.
    Addresses ticket 101 (is the requested tee size in stock?) and ticket 103
    (how many hoodies, size M, are on hand and what do they cost vs. list price).
    """
    con = _connect()
    try:
        query = (
            "SELECT i.sku, i.name, i.size, i.qty, i.location, "
            "p.unit_cost, p.list_price "
            "FROM inventory i JOIN pricing p ON p.sku = i.sku "
            "WHERE i.sku = ?"
        )
        params = [sku]
        if size is not None:
            query += " AND i.size = ?"
            params.append(size)
        rows = con.execute(query, params).fetchall()
        return [dict(row) for row in rows]
    finally:
        con.close()


@mcp.tool
def get_vendor_invoice_status(vendor_id: int | None = None) -> list[dict]:
    """Get a vendor's lead time and any open (unpaid) invoices owed to them.

    Reads: vendors, invoices.
    Addresses ticket 101: invoice 501 to Bulldog Print Co is open, and a vendor
    will not ship new product while an invoice of theirs is unpaid, so this
    tells the agent whether that vendor can fulfill a reprint/reorder right now.
    """
    con = _connect()
    try:
        query = "SELECT id, name, specialty, lead_days FROM vendors"
        params: list = []
        if vendor_id is not None:
            query += " WHERE id = ?"
            params.append(vendor_id)
        vendors = [dict(row) for row in con.execute(query, params).fetchall()]

        for vendor in vendors:
            invoice_rows = con.execute(
                "SELECT id, amount, due_date, status, description "
                "FROM invoices WHERE vendor_id = ? AND status = 'open'",
                (vendor["id"],),
            ).fetchall()
            vendor["open_invoices"] = [dict(row) for row in invoice_rows]
            vendor["can_ship"] = len(vendor["open_invoices"]) == 0
        return vendors
    finally:
        con.close()


@mcp.tool
def get_financial_snapshot() -> dict:
    """Get today's date, cash balance, rent status, and all open invoices.

    Reads: desk, cash_accounts, leases, invoices.
    Addresses ticket 102 (is rent due, and is there enough cash to pay it) and
    gives the shared cash/date context every payment decision needs, including
    whether invoice 501 from ticket 101 is now overdue.
    """
    con = _connect()
    try:
        today = con.execute("SELECT date_today FROM desk").fetchone()["date_today"]
        cash = dict(con.execute("SELECT name, balance, date FROM cash_accounts").fetchone())
        leases = [dict(row) for row in con.execute(
            "SELECT id, space_name, landlord, monthly_rent, next_due, notes FROM leases"
        ).fetchall()]
        invoices = [dict(row) for row in con.execute(
            "SELECT id, vendor_id, amount, due_date, status, description FROM invoices"
        ).fetchall()]
        return {
            "date_today": today,
            "cash_accounts": [cash],
            "leases": leases,
            "invoices": invoices,
        }
    finally:
        con.close()


@mcp.tool
def list_open_tickets() -> list[dict]:
    """List every ticket still awaiting resolution.

    Reads: tickets.
    This is the Boss agent's entry point for a run: it shows which of the
    three ticket types (customer_order, rent_notice, price_override) still
    need work before anything else happens.
    """
    con = _connect()
    try:
        rows = con.execute(
            "SELECT * FROM tickets WHERE status = 'open' ORDER BY id"
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        con.close()


@mcp.tool
def get_ticket(ticket_id: int) -> dict | None:
    """Get the full record for one ticket by id.

    Reads: tickets.
    Lets any agent re-check a ticket's details (sku/size/qty, lease_id,
    invoice_id, notes) while working ticket 101, 102, or 103 without
    re-fetching the whole open list.
    """
    con = _connect()
    try:
        row = con.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
        return dict(row) if row else None
    finally:
        con.close()


# ---------------------------------------------------------------------------
# Decision/calculation tool
# ---------------------------------------------------------------------------


@mcp.tool
def evaluate_bulk_discount(sku: str, size: str, qty: int, requested_discount_pct: float | None = None) -> dict:
    """Check stock against a bulk order and compute whether a discount still clears cost.

    Reads: inventory, pricing.
    Addresses ticket 103 directly: for the 20 navy hoodies (size M) the Yale AI
    Club wants, this reports how many are on hand, the shortfall, and the
    lowest price per unit that still stays at or above unit cost, so the
    agent can evaluate (or counter) the requested discount without guessing.
    """
    con = _connect()
    try:
        row = con.execute(
            "SELECT i.qty, p.unit_cost, p.list_price "
            "FROM inventory i JOIN pricing p ON p.sku = i.sku "
            "WHERE i.sku = ? AND i.size = ?",
            (sku, size),
        ).fetchone()
        if row is None:
            raise ValueError(f"No inventory row for sku={sku!r} size={size!r}")

        on_hand, unit_cost, list_price = row["qty"], row["unit_cost"], row["list_price"]
        shortfall = max(0, qty - on_hand)
        min_price_at_cost = round(unit_cost, 2)
        max_discount_pct_at_cost = round((1 - unit_cost / list_price) * 100, 2)

        result = {
            "sku": sku,
            "size": size,
            "requested_qty": qty,
            "on_hand": on_hand,
            "shortfall": shortfall,
            "unit_cost": unit_cost,
            "list_price": list_price,
            "max_discount_pct_without_selling_below_cost": max_discount_pct_at_cost,
            "min_unit_price_at_cost": min_price_at_cost,
        }
        if requested_discount_pct is not None:
            requested_unit_price = round(list_price * (1 - requested_discount_pct / 100), 2)
            result["requested_discount_pct"] = requested_discount_pct
            result["requested_unit_price"] = requested_unit_price
            result["clears_unit_cost"] = requested_unit_price >= unit_cost
        return result
    finally:
        con.close()


# ---------------------------------------------------------------------------
# Action tools (mutate campus_customs_new.db)
# ---------------------------------------------------------------------------


@mcp.tool
def pay_invoice(invoice_id: int, approved_by: str) -> dict:
    """Pay an open vendor invoice out of the checking account, if approved and affordable.

    Reads/writes: invoices, cash_accounts, payments.
    Addresses ticket 101: invoice 501 to Bulldog Print Co must be paid before
    that vendor will reprint/reship the out-of-stock tee. Refuses with no
    state change if there's no human approver or insufficient cash, and
    never leaves the cash balance negative.
    """
    if not approved_by:
        return {"status": "refused", "reason": "Human approval is required before any payment."}

    con = _connect()
    try:
        invoice = con.execute(
            "SELECT * FROM invoices WHERE id = ?", (invoice_id,)
        ).fetchone()
        if invoice is None:
            return {"status": "refused", "reason": f"No invoice with id {invoice_id}."}
        if invoice["status"] != "open":
            return {"status": "refused", "reason": f"Invoice {invoice_id} is not open (status={invoice['status']})."}

        cash = con.execute("SELECT * FROM cash_accounts WHERE name = 'checking'").fetchone()
        if cash["balance"] < invoice["amount"]:
            return {
                "status": "refused",
                "reason": f"Insufficient cash: balance {cash['balance']} < invoice amount {invoice['amount']}.",
            }

        today = _today(con).isoformat()
        new_balance = round(cash["balance"] - invoice["amount"], 2)
        con.execute("UPDATE cash_accounts SET balance = ?, date = ? WHERE name = 'checking'", (new_balance, today))
        con.execute("UPDATE invoices SET status = 'paid' WHERE id = ?", (invoice_id,))
        con.execute(
            "INSERT INTO payments (kind, ref_id, amount, account, paid_at, approved_by) "
            "VALUES ('invoice', ?, ?, 'checking', ?, ?)",
            (invoice_id, invoice["amount"], today, approved_by),
        )
        con.commit()
        return {
            "status": "paid",
            "invoice_id": invoice_id,
            "amount": invoice["amount"],
            "new_cash_balance": new_balance,
            "approved_by": approved_by,
        }
    finally:
        con.close()


@mcp.tool
def pay_rent(lease_id: int, approved_by: str) -> dict:
    """Pay a lease's monthly rent out of the checking account, if approved and affordable.

    Reads/writes: leases, cash_accounts, payments.
    Addresses ticket 102: Elm City Properties' rent notice. Refuses with no
    state change if there's no human approver or insufficient cash. On
    success, advances the lease's next_due date by one month.
    """
    if not approved_by:
        return {"status": "refused", "reason": "Human approval is required before any payment."}

    con = _connect()
    try:
        lease = con.execute("SELECT * FROM leases WHERE id = ?", (lease_id,)).fetchone()
        if lease is None:
            return {"status": "refused", "reason": f"No lease with id {lease_id}."}

        today = _today(con).isoformat()
        already_paid_today = con.execute(
            "SELECT id FROM payments WHERE kind = 'rent' AND ref_id = ? AND paid_at = ?",
            (lease_id, today),
        ).fetchone()
        if already_paid_today is not None:
            return {
                "status": "refused",
                "reason": f"Rent for lease {lease_id} was already paid today ({today}); refusing a duplicate payment.",
            }

        cash = con.execute("SELECT * FROM cash_accounts WHERE name = 'checking'").fetchone()
        if cash["balance"] < lease["monthly_rent"]:
            return {
                "status": "refused",
                "reason": f"Insufficient cash: balance {cash['balance']} < rent {lease['monthly_rent']}.",
            }

        new_balance = round(cash["balance"] - lease["monthly_rent"], 2)
        next_due = _add_months(date.fromisoformat(lease["next_due"]), 1).isoformat()
        con.execute("UPDATE cash_accounts SET balance = ?, date = ? WHERE name = 'checking'", (new_balance, today))
        con.execute("UPDATE leases SET next_due = ? WHERE id = ?", (next_due, lease_id))
        con.execute(
            "INSERT INTO payments (kind, ref_id, amount, account, paid_at, approved_by) "
            "VALUES ('rent', ?, ?, 'checking', ?, ?)",
            (lease_id, lease["monthly_rent"], today, approved_by),
        )
        con.commit()
        return {
            "status": "paid",
            "lease_id": lease_id,
            "amount": lease["monthly_rent"],
            "new_cash_balance": new_balance,
            "new_next_due": next_due,
            "approved_by": approved_by,
        }
    finally:
        con.close()


@mcp.tool
def fulfill_or_backorder_order(ticket_id: int) -> dict:
    """Try to fulfill a customer_order ticket from stock, or report why it's backordered.

    Reads/writes: tickets, inventory; reads vendors, invoices.
    Addresses ticket 101: if the requested sku/size/qty is in stock, ships it
    (decrements inventory, resolves the ticket). If not, checks the vendor
    tied to the ticket's invoice and reports whether the order is blocked on
    an unpaid invoice or just waiting out the vendor's lead time.
    """
    con = _connect()
    try:
        ticket = con.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
        if ticket is None:
            return {"status": "refused", "reason": f"No ticket with id {ticket_id}."}
        if ticket["type"] != "customer_order":
            return {"status": "refused", "reason": f"Ticket {ticket_id} is not a customer_order."}

        item = con.execute(
            "SELECT * FROM inventory WHERE sku = ? AND size = ?",
            (ticket["sku"], ticket["size"]),
        ).fetchone()
        if item is None:
            return {"status": "refused", "reason": f"No inventory row for {ticket['sku']}/{ticket['size']}."}

        if item["qty"] >= ticket["qty"]:
            new_qty = item["qty"] - ticket["qty"]
            con.execute(
                "UPDATE inventory SET qty = ? WHERE sku = ? AND size = ?",
                (new_qty, ticket["sku"], ticket["size"]),
            )
            con.execute(
                "UPDATE tickets SET status = 'resolved', notes = notes || ' | Fulfilled from stock.' WHERE id = ?",
                (ticket_id,),
            )
            con.commit()
            return {
                "status": "fulfilled",
                "ticket_id": ticket_id,
                "sku": ticket["sku"],
                "size": ticket["size"],
                "qty_shipped": ticket["qty"],
                "remaining_stock": new_qty,
            }

        vendor_info = None
        if ticket["invoice_id"] is not None:
            invoice = con.execute(
                "SELECT * FROM invoices WHERE id = ?", (ticket["invoice_id"],)
            ).fetchone()
            if invoice is not None:
                vendor = con.execute(
                    "SELECT * FROM vendors WHERE id = ?", (invoice["vendor_id"],)
                ).fetchone()
                can_ship = invoice["status"] != "open"
                expected_arrival = None
                if can_ship:
                    expected_arrival = (_today(con) + timedelta(days=vendor["lead_days"])).isoformat()
                vendor_info = {
                    "vendor_id": vendor["id"],
                    "vendor_name": vendor["name"],
                    "invoice_id": invoice["id"],
                    "invoice_status": invoice["status"],
                    "blocked_on_unpaid_invoice": invoice["status"] == "open",
                    "lead_days": vendor["lead_days"],
                    "expected_arrival": expected_arrival,
                }

        new_status = "pending_vendor"
        con.execute(
            "UPDATE tickets SET status = ? WHERE id = ?",
            (new_status, ticket_id),
        )
        con.commit()
        return {
            "status": "backordered",
            "ticket_id": ticket_id,
            "sku": ticket["sku"],
            "size": ticket["size"],
            "requested_qty": ticket["qty"],
            "on_hand": item["qty"],
            "vendor_info": vendor_info,
        }
    finally:
        con.close()


@mcp.tool
def request_restock(vendor_id: int, sku: str, qty: int, ticket_id: int | None = None) -> dict:
    """Place a restock order with a vendor, if that vendor has no open unpaid invoice.

    Reads: vendors, invoices, desk; writes: purchase_orders.
    Addresses ticket 103's shortfall (needs more navy hoodies, size M, than
    are on hand): creates a trackable purchase order with an expected arrival
    date based on the vendor's lead time, but refuses if the vendor currently
    has an open invoice, per the shop rule that a vendor won't ship while owed money.
    """
    con = _connect()
    try:
        vendor = con.execute("SELECT * FROM vendors WHERE id = ?", (vendor_id,)).fetchone()
        if vendor is None:
            return {"status": "refused", "reason": f"No vendor with id {vendor_id}."}

        open_invoices = con.execute(
            "SELECT id FROM invoices WHERE vendor_id = ? AND status = 'open'", (vendor_id,)
        ).fetchall()
        if open_invoices:
            return {
                "status": "refused",
                "reason": f"Vendor {vendor['name']} has an open unpaid invoice and will not ship new product.",
            }

        today = _today(con)
        expected_arrival = (today + timedelta(days=vendor["lead_days"])).isoformat()
        cur = con.execute(
            "INSERT INTO purchase_orders (vendor_id, sku, qty, status, ticket_id, created_at, expected_arrival) "
            "VALUES (?, ?, ?, 'ordered', ?, ?, ?)",
            (vendor_id, sku, qty, ticket_id, today.isoformat(), expected_arrival),
        )
        con.commit()
        return {
            "status": "ordered",
            "purchase_order_id": cur.lastrowid,
            "vendor_id": vendor_id,
            "vendor_name": vendor["name"],
            "sku": sku,
            "qty": qty,
            "expected_arrival": expected_arrival,
        }
    finally:
        con.close()


@mcp.tool
def draft_message(audience: str, recipient: str, subject: str, body: str, ticket_id: int | None = None) -> dict:
    """Save a draft customer or vendor message to the board — never sent for real.

    Writes: drafts.
    Lets Customer Service (and others) propose outbound communication for any
    ticket without emailing a real customer or calling a real vendor, per the
    shop rule that drafts stay on the board.
    """
    if audience not in ("customer", "vendor"):
        return {"status": "refused", "reason": "audience must be 'customer' or 'vendor'."}

    con = _connect()
    try:
        today = _today(con).isoformat()
        cur = con.execute(
            "INSERT INTO drafts (audience, recipient, subject, body, ticket_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (audience, recipient, subject, body, ticket_id, today),
        )
        con.commit()
        return {
            "status": "drafted",
            "draft_id": cur.lastrowid,
            "audience": audience,
            "recipient": recipient,
            "subject": subject,
            "ticket_id": ticket_id,
        }
    finally:
        con.close()


@mcp.tool
def update_ticket_status(ticket_id: int, status: str, notes: str | None = None) -> dict:
    """Update a ticket's status and append a note explaining why.

    Reads/writes: tickets.
    Lets any agent close out ticket 101, 102, or 103 (or mark it pending)
    once its agents have decided what to do, with a note trail of the reasoning.
    """
    con = _connect()
    try:
        ticket = con.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
        if ticket is None:
            return {"status": "refused", "reason": f"No ticket with id {ticket_id}."}

        if status == "resolved":
            awaiting = con.execute(
                "SELECT id, description FROM pending_actions WHERE ticket_id = ? AND status = 'pending'",
                (ticket_id,),
            ).fetchall()
            if awaiting:
                ids = ", ".join(f"#{row['id']}" for row in awaiting)
                return {
                    "status": "refused",
                    "reason": f"Ticket {ticket_id} still has action(s) {ids} awaiting human approval; it can't be resolved yet.",
                }

        if notes:
            merged_notes = f"{ticket['notes']} | {notes}" if ticket["notes"] else notes
            con.execute("UPDATE tickets SET status = ?, notes = ? WHERE id = ?", (status, merged_notes, ticket_id))
        else:
            con.execute("UPDATE tickets SET status = ? WHERE id = ?", (status, ticket_id))
        con.commit()
        updated = con.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
        return {"status": "updated", "ticket": dict(updated)}
    finally:
        con.close()


# ---------------------------------------------------------------------------
# Prepare / approve / execute (Problem 7: dashboard-driven human approval)
# ---------------------------------------------------------------------------
#
# Agents may no longer call pay_invoice/pay_rent/request_restock directly (see
# backend/mcp_toolsets.py — those tools aren't in any agent's filtered
# toolset). Instead, Accounting/Inventory call prepare_payment/prepare_restock
# to record a proposal, and only the FastAPI backend (backend/main.py), acting
# on a real human's decision from the dashboard, calls decide_pending_action
# to actually execute it. This makes "agents must not approve their own
# payments" a hard tool-visibility boundary rather than just a prompt rule.


@mcp.tool
def prepare_payment(kind: str, ref_id: int, ticket_id: int | None = None) -> dict:
    """Propose paying an invoice or rent, without paying it — awaits human approval.

    Reads: invoices or leases; writes: pending_actions.
    Lets Accounting flag that ticket 101's invoice #501 or ticket 102's rent
    needs to be paid, without ever executing the payment itself.
    """
    if kind not in ("invoice", "rent"):
        return {"status": "refused", "reason": "kind must be 'invoice' or 'rent'."}

    con = _connect()
    try:
        action_type = f"pay_{kind}"
        existing = con.execute(
            "SELECT id FROM pending_actions WHERE action_type = ? AND ref_id = ? AND status = 'pending'",
            (action_type, ref_id),
        ).fetchone()
        if existing is not None:
            return {
                "status": "refused",
                "reason": f"A {kind} payment for id {ref_id} is already pending approval (pending_id {existing['id']}).",
            }

        today = _today(con).isoformat()

        if kind == "invoice":
            row = con.execute("SELECT * FROM invoices WHERE id = ?", (ref_id,)).fetchone()
            if row is None:
                return {"status": "refused", "reason": f"No invoice with id {ref_id}."}
            if row["status"] != "open":
                return {"status": "refused", "reason": f"Invoice {ref_id} is not open (status={row['status']})."}
            vendor = con.execute("SELECT name FROM vendors WHERE id = ?", (row["vendor_id"],)).fetchone()
            amount = row["amount"]
            recipient = vendor["name"] if vendor else f"vendor {row['vendor_id']}"
            description = f"Pay invoice #{ref_id}: {row['description']}"
        else:
            row = con.execute("SELECT * FROM leases WHERE id = ?", (ref_id,)).fetchone()
            if row is None:
                return {"status": "refused", "reason": f"No lease with id {ref_id}."}
            already_paid = con.execute(
                "SELECT id FROM payments WHERE kind = 'rent' AND ref_id = ? AND paid_at = ?", (ref_id, today)
            ).fetchone()
            if already_paid is not None:
                return {"status": "refused", "reason": f"Rent for lease {ref_id} was already paid today ({today})."}
            amount = row["monthly_rent"]
            recipient = row["landlord"]
            description = f"Pay rent for lease #{ref_id}: {row['space_name']} (due {row['next_due']})"

        cur = con.execute(
            "INSERT INTO pending_actions (action_type, ref_id, sku, qty, amount, recipient, description, ticket_id, status, created_at) "
            "VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, 'pending', ?)",
            (action_type, ref_id, amount, recipient, description, ticket_id, today),
        )
        con.commit()
        return {
            "status": "prepared",
            "pending_id": cur.lastrowid,
            "action_type": action_type,
            "amount": amount,
            "recipient": recipient,
            "description": description,
        }
    finally:
        con.close()


@mcp.tool
def prepare_restock(vendor_id: int, sku: str, qty: int, ticket_id: int | None = None) -> dict:
    """Propose a vendor restock order, without placing it — awaits human approval.

    Reads: vendors, invoices, pricing; writes: pending_actions.
    Lets Inventory flag ticket 103's 12-unit hoodie shortfall for a restock
    order without committing the shop to it unilaterally. Still refuses up
    front if the vendor has an open invoice, since no approval can change that.
    """
    con = _connect()
    try:
        vendor = con.execute("SELECT * FROM vendors WHERE id = ?", (vendor_id,)).fetchone()
        if vendor is None:
            return {"status": "refused", "reason": f"No vendor with id {vendor_id}."}

        open_invoices = con.execute(
            "SELECT id FROM invoices WHERE vendor_id = ? AND status = 'open'", (vendor_id,)
        ).fetchall()
        if open_invoices:
            return {
                "status": "refused",
                "reason": f"Vendor {vendor['name']} has an open unpaid invoice and will not ship new product.",
            }

        pricing = con.execute("SELECT unit_cost FROM pricing WHERE sku = ?", (sku,)).fetchone()
        est_amount = round(pricing["unit_cost"] * qty, 2) if pricing else None
        description = f"Order {qty} x {sku} from {vendor['name']} (lead time {vendor['lead_days']}d)"

        existing = con.execute(
            "SELECT id FROM pending_actions WHERE action_type = 'restock' AND ref_id = ? AND sku = ? AND status = 'pending'",
            (vendor_id, sku),
        ).fetchone()
        if existing is not None:
            return {
                "status": "refused",
                "reason": f"A restock of {sku} from {vendor['name']} is already pending approval (pending_id {existing['id']}).",
            }

        today = _today(con).isoformat()
        cur = con.execute(
            "INSERT INTO pending_actions (action_type, ref_id, sku, qty, amount, recipient, description, ticket_id, status, created_at) "
            "VALUES ('restock', ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
            (vendor_id, sku, qty, est_amount, vendor["name"], description, ticket_id, today),
        )
        con.commit()
        return {
            "status": "prepared",
            "pending_id": cur.lastrowid,
            "action_type": "restock",
            "estimated_amount": est_amount,
            "recipient": vendor["name"],
            "description": description,
        }
    finally:
        con.close()


@mcp.tool
def list_pending_actions(status: str | None = None) -> list[dict]:
    """List prepared payments/purchases awaiting (or past) human approval.

    Reads: pending_actions.
    This is what the dashboard shows a human to decide on.
    """
    con = _connect()
    try:
        query = "SELECT * FROM pending_actions"
        params: list = []
        if status is not None:
            query += " WHERE status = ?"
            params.append(status)
        query += " ORDER BY id"
        return [dict(row) for row in con.execute(query, params).fetchall()]
    finally:
        con.close()


@mcp.tool
def decide_pending_action(pending_id: int, approved: bool, approved_by: str) -> dict:
    """Approve or deny a prepared payment/purchase, and execute it if approved.

    Reads/writes: pending_actions; on approval, reuses pay_invoice/pay_rent/
    request_restock (with the same insufficient-cash, vendor-block, and
    duplicate-payment refusals) and update_ticket_status.
    This is the only place money actually moves or a purchase order is
    actually placed in this project — and it is never called by an agent, only
    by the FastAPI backend after a real human's decision.
    """
    con = _connect()
    try:
        pending = con.execute("SELECT * FROM pending_actions WHERE id = ?", (pending_id,)).fetchone()
        if pending is None:
            return {"status": "refused", "reason": f"No pending action with id {pending_id}."}
        if pending["status"] != "pending":
            return {
                "status": "refused",
                "reason": f"Pending action {pending_id} was already decided (status={pending['status']}); refusing to act twice.",
            }

        today = _today(con).isoformat()

        if not approved:
            con.execute(
                "UPDATE pending_actions SET status = 'denied', decided_at = ?, approved_by = ? WHERE id = ?",
                (today, approved_by or None, pending_id),
            )
            con.commit()
            if pending["ticket_id"] is not None:
                update_ticket_status(
                    pending["ticket_id"],
                    "pending",
                    f"Pending action #{pending_id} ({pending['description']}) was denied.",
                )
            return {
                "status": "denied",
                "pending_id": pending_id,
                "ticket_id": pending["ticket_id"],
                "action_type": pending["action_type"],
            }

        if not approved_by:
            return {"status": "refused", "reason": "Approving a payment/purchase requires a human approver's name."}

        # Mark it approved before executing, so a repeated request can't double-execute.
        con.execute(
            "UPDATE pending_actions SET status = 'approved', decided_at = ?, approved_by = ? WHERE id = ?",
            (today, approved_by, pending_id),
        )
        con.commit()

        if pending["action_type"] == "pay_invoice":
            result = pay_invoice(pending["ref_id"], approved_by)
        elif pending["action_type"] == "pay_rent":
            result = pay_rent(pending["ref_id"], approved_by)
        elif pending["action_type"] == "restock":
            result = request_restock(pending["ref_id"], pending["sku"], pending["qty"], pending["ticket_id"])
        else:
            return {"status": "refused", "reason": f"Unknown action_type {pending['action_type']!r}."}

        final_status = "executed" if result.get("status") in ("paid", "ordered") else "refused"
        con.execute(
            "UPDATE pending_actions SET status = ?, result = ? WHERE id = ?",
            (final_status, json.dumps(result), pending_id),
        )
        con.commit()

        if pending["ticket_id"] is not None:
            ticket = con.execute("SELECT type FROM tickets WHERE id = ?", (pending["ticket_id"],)).fetchone()
            # Paying a lease's rent fully resolves a rent_notice ticket. Paying an
            # invoice that was only *blocking* a vendor, or placing a restock
            # order, doesn't by itself fulfill a customer order or price
            # override — those still need the item to actually ship — so they
            # stay pending even on a successful execution.
            fully_resolves = (
                final_status == "executed"
                and pending["action_type"] == "pay_rent"
                and ticket is not None
                and ticket["type"] == "rent_notice"
            )
            ticket_status = "resolved" if fully_resolves else "pending"
            update_ticket_status(
                pending["ticket_id"],
                ticket_status,
                f"Pending action #{pending_id} ({pending['description']}) {final_status}: {result}",
            )

        return {
            "status": final_status,
            "pending_id": pending_id,
            "ticket_id": pending["ticket_id"],
            "action_type": pending["action_type"],
            "ticket_resolved": pending["ticket_id"] is not None and ticket_status == "resolved",
            "result": result,
        }
    finally:
        con.close()


@mcp.tool
def reset_database() -> dict:
    """Reset the working database to the original seed values.

    Copies data/campus_customs.db over data/campus_customs_new.db. Does not
    touch output/audit_trail.json — agent run history is preserved across resets.
    """
    shutil.copyfile(SEED_DB_PATH, DB_PATH)
    return {"status": "reset", "from": str(SEED_DB_PATH.name), "to": str(DB_PATH.name)}


if __name__ == "__main__":
    mcp.run()
