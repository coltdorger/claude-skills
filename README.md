# Colt Dorger: Claude skills, agent team and MCP servers

I'm an electrical engineering student at Auburn University (4.0 GPA) and a software engineering intern at Dorger
Software Architects, where I build the AI-agent tooling behind the firm's client delivery for state regulatory
agencies. This repository holds the parts of that work that can be public, plus technical write-ups of my own AI
systems.

**Contact:** coltdorger@outlook.com · **Company:** [vantagerender.com](https://www.vantagerender.com)

**Showcase pages:**
[AI agent delivery](https://claude.ai/artifact/6GCmky9iceZsdLceoYK96j) ·
[JARVIS for Alexa](https://claude.ai/artifact/PsQ26oMsnyw2SqTPyeKaJL) ·
[Trading research](https://claude.ai/artifact/5L8UPFGcZgKGYRbxYnqmAJ) ·
[Vantage Render Co.](https://claude.ai/artifact/UBo9UNJ2cJh8Qse46kY6mK) ·
[Skills and MCP library](https://claude.ai/artifact/JwkDHhCscAz9vcc614gG7d)

## What's here

| Folder | What it is |
|---|---|
| [`agent-team/`](agent-team/) | A five-role Claude Code agent team (planner, builder, verifier, adversary, UX auditor) with fail-closed safety hooks and 31 test assertions, generalized from the production setup |
| [`skills/`](skills/) | Two published skills: [`exec-delegation`](skills/exec-delegation/SKILL.md) (cost-first model routing) and [`best-of-models`](skills/best-of-models/SKILL.md) (quality-first) |
| [`mcp-servers/roku-mcp/`](mcp-servers/roku-mcp/) | A zero-dependency MCP server for TV control, with LAN-only safety and SSDP rediscovery |
| [`docs/`](docs/) | Technical write-ups: [JARVIS for Alexa](docs/jarvis-alexa.md), [system atlas](docs/system-atlas.md), [trading research](docs/trading-research.md), [Vantage Render Co.](docs/vantage-render.md) |
| [`CATALOG.md`](CATALOG.md) | All 27 skills I've written, including the ones kept private |

## Highlights

- **Agent team with an independent release gate.** Nothing is reported live until a read-only adversary agent
  re-reads the database and releases it. In a controlled comparison it used 15% fewer tokens than the previous
  pattern at near-equal blind-scored quality.
- **JARVIS for Alexa.** Amazon Echo to a Cloudflare Worker and Durable Object relay to a Windows agent that runs
  Claude Code in restricted profiles and drives the TV over MCP. HMAC-signed hops, no inbound ports, 656 tests.
- **System atlas.** Six parallel agents mapped 277 pages, 2,103 widgets, 225 workflows and 10,650 dependencies of one
  agency's system in about 2.5 hours; it has since run on nine client systems and graded 1,339 forms.
- **MCP servers.** Six built: TV control, an agent chat hub, a dictation app, a SaaS agent endpoint, a claims-platform
  prototype with approval-gated writes and PHI masking, and a knowledge-ingestion service.
- **Trading research.** A 43,600-line real-time research lab with 1,080 tests and an AI-advised portfolio manager
  whose deterministic core owns every order. Paper trading only, with pre-registered experiments.
- **Vantage Render Co.** A multi-tenant SaaS with database-enforced tenant isolation, 41 isolation tests and an AI
  render pipeline behind a human release gate.

## Why most skills are private

Most of my skills drive a commercial case-management platform for government clients, and their text names client
systems, databases and findings. Those stay private; [CATALOG.md](CATALOG.md) describes each one. Everything published
here was reviewed for client data, hostnames and credentials before it went up.

## How this was built

I design the systems, write the specifications, review every change and verify the results; Claude Code agents write
much of the code and text. The numbers above come from the test suites, evaluation documents and session logs in the
original projects.

## Run the tests

```
node agent-team/hooks/tests/prod-guard.test.js      # 22 assertions
node agent-team/hooks/tests/session-check.test.js   # 9 assertions
ROKU_IP=<roku-lan-ip> node mcp-servers/roku-mcp/test.mjs
```
