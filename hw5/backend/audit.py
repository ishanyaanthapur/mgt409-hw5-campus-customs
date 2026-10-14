from __future__ import annotations

import json
from pathlib import Path

from backend.models import AuditEvent

AUDIT_PATH = Path(__file__).resolve().parent.parent / "output" / "audit_trail.json"


class AuditLog:
    """Appends AuditEvents to output/audit_trail.json without ever deleting prior runs."""

    def __init__(self, path: Path = AUDIT_PATH) -> None:
        self.path = path

    def _load(self) -> list[dict]:
        if not self.path.exists():
            return []
        text = self.path.read_text().strip()
        return json.loads(text) if text else []

    def since(self, after: int, limit: int) -> list[dict]:
        """Events with sequence number > `after`, each tagged with its `seq` (array index)."""
        events = self._load()
        start = max(after + 1, len(events) - limit)
        return [{"seq": i, **events[i]} for i in range(start, len(events))]

    def append(self, event: AuditEvent) -> None:
        events = self._load()
        events.append(json.loads(event.model_dump_json()))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(events, indent=2))
