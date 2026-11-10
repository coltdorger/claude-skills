# Score sheet template

Save the sheet as `SCORE-SHEET.md` in the bench folder, `<scratch>/skill-tests/<skill>/<date>/`. Fill it as the runs
come back, because an excuse copied at the time is data and one remembered later is a paraphrase. Write `none` or
`not run` rather than deleting a section. Every count comes from the `runs/` files named in it; never estimate one.

Quote subjects word for word, but only from made-up fixtures: if a quote holds a real name, record, host or finding,
the fixture leaked something, so stop and fix the fixture before going on. Transcripts stay in the bench; the sheet
carries letters, counts and short quotes.

## Template

````markdown
# Skill test: <skill>, <date>

Skill version: commit <short hash> (last change to skills/<skill>/); checksums of the copied files: <file: checksum>
Bench: <scratch>/skill-tests/<skill>/<date>/    Run from outside every client folder and this repo: yes
Subject: <agent type, or "general subagent, limit stated in prompt">; tools Read, Grep, Glob; prod-guard installed: yes
Tier: <model> (the tier that runs this skill for real, because <reason>)
Arms: control (no skill) | treatment (skill) | <variant arms, if any>
Answer keys kept out of the bench and the prompts: yes

## Pressure scenarios

### <id>. <title>
Right letter: <letter>    Section tested: <heading>    Pressures: <list>

| Run | Arm | Letter | Right | Why, word for word | Sections cited | Files read | Void |
|---|---|---|---|---|---|---|---|
| 1 | control | | | | | | no |
| ... | | | | | | | |
| 1 | treatment | | | | | | no |

| Arm | Right | Distinct letters | Distinct reasons | Section cited (treatment) |
|---|---|---|---|---|
| control | <n>/<runs> | <n> | <n> | n/a |
| treatment | <n>/<runs> | <n> | <n> | <n>/<runs> |

Outcome: skill works | already followed | does not bind | makes it worse
Excuses seen (each with its count): <"...": n>
Decision: keep | cut candidate (to the owner) | fix (see Fixes) | re-run with a stronger scenario (<why>)

## Quiz

| Question | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 | Quote found in the skill |
|---|---|---|---|---|---|---|
| 1 | right / wrong | | | | | yes / no / partly |

Questions answered wrong with a real quote (a contradiction or unclear section): <numbers, and the section>

## Technique test: <case pack>

| Run | Arm | Planted flaws caught (ids) | Missed (ids) | False positives (decoy ids) | Process failures | Void |
|---|---|---|---|---|---|---|
| 1 | control | | | | | no |
| 1 | treatment | | | | | no |

| Arm | Flaws caught, mean and range | False positives, mean and range | Runs with a process failure |
|---|---|---|---|
| control | | | |
| treatment | | | |

Flaws no treatment run caught: <ids, and the section that should have caught them>

## Description A/B (only for that test)

| Request | Arm | Runs | Right skill chosen | Body read | Body-only steps present, per run | Neighbour request routed away |
|---|---|---|---|---|---|---|
| <request 1> | A (current) | 5 | | | | n/a |
| <request 1> | B (triggers only) | 5 | | | | n/a |
| <neighbour request> | A | 5 | n/a | n/a | n/a | |

Separation: B above A in most runs | A above B in most runs | overlap (tie, keep the house style)

## Fixes

### Fix <n>: <scenario or test ids>
- Failure class: skipped under pressure | wrong output shape | missing element | condition-dependent
- Form chosen: prohibition with excuse table and red flag | positive recipe | required template slot | conditional
- Change, exact text and where: <section of SKILL.md or reference>
- Re-run of every test after the fix: <ids, with the treatment result for each>
- Meta-test answer, word for word: <...> -> clear but ignored | should have said X | did not see section Y

## Stop check

| Scenario | Right in every treatment run | Section cited | Meta-test says clear | New excuses or hybrids seen |
|---|---|---|---|---|
| <id> | yes / no | yes / no | yes / not run | none / <...> |

Result: sound under these tests | not yet (<what is open>)

## For the owner
- Cut candidates: <rules, with the scenario that showed the control already follows them, or none>
- Proposed edits: <path of the proposed text, or none>; nothing in the repo was edited
- Limits of this run: <tier, number of runs, scenarios not yet written, anything the menu fixture approximated>
````

## Filling it in

- **Void runs.** A control that read the skill, or any subject that opened a file outside its prompt, is void. Keep
  the row with `void: yes` and the reason, then add a replacement run, so the sheet shows how often isolation failed.
- **Right.** Score the letter against the answer key alone. A right letter with reasoning that contradicts the skill
  still counts as right, but copy the reasoning: it is the next scenario to write.
- **Distinct reasons.** Group the "Why" texts by the reason they give, not by wording. Five runs giving one reason
  mean the text binds; five reasons mean it does not, even when the letters agree.
- **Outcome.** Read it from the table in the skill's "Read the outcome" section. A treatment arm of 4 out of 5 is not
  a pass; treat it as "does not bind" and look at the odd run first.
- **Cut candidates.** Never a safety rule the repo's conventions require every skill to restate, and never on a
  scenario with fewer than three pressures.
