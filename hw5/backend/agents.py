from __future__ import annotations

import os

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")
from dataclasses import dataclass, replace
from pathlib import Path

from dotenv import find_dotenv, load_dotenv
from openai import AsyncOpenAI
from portkey_ai import PORTKEY_GATEWAY_URL, createHeaders
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from backend.audit import AuditLog
from backend.mcp_toolsets import make_toolset
from backend.models import AgentName, AuditEvent

# Nearest .env walking up from backend/: hw5/.env if one exists, otherwise a shared one in a
# parent folder (e.g. the course folder's .env).
load_dotenv(find_dotenv())

MODEL_NAME = "gpt-6-luna"
PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"


def _build_model() -> OpenAIChatModel:
    """gpt-6-luna through Portkey only — see AGENTS.md shop rules for this assignment."""
    key = os.environ["PORTKEY_API_KEY"]
    client = AsyncOpenAI(
        api_key=key,
        base_url=PORTKEY_GATEWAY_URL,
        default_headers=createHeaders(api_key=key, provider="openai"),
    )
    # gpt-6-luna rejects function tools unless reasoning_effort is "none" on
    # the chat-completions endpoint (Portkey gateway surfaces this as a 400).
    return OpenAIChatModel(
        MODEL_NAME,
        provider=OpenAIProvider(openai_client=client),
        settings={"openai_reasoning_effort": "none"},
    )


MODEL = _build_model()


@dataclass
class RunBudget:
    """Shared, mutable across an entire ticket's delegation chain."""

    delegations_remaining: int = 6


@dataclass
class ShopDeps:
    run_id: str
    ticket_id: int | None
    agent_name: AgentName
    audit: AuditLog
    budget: RunBudget


def _load_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text()


AGENT_REGISTRY: dict[AgentName, Agent[ShopDeps, str]] = {}


def _make_agent(agent_name: AgentName) -> Agent[ShopDeps, str]:
    return Agent(
        MODEL,
        deps_type=ShopDeps,
        system_prompt=_load_prompt(agent_name.value),
        toolsets=[make_toolset(agent_name)],
        name=agent_name.value,
    )


for _name in AgentName:
    AGENT_REGISTRY[_name] = _make_agent(_name)


async def delegate(ctx: RunContext[ShopDeps], to_agent: AgentName, task: str) -> str:
    """Hand a task off to another agent on the team and return their response.

    Any agent may delegate to any other agent (including back to Boss), but the
    delegation budget for this ticket is shared and finite — once it runs out,
    this tool refuses instead of looping forever.
    """
    deps = ctx.deps
    if deps.budget.delegations_remaining <= 0:
        deps.audit.append(
            AuditEvent(
                run_id=deps.run_id,
                ticket_id=deps.ticket_id,
                agent=deps.agent_name,
                event_type="limit_hit",
                detail={"limit": "delegations_remaining", "attempted_to_agent": to_agent, "task": task},
            )
        )
        return "Delegation budget exhausted for this ticket — resolve with what you already know."

    deps.budget.delegations_remaining -= 1
    deps.audit.append(
        AuditEvent(
            run_id=deps.run_id,
            ticket_id=deps.ticket_id,
            agent=deps.agent_name,
            event_type="delegation",
            detail={"to_agent": to_agent.value, "task": task},
        )
    )

    target = AGENT_REGISTRY[to_agent]
    sub_deps = replace(deps, agent_name=to_agent)
    deps.audit.append(
        AuditEvent(run_id=deps.run_id, ticket_id=deps.ticket_id, agent=to_agent, event_type="agent_start", detail={"task": task})
    )
    result = await target.run(task, deps=sub_deps, usage=ctx.usage)
    deps.audit.append(
        AuditEvent(
            run_id=deps.run_id,
            ticket_id=deps.ticket_id,
            agent=to_agent,
            event_type="agent_end",
            detail={"output": result.output},
        )
    )
    return result.output


# Wire up delegation on every agent. There is no in-agent approval tool as of
# Problem 7: Accounting/Inventory call the MCP `prepare_payment`/
# `prepare_restock` tools to propose an action and then stop — a human
# approves or denies it from the dashboard, which calls `decide_pending_action`
# directly through backend/main.py, outside any agent's reach entirely.
for _agent in AGENT_REGISTRY.values():
    _agent.tool(delegate)
