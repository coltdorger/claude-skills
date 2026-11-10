# Review report template

Write the report next to its target: `<date>_<batch>-BRIEF-REVIEW.md` for a brief, `<date>_<ticket>-DESIGN-REVIEW.md`
for a configuration design, `<name>-REVIEW.md` for a deliverable. Add one Round section per round. Copy each finding
as the reviewer wrote it; your own words go only in the Resolutions table, so the engineer can tell the two apart.

No reviewer ever reads this file. It holds earlier rounds and your replies, which are exactly what a goldfish must not
see.

Copy everything between the two rules.

---

# Brief review: `<date>_<batch>-BRIEF.md`

- Target: `<absolute path>` · Type: batch brief | configuration design | deliverable
- Mode: full | small-ticket | deliverable · Client: `<client>` · Stage database: `<stage-db>`
- Elephant: <planner | orchestrating session> · Started: <YYYY-MM-DD>
- Final status: converged | escalated | capped, after <n> rounds

## Reading lists

<!-- What each reviewer was given, so the engineer can see what each could and could not know. The ticket text is
listed where it was given. -->

| Reviewer | Given |
|---|---|
| `scope` | target; ticket text; `<Why-This-Config>`, `<Do-Not-Configure>`, `<scope>`, `<Open-Questions>` |
| `simple` | target; ticket text; `<Why-This-Config>`; atlas notes `<paths>`; atlas folder for search |
| `cold` | the brief alone, plus the files it tells the builder to read: `<paths>` |
| `ready` | target; ticket text; atlas notes `<paths>` |
| `ground` | target; atlas notes `<paths>`; `<stage-db>` (tunnel Up at <time>) |
| `landmine` | target; ticket text; landmine list `<path>`; atlas notes `<paths>` |
| `wording` | target; ticket text; `<Open-Questions>`; `<asana-comments style, if installed>` |

## Round 1

### Reviewer status

<!-- One row per reviewer requested. A reviewer that failed, timed out, returned nothing or reported INCOMPLETE is
retried once with a new subagent; if it fails again it is "not run", with no finding counts, because it did not
review. -->

| Reviewer | Model | Stage | Status | Attempts | Blocker | Major | Nit | Note |
|---|---|---|---|---|---|---|---|---|
| `scope` | opus | 1 | completed | 1 | | | | |
| `simple` | opus | 1 | completed | 1 | | | | |
| `cold` | sonnet | 2 | completed | 1 | | | | |
| `ready` | opus | 2 | completed | 1 | | | | |
| `ground` | sonnet | 2 | not run | 2 | – | – | – | <for example: tunnel down, MFA handed to a person> |
| `landmine` | fable | 2 | completed | 1 | | | | |
| `wording` | sonnet | 2 | not requested | – | – | – | – | <for example: no draft ticket comments> |

Stage 1 stopped the round: yes (<finding ids>) | no

### Cold-builder paraphrase

<!-- Paste the paraphrase verbatim, per worker section. Then say whether it matches what you meant; a wrong
paraphrase is a Major finding under `cold`. -->

#### <worker section heading>

<paraphrase, verbatim>

Matches intent: yes | no, see `cold-1-<n>`

### Findings

<!-- Ordered Blocker, Major, Nit. The id is `<reviewer>-<round>-<n>`, assigned by you, not by the reviewer. Merged
duplicates keep every id. -->

#### `scope-1-1` · Major · worker "<section>", ticket `<ticket>`

- Finding: <as the reviewer wrote it>
- Evidence: <quote with heading, or query with database, parameters and result>
- Suggested fix: <as the reviewer wrote it>
- Also raised as: <other ids> | none

### Resolutions

<!-- One row per finding. CONTEST cites evidence the reviewer could check. ESCALATE names who decides. PROPOSE FIX
gives the exact replacement. DECLINE is for Nits only. The severity is the reviewer's and is never changed here. -->

| Id | Severity | Category | Evidence, question or replacement text | Engineer | Applied |
|---|---|---|---|---|---|
| `scope-1-1` | Major | PROPOSE FIX | In worker "<section>", replace "<old text>" with "<new text>" | accepted | yes |
| `simple-1-1` | Major | CONTEST | `<KB path>#<heading>`: "<quote>" | accepted | – |
| `landmine-1-2` | Blocker | ESCALATE | Client decision: <question>. Gate and needs-discussion line added. | confirmed | yes |
| `cold-1-3` | Nit | DECLINE | <one line of reason> | – | – |

### Round result

- Clean: yes | no, because <unsettled Blocker or Major ids, or a not-run reviewer>
- Fixes applied: <ids> | none (wording-only Nit fixes: <ids> | none)
- Churn: none | `<new id>` at the scope of fix `<id>`
- Doubt-theater check: <substantive findings this round and last, and how many were fixed or escalated>
- Next: round <n+1> with new reviewers | converged | stopped for the engineer: <reason>

## Settled findings

<!-- Carried across rounds. A settled finding raised again at the same scope is listed here and not reopened. A fixed
finding is not settled: if it comes back, reopen it in the round's findings. -->

| Id | Scope | Settled by | Round | Raised again as |
|---|---|---|---|---|
| | | contest accepted / escalated | | |

## Client decisions escalated

| Id | Ticket | Question for the client | Gate added in | Needs-discussion line added |
|---|---|---|---|---|

### Draft Open-Questions entries

<!-- For a person to add to the client's Open-Questions note; nothing here is written to the KB by the review. -->

- <ticket>: <question, in the note's format> (raised by `<id>`, <date>)

## Accepted fixes for the adversary

<!-- Optional. Give this table to the adversary with the build log, so it can check each fix was built. -->

| Fix id | Brief section | What the build log should show |
|---|---|---|

## Final status

- Status: converged | escalated | capped, after <n> rounds
- Open findings: <ids by severity> | none
- Tickets gated on client decisions: <tickets> | none
- Stamp added to the top of the brief:
  `> Brief review: <status> after <n> rounds, <date>; <k> tickets gated on client decisions; report <file>. Engineer approval: pending.`
- Engineer approval: pending | <initials>, <YYYY-MM-DD>

---

## Credits

Adapted from the report layouts in github.com/google/elephant-goldfish-model (`skills/egm-resolve`,
`agents/synthesizer.md`) (Apache-2.0, Copyright 2026 Google LLC). Modified for Valence configuration work, November
2026. License texts are in `THIRD_PARTY_NOTICES.md` at the repository root.
