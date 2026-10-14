from __future__ import annotations

import asyncio
import sys
from typing import Any

from fastmcp import Client
from fastmcp.client.transports import StdioTransport

from backend.mcp_toolsets import SERVER_SCRIPT


class MCPConnection:
    """One long-lived MCP connection for the FastAPI routes (not the agents).

    Keeps "all shop database access goes through MCP" true for the API layer
    too. The dashboard polls every couple of seconds, so this holds a single
    server subprocess open for the app's lifetime instead of spawning one per
    request; a lock serializes calls over the shared stdio session.
    """

    def __init__(self) -> None:
        self._client: Client | None = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        transport = StdioTransport(command=sys.executable, args=[str(SERVER_SCRIPT)])
        self._client = Client(transport)
        await self._client.__aenter__()

    async def stop(self) -> None:
        if self._client is not None:
            await self._client.__aexit__(None, None, None)
            self._client = None

    async def call(self, tool_name: str, **arguments: Any) -> Any:
        if self._client is None:
            raise RuntimeError("MCP connection not started")
        async with self._lock:
            result = await self._client.call_tool(tool_name, arguments)
        return result.data


mcp_connection = MCPConnection()


async def call_mcp(tool_name: str, **arguments: Any) -> Any:
    return await mcp_connection.call(tool_name, **arguments)
