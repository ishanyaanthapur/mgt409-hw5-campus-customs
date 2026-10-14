# AI Prompts Log — HW5

## Problem 2 — Study the Campus Customs database

**Main prompt:**

Asked to study the `campus_customs.db` SQLite database in `hw5/`: inspect every table and field, make a working copy of the database for later changes, examine the three open tickets and how they connect to other tables, and start `output/harness.md` listing each table's fields with a brief explanation of why that table matters to the agents — essentially mapping the information the AI team will need to do its work.

**Follow-up prompt(s):**

Pointed out the working-copy database should be named `campus_customs_new.db` instead of the name originally chosen.

**What was lacking:**

The original prompt said to make a working copy but didn't specify a filename, so an arbitrary name (`campus_customs_working.db`) was chosen and had to be corrected to the expected `campus_customs_new.db`.

---

## Problem 3 — Build the MCP server

**Main prompt:**

Asked to build an MCP server in `mcp_server/` using FastMCP that accesses `data/campus_customs_new.db`. Review tickets 101, 102, and 103 and create three clearly named tools the agents will need to address them, using only real data from the database (no invented data) — no need to connect or run the server yet. Update `output/harness.md` to list each tool, the table(s) it reads, the ticket it helps address, and one sentence on why it's useful for that ticket. Also create `mcp_server/README.md` briefly explaining the server's purpose, database, and tools, following the shop rules given earlier.

---

## Problem 4 — Add the MCP server to vibe coder and test each tool

**Main prompt:**

Asked to connect the Problem-3 MCP server to this project in the vibe coder (Claude Code) by saving the connection config in `.mcp.json` at the project root (or the equivalent local MCP config file). Once connected, call and test each of the three MCP tools through the vibe coder and check the outputs match the actual values in `data/campus_customs_new.db`. Save evidence to `output/mcp_smoke.json`, with the prompt used, the tool's name, and the actual output for each call — real tool calls and results only, following the shop rules.

---

## Problem 5 — Build the agent team and grow the MCP tools

**Main prompt:**

Asked to build the five-agent Campus Customs team (Boss, Inventory, Accounting, Facilities, Customer Service) with PydanticAI, letting any agent delegate to any other. Save a detailed role-specific prompt per agent in `backend/prompts/`, data models in `backend/models.py`, and agent code under `backend/`, with every agent using only `gpt-6-luna` through Portkey. Expand the MCP server with whatever tools are needed to fully handle all three open tickets — all shop data/actions must go through MCP against `campus_customs_new.db`, no invented data or bypass layer. Follow the shop rules, especially human approval before any payment, refusing on insufficient cash, updating records after payment, and keeping communications as drafts. Log every agent-loop step to `output/audit_trail.json`, appending across runs, with limits on loops, delegation, and token use. Update `output/harness.md` with all five agents, every MCP tool, and the tables each uses, plus a safety section; update `mcp_server/README.md` with the full current tool list.

---

## Problem 6 — Plan the three tickets

**Main prompt:**

Before wiring the backend or running the agents, asked to create a standalone `output/desk_tickets.html` page (openable by double-click) with separate tabs for tickets 101, 102, and 103, plus empty Cash and Reflection tabs marked "coming later." For each ticket, fill in an Expected section using the real ticket details and existing MCP tools, explaining in plain language which agent the Boss should call first and why, every expected delegation (who asks whom to do what, in what order), and which MCP tools should be used and what each contributes — choosing only the specialists each ticket actually needs, and accounting for dependencies like unpaid vendor invoices and human approval for payments. Leave an empty Actual section per ticket for later comparison. Planning only — no resolving tickets or touching the shop's data.

---

## Problem 7 — Backend routes

**Main prompt:**

Asked to create the FastAPI backend in `backend/main.py`, connecting it to the existing agent team and MCP server, with routes to: return tickets 101/102/103 with status; accept a ticket id and run the agent team on it; return recent agent events (what agents said, which tools they used) for the dashboard to refresh; execute a prepared payment or purchase only after a human approves it, with agents never approving their own payments, checking cash, refusing insufficient funds, preventing duplicate payments, and updating records through MCP; return the current checking balance; and reset the working database while preserving audit history. Keep all shop database access through MCP, keep appending to `output/audit_trail.json`, start the server with `uvicorn main:app --reload --port 8000` from `backend/`, verify it starts at localhost:8000, and add one harness.md line per route (method, URL, purpose).

