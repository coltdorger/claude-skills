# Skill catalog

The 34 Claude Code skills I have written, grouped by what they do. Nine are published in full under
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

## Adapted from open-source skill libraries (November 2026)

Seven skills that adapt methods from public skill libraries to Valence configuration work, published in full. They
are generalized, and none has yet run on a client system. The [write-up](docs/open-source-skills-for-valence.md)
covers what was taken from each library and what was left out, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
carries the licenses.

| Skill | What it does | Adapted from |
|---|---|---|
| [`valence-intake`](skills/valence-intake/SKILL.md) | Raw tickets to planner-ready ticket briefs and an intake board: duplicate and prior-rejection checks by concept, read-only verification before any questions, a decision frontier with recommended answers, async client questionnaires that never invite new scope | mattpocock/skills, addyosmani/agent-skills |
| [`valence-brief-review`](skills/valence-brief-review/SKILL.md) | Fresh-context review of the batch brief before any build by seven read-only reviewers (scope, simplest config, cold builder, readiness, STAGE grounding, landmines, wording), with the author's claim withheld and an approval stamp the builders wait on | google/elephant-goldfish-model, addyosmani/agent-skills |
| [`valence-diagnose`](skills/valence-diagnose/SKILL.md) | Silent-failure diagnosis: no hypothesis until a check goes red on the reported symptom, a nine-layer check tree, one variable at a time, fixed-price defect classes, a guard that fails without the fix | mattpocock/skills, addyosmani/agent-skills |
| [`valence-retire`](skills/valence-retire/SKILL.md) | Changes or retires a shared procedure, lookup, template field, settings row, workflow, page or role through separately synced expand, migrate and contract phases, plus zombie candidates from the atlas | addyosmani/agent-skills |
| [`valence-retro`](skills/valence-retro/SKILL.md) | After a HOLD, MISMATCH or rework, turns each miss into the earliest gate that would have caught it, with a floor guard so no fix lowers the bar and ratchets on atlas metrics | mattpocock/skills, addyosmani/agent-skills |
| [`valence-intent-drift`](skills/valence-intent-drift/SKILL.md) | Compares Why-This-Config, Do-Not-Configure, scope and answered Open-Questions notes with live STAGE and PROD configuration, SELECT-only, and reports only the differences | google/elephant-goldfish-model, mattpocock/skills |
| [`valence-security-audit`](skills/valence-security-audit/SKILL.md) | SELECT-only security audit of a client configuration: coverage ledger, isolated hunters, a fresh verifier that tries to disprove each candidate, three verdicts, and zero-dependency validators | cloudflare/security-audit-skill |

## Ventures

| Skill | What it does |
|---|---|
| `vantage` | Field playbook for [Vantage Render Co.](docs/vantage-render.md): tenancy and row-level-security model, audited write functions, deploy runbook and known failure modes |
