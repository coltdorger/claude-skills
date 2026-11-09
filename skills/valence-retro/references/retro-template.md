# Retro template

File: `build/<date>_<batch>-RETRO.md` in the client folder, next to the batch brief. Fill every section; write "none"
rather than deleting one, so the next retro can tell an empty section from a skipped one. Every number in the file
comes from a source named in it; anything not measured says "not measured".

## Template

```markdown
# Retro: <batch>, <date>

**Client:** <client>   **Brief:** build/<date>_<batch>-BRIEF.md   **Previous retro:** <path or none>
**Run by:** <engineer>, with <agent>
**Triggers:** <HOLD on <ticket> | MISMATCH in <log> | rework round on <ticket> | escalation | finding after release | end of batch>

## Sources read

| Source | Path | Read in full |
|---|---|---|
| Batch brief | build/<date>_<batch>-BRIEF.md | yes |
| Brief-review report | <path or "did not run"> | |
| Builder session logs | <paths> | |
| Verifier reports | <paths> | |
| Adversary findings | <paths> | |
| UX auditor reports | <paths or none> | |
| Deploy and rollback scripts | sql/<...>, rollback/<...> | |
| Session transcripts | <paths> | |
| Findings raised after release | <links or none> | |

Missing sources: <none | each one, and whether its absence is itself a candidate>

## Summary

| Severity | Mechanical | Judgment | Navigation | Missing knowledge | Process |
|---|---|---|---|---|---|
| high | | | | | |
| medium | | | | | |
| low | | | | | |

(Counted from the candidates below, after they are written.)

## Candidates, most severe first

### C1. <short title>  [high | medium | low]  [LOOSENING, only if it lowers the bar]

- **What happened:** <facts only, one or two sentences>. Evidence: `<path>`, <section or line>.
- **Caught by:** <adversary HOLD | verifier MISMATCH | rework round | a person after release | nothing>.
- **Class:** mechanical | judgment | navigation | missing knowledge | process.
- **Existing check:** <a check that exists but was not wired in or did not run, and why | none found; looked in <where>>.
- **Proposed change:** <the exact text: see "Writing the proposed change" below>.
- **Where it lives:** <file and section>.
- **Cost:** to build: <what it takes>; on every run: <time or tokens it adds, and to which step>.
- **Proof it works:** <the original evidence that must now trip the gate; the negative control that must still pass>.
- **Status:** proposed | accepted (<engineer>, <date>) | rejected (<engineer>, <date>, <reason>).

### C2. <short title>  [...]

## Floor check

Moves that lowered the bar during this batch:

| Move (1 to 7) | Where | Evidence | Candidate |
|---|---|---|---|
| <none, or the move> | | | |

Proposals in this retro that loosen the bar:

| Candidate | What loosens | Reason | Owner | Expires | Approved by |
|---|---|---|---|---|---|
| <none, or C<n>> | | | | | |

## Ratchets

| Metric | Last level (source) | This run (source) | Direction | Result |
|---|---|---|---|---|
| Atlas broken links | <n> (<previous retro>) | <n or "not measured"> (<atlas run>) | must not grow | held / worse: C<n> / better / covered by C<n> |
| Embedded workflows drifted from their standalone row | | | must not grow | |
| Config lint findings | | | must not grow | |
| Forms in each readiness grade below ready | | | must not grow | |

## Carried forward

Open loosenings:

| Candidate (retro) | Expires | Now |
|---|---|---|
| <C<n> (<retro path>)> | <date> | still needed / expired, bar restored / renewed with a new reason: C<n> |

Accepted candidates from the previous retro:

| Candidate | Landed | Fires on the original evidence |
|---|---|---|
| | yes / no | yes / no / not testable, because <reason> |

Still proposed from earlier retros:

| Candidate (retro) | Proposed on | Note |
|---|---|---|

## Misses not classified

<Each miss whose evidence was not enough to classify, and the source that would settle it.>
```

## Writing the proposed change

"Exact" means a person can accept the candidate and make the change without asking a question. By kind:

| Change | Write down |
|---|---|
| Prod-guard pattern | What it changes (the `PROD_GUARD_BLOCKED_PROCS` value where the hook runs or its default in `prod-guard.js`, or the write-verb or write-procedure pattern), the new value, and the assertions to add |
| Session-check self-test | The condition it tests, the line it prints when the condition fails, and the assertions to add |
| Verifier column | The column name, the SELECT that fills it, and what MATCH means for it |
| Atlas lint rule | The pattern, the objects it scans, and the message; if `valence-atlas` is not installed, describe the rule in words for whoever maintains it |
| `valence-playwright` check | The page, the role, the action, and the pass and fail conditions |
| Landmine line or reviewer standard | The trap, and the evidence the reviewer must see before passing it; for a brief-review standard, which reviewer's section of `valence-brief-review`'s `references/reviewers.md` it joins |
| CLAUDE.md pointer | One line: what lives where, and when to read it |
| KB note | The draft path, the note type (Why-This-Config or Do-Not-Configure), and the decision with who, when and where |
| Brief rule | The rule text for "Rules every worker follows", and who enforces it (the planner or the brief review) |

Cost decides placement. A check that adds minutes to every build belongs after the build (the verifier or the
adversary), not before every command.

## Hook test assertions

A hook change ships with assertions in the style of `agent-team/hooks/tests/`: a plain Node script, `assert` from the
standard library, a counter, one assertion per behaviour with a message saying what it proves, and a closing line
`<hook>: N assertions passed`. Add at least one positive case (the original miss is now denied) and one negative
control (the nearest legitimate command still passes), so the check neither stays silent nor blocks real work. For a
new blocked procedure the pair looks like this (placeholders, not a real procedure):

```js
// <date>_<batch>-RETRO.md, C<n>: <what the miss was>
ok(decide('sqlcmd -d CLIENT_Stage_App -Q "EXEC dbo.<NewBlockedProc>"'), 'the new blocked proc is blocked even on stage');
none(decide('sqlcmd -d CLIENT_Stage_App -Q "EXEC dbo.<NeighbourProc> 1"'), 'the nearest legitimate proc still runs on stage');
```

The test file sets `PROD_GUARD_BLOCKED_PROCS` at its top, so add the new name there too. A name on that list is
matched anywhere in the command text, so even a SELECT that only names the procedure is denied; pick the negative
control with that in mind, and write the limit into the candidate's cost so the engineer sees it.

Run the test file, record the new count in the candidate, and check that it is higher than before. A count that goes
down means an assertion was removed, which is a loosening.