---

## Problem 8 — Agent dashboard

**Main prompt:**

Asked to build the Campus Customs dashboard in `frontend/` with React + Vite + TypeScript, connected to the Problem 7 backend. It needed to:

- show all three tickets and let the user select one to start the agent team
- show all five agents with distinct icons and labels, plus their live messages, tool calls, and handoffs
- show a short per-agent summary for each ticket
- provide human approval controls (amount, recipient, reason) that only go through the backend approval route
- show the checking balance and refresh it after payments
- mark a ticket resolved only when the backend confirms it, never while it's awaiting approval or after an error

Visual design: a black and neon-green arcade style with tickets on the left, agent activity in the center, and cash/approvals on the right. Ticket cards go red → yellow → green, each state with text and icon labels, including explicit "Awaiting approval" and error labels. It also needed a "Tickets cleared: N/3" counter with an arcade progress bar, a gold-coin pile that shrinks with the balance (exact number always shown), and a one-time celebration popup with a dancing purple Labubu in a "SMALL MONSTER. BIG SERVICE." T-shirt.

Sound: a retro pickup sound, ten unique agent start/finish cues, and a ka-ching only after a confirmed payment. Sounds had to be tied to real events, never replayed on refresh, and kept from overlapping, with mute/volume controls, audio enabled only after user interaction, and reduced-motion respected.

Delivery: configure CORS for the Vite origin, start with `npm run dev`, and write `output/design.md` explaining the design choices.

**Follow-up prompt(s):**

Reported that the frontend wasn't loading.

**What was lacking:**

The dev servers started during the build didn't persist into the next session, and the handoff didn't make clear that both the backend (`uvicorn`) and the frontend (`npm run dev`) have to be started again each time before the dashboard will load.

---

## Problem 9 — Resolve the tickets

**Main prompt:**

Asked to support a real end-to-end run. Before starting, reset `data/campus_customs_new.db` to its original values and note the starting checking balance. The user then ran tickets 101, 102, and 103 on the React board until each was resolved, personally approving payments, while the run was recorded and screenshots and logs were captured automatically. From that actual run:

- fill each ticket's Actual section in `output/desk_tickets.html` (agents, delegations, tools), keeping the Expected sections for comparison
- complete the Cash tab: starting balance, each ticket's payments or purchases with amounts and reasons, and an ending balance verified against `cash_accounts`
- save `output/resolved_tickets.json` (ID, final status, outcome, agent contributions, human approvals)
- save a double-clickable `output/resolved_board.html` with an automatically captured board screenshot for each resolved ticket
- append the run to `output/audit_trail.json`
- finish `output/harness.md` so it covers tables, MCP tools, the five agents, API routes, the dashboard, and safety rules

**Follow-up prompt(s):**

Reported that ticket 103 wouldn't resolve: the Boss said the 20% discount still lacked human approval, even though nothing was waiting in the approval queue (and the same flow had worked in an earlier test).

**What was lacking:**

The agent prompts never said outright that discounts don't need human approval; only payments and purchases do. So when Customer Service's draft called the discount "not yet confirmed", the Boss invented an approval step that no tool could satisfy, and the ticket stalled until the prompts were clarified.

---

## Problem 10 — Reflection

**Main prompt:**

Asked to prepare the Reflection tab in `output/desk_tickets.html`, organized around five questions with space for the user's own answers:

1. how the agents performed on each ticket
2. how Actual compared with Expected for each ticket
3. what would have been simpler with one agent using tools
4. three new problems the current agents and tools could solve
5. three they couldn't, and what tools and agents they'd need

The ticket and Cash tabs had to stay available as evidence, and every answer had to relate to this app and the three tickets actually run. Rather than writing the reflections, the request was for 3–5 bullet points of run-specific detail per question in chat. Once the user writes their answers, they go into the saved page, and the job is to check that every question is answered and flag any factual inconsistencies with the run evidence while keeping the user's wording and voice.

**Follow-up prompt(s):**

Asked how long each ticket took to complete.

**What was lacking:**

The bullet points for Question 1 didn't include timing. To judge performance, the user needed each ticket's total time and agent working time from the audit trail (e.g. 26 s for #102 vs. 8 min 24 s for #103, most of it waiting).
