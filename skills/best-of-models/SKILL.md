---
name: best-of-models
description: >-
  Quality-first multi-model orchestration: get Fable-level reasoning, Opus-level
  orchestration and judgment, and Sonnet-level coding on the same task by routing each
  piece of work to the model that is best at it through subagents (Agent tool `model`:
  fable / opus / sonnet). The session model (normally Opus 5.5) stays the orchestrator
  and default worker; Fable 5.1 is brought in for hard reasoning, planning under
  ambiguity, stuck problems and high-stakes review; Sonnet (Sonnet 5, sometimes called
  "Sonnet 5.5") does well-specified coding. Use this skill whenever the user asks for
  "the best model for each part", "bring in Fable", "use Sonnet for the code",
  "combine the models", "max quality", or whenever a non-trivial task mixes hard
  judgment with a real amount of implementation (multi-file builds, migrations,
  debugging that resisted a first attempt, anything irreversible or client-facing)
  and quality matters more than token cost. Prefer exec-delegation instead when the
  goal is minimizing top-tier spend.
---

# Best of models

No single model is best at everything. Fable 5.1 reasons deepest, Opus 5.5 is the
strongest all-round operator (holds context, drives tools, integrates, writes well),
and Sonnet 5 writes a lot of correct code quickly from a clear spec. A skill can't give
one model another's abilities, but it can make sure every piece of work lands on the
model that does it best, and that the pieces are checked before they're combined. That
is what this skill does.

The optimization target is **quality at a sensible speed**. Cost matters only in the
sense of not wasting effort: don't spin up Fable for a lookup, and don't hand Sonnet a
problem that is really a design question in disguise.

## Roles

| Role | Who | Use for |
|---|---|---|
| Orchestrator | The session model (normally Opus 5.5) | Owns the goal and the user relationship. Understands the ask, gathers context, splits the work, writes briefs, reviews everything that comes back, integrates, verifies, reports. Never delegates the final judgment of "is this done and right". |
| Default worker | Opus: yourself, or `model: "opus"` subagents for parallel work | Investigation across tools and files, analysis, writing, moderate judgment calls, reviewing Sonnet's code, anything needing a lot of project context. |
| Deep reasoner | `model: "fable"` | Framing a vague or high-stakes problem; architecture and data-model decisions with wide blast radius; root cause on a bug that survived a real attempt; reconciling conflicting findings; adversarial review before anything irreversible or outward-facing; final check of a high-stakes deliverable. |
| Coder | `model: "sonnet"` | Implementing a clear spec: functions, scripts, SQL, tests, refactors, mechanical multi-file edits, code search fan-out, format transforms. |

`haiku` is fine for trivial bulk chores (renaming, simple extraction over many small
files), but rarely worth the hand-off overhead.

If the session itself is running on Fable, keep the same routing: you are the
orchestrator and deep reasoner, Opus is the default worker, Sonnet the coder.

## When to use it, and when not to

Use it when the task has **both** a genuinely hard part (ambiguity, design, stakes,
a stubborn bug) **and** a real amount of execution. That is where splitting pays off.

Skip the ceremony when:
- The task is small and you can do it well directly in a few steps. Just do it.
- The task is pure judgment with no build (a single decision, a review, an opinion).
  Answer it yourself, or ask Fable once if it is really hard. No coder needed.
- The work is so entangled with conversation context that briefing a subagent would
  take longer than doing it.

## Workflow

### 1. Frame the problem
Restate the goal, constraints, and what "done" means in a few lines. Decide where the
real difficulty is. Ask the user only if a decision is genuinely theirs.

If the framing itself is hard (conflicting requirements, a new system design, a choice
with expensive consequences), send **Fable a planning brief** before building:
- the goal and constraints, distilled (not the whole conversation)
- the options you see and what worries you about each
- what you need back: a recommended approach, key risks, and the order of work

Treat Fable's plan as expert input, not orders. Check it against facts you hold that
Fable didn't see.

### 2. Split the work
Cut the plan into pieces with clear boundaries and clear acceptance criteria. Mark each
piece: *judgment* (you or Fable), *investigation/writing* (Opus), or *specified
coding* (Sonnet). Independent pieces run in parallel; pieces that touch the same files
do not.

### 3. Brief the workers
A subagent starts with none of your context, so the brief is the whole world it sees.
A good coding brief for Sonnet contains:
- **Goal** in one sentence, and why it exists
- **Exact files/paths**, the interfaces to honor, and the style to match
- **Acceptance criteria**: behavior, edge cases, and the command that proves it
  (test, build, lint, a query that must return a given result)
- **Boundaries**: what not to touch, no drive-by refactors, no new dependencies unless
  stated
- **Return format**: what changed, the file list, how it was verified, anything unsure

Vague briefs are the main way this approach fails. If you can't write the acceptance
criteria, the piece isn't ready for Sonnet. It still needs design, so it goes to you or
Fable.

### 4. Review everything that comes back
Subagent reports describe what the agent intended, not necessarily what happened. For
code:
- read the actual diff, not just the summary
- run the tests or checks yourself
- look for the classic slips: edge cases skipped, errors swallowed, scope creep,
  hard-coded values, tests weakened to pass

Fix small issues yourself. Send larger ones back to the same worker with specific
feedback (continue it rather than starting over, so it keeps its context).

### 5. Escalate when stuck
- Sonnet misses the spec twice → take it yourself (Opus); the spec or the problem is
  harder than it looked.
- A real Opus attempt fails, or two reasonable hypotheses conflict → send Fable the
  **distilled** problem: symptoms, what was tried, evidence for and against each theory,
  and the exact question. Not a raw log dump.
- Fable and your own evidence disagree → trust evidence you can reproduce, and say so.

### 6. High-stakes gate
Before anything hard to undo or visible outside the team (production changes, data
deletion or migration, security-sensitive code, client-facing deliverables, published
material), ask **Fable for an adversarial review** of the final change or document:
"find what is wrong or risky here". Give it the change, the intent, and the
constraints. Address or explicitly accept each finding before proceeding. The user's
approval requirements for such actions still apply; this gate is in addition to them.

### 7. Integrate and report
Combine the pieces, run the end-to-end check yourself, and report to the user plainly:
what was done, how it was verified, what is still open. Mention which model did what
only if the user cares; the result is what matters.

## Anti-patterns

- **Fable doing mechanical work.** It is slow and expensive for that; give it the
  question, not the chores.
- **Sonnet doing design.** If the brief says "figure out the best way to...", it is
  not a coding task yet.
- **Trusting summaries.** Always verify against the diff, the test run, or the live
  system.
- **Parallel agents on the same files.** They will overwrite each other; serialize them
  or split by file.
- **Context dumps.** Distill before handing off; a focused brief beats a long
  transcript for every model.
- **Ceremony on small tasks.** Routing a one-line fix through three models is worse,
  not better.

## Practical notes

- Pass the model explicitly on every Agent call (`model: "fable"`, `"opus"`,
  `"sonnet"`). Without it, subagents inherit the session model.
- Run independent agents in the same message so they work in parallel; run in the
  background when you have other useful work meanwhile.
- The multi-agent Workflow tool needs the user's explicit opt-in. This skill uses plain
  Agent calls unless the user has asked for a workflow.
- Model naming: the Agent tool's `sonnet` maps to the current Sonnet (Sonnet 5 as of
  this writing, which some people call "Sonnet 5.5"); `fable` is Fable 5.1 and `opus`
  is Opus 5.5.
