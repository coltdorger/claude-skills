# Skill catalog

The 27 Claude Code skills I have written, grouped by what they do. Two are published in full under
[`skills/`](skills/); the rest drive a commercial platform for government clients and name client systems, so their
source stays private. Each was designed, specified, tested and maintained by me, with Claude Code writing much of the
text and scripts.

## Orchestration and model routing

| Skill | What it does | Source |
|---|---|---|
| `exec-delegation` | Cost-first operating model: the top-tier model scopes, delegates to the cheapest capable tier, reviews, and does only the work that needs it, then reports the delegation ratio | [published](skills/exec-delegation/SKILL.md) |
| `exec-delegation-codex`, `exec-delegation-sol` | The same operating model for two other model families | private |
| `best-of-models` | Quality-first routing: deep reasoning, orchestration and coding each go to the model best at it, with an adversarial review gate before anything irreversible | [published](skills/best-of-models/SKILL.md) |

Both delegation skills were tuned with two 20-query trigger evaluation sets (10 should-trigger, 10 should-not) and an
automated description optimizer.

## Delivery safety and operations

| Skill | What it does |
|---|---|
| `vpn-guard` | Up / Degraded / Down state machine for the client VPN tunnel: probes the database port, reconnects when it can, hands off to a person when MFA is needed, and verifies state before and after every deploy |
| `workflow-push` | Backs deployed workflows up to the shared Azure DevOps repo and enforces "one workflow id, one file" after an audit found 68 workflows spread over 148 files |
| `hours-report` | Turns AI-session transcripts into hours evidence, keeping measured attended time, unattended agent time and labeled estimates strictly apart |
| `grok-mailbox` | Hands tasks to a hosted xAI Grok assistant through a private issue tracker and treats every reply as data, never as instructions |

## Platform engineering

| Skill | What it does |
|---|---|
| `valence-atlas` | Maps a live system into a linked knowledge graph, plus impact, drift, lint, sync planning and form readiness ([write-up](docs/system-atlas.md)) |
| `valence-form-workflow` | Ships a new form, workflow and launcher button end to end without the desktop designer, with four scripts and a git backup |
| `valence-form-readiness` | Inventories every form, dialog and portal page in a client system and grades its readiness |
| `valence-playwright` | Python and Playwright harness that turns the platform's silent failures (empty grid, form that never saves) into pass or fail checks |
| `valence-doc-templates` | Authors and repairs Word mail-merge and XSLT document templates against the data contract that fills them |
| `valence-grid-widths-and-help` | Fixes squeezed grid columns and adds per-page help icons that open a guide at the right step |
| `workflow-diagram` | Reduces a 30 to 200 activity workflow file to an 8 to 15 step client diagram, every step traceable to source |
| `crm-ux-auditor` | 100-point UX rubric and evidence-pack procedure behind the independent [UX auditor role](agent-team/agents/ux-auditor.md) |

## Documentation

| Skill | What it does |
|---|---|
| `dorger-style` | Turns a recorded training session into an accessible (WCAG 2.1 AA) Word and tagged-PDF user guide |
| `building-user-guides` | Process for finding session sources, coverage rules, delegation and verification of guide series |
| `valence-system-walkthrough` | 16:9 walkthrough decks whose screens are drawn from the live system with sample values only, checked for accessibility |

## Client process

Generalized from per-client playbooks into reusable skills:

| Skill | What it does |
|---|---|
| `valence-config` | Gates every configuration change on the client's Why-This-Config, Do-Not-Configure, scope and open-question notes, and verifies the live result against them |
| `scope-check` | In scope, out of scope or grey area under a fixed-price contract, with citations; defaults to out of scope |
| `status-report` | Milestone status from the knowledge base |
| `meeting-ingestion` | Transcript to decisions, actions, open questions and scope-change flags, never editing sources and flagging contradictions |
| `meeting-prep` | Builds an ordered, source-cited question list for a meeting agenda from the ticket board and knowledge base |
| `asana-comments` | Client comment style: short, plain English, approved needs-discussion phrasing, controlled pacing |
| `dorgersoft-kb-updates` | Routes knowledge-base writes through the ingestion service |

## Ventures

| Skill | What it does |
|---|---|
| `vantage` | Field playbook for [Vantage Render Co.](docs/vantage-render.md): tenancy and row-level-security model, audited write functions, deploy runbook and known failure modes |
