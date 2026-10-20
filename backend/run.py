"""CLI entry point: reset the working database, then resolve every open ticket.

Usage:
    .venv/bin/python -m backend.run            # resolve all open tickets
    .venv/bin/python -m backend.run 101        # resolve just ticket 101
"""

from __future__ import annotations

import asyncio
import shutil
import sqlite3
import sys
from pathlib import Path

from backend.orchestrator import resolve_ticket

HW5_ROOT = Path(__file__).resolve().parent.parent
SEED_DB = HW5_ROOT / "data" / "campus_customs.db"
WORKING_DB = HW5_ROOT / "data" / "campus_customs_new.db"


def reset_database() -> None:
    shutil.copyfile(SEED_DB, WORKING_DB)
    print(f"Reset {WORKING_DB.name} from {SEED_DB.name}.")


def open_ticket_ids() -> list[int]:
    con = sqlite3.connect(WORKING_DB)
    try:
        rows = con.execute("SELECT id FROM tickets WHERE status = 'open' ORDER BY id").fetchall()
        return [r[0] for r in rows]
    finally:
        con.close()


async def main() -> None:
    reset_database()

    if len(sys.argv) > 1:
        ticket_ids = [int(arg) for arg in sys.argv[1:]]
    else:
        ticket_ids = open_ticket_ids()

    for ticket_id in ticket_ids:
        print(f"\n===== Ticket #{ticket_id} =====")
        output, outcome = await resolve_ticket(ticket_id)
        print(f"[{outcome}] {output}")


if __name__ == "__main__":
    asyncio.run(main())
