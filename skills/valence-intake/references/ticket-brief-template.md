# Ticket brief template

A ticket brief is the contract a builder works from. The ticket text and its comments are context; the brief is what
the build must satisfy. It lives at `intake/<ticket>_TICKET-BRIEF.md` in the client folder, and the planner's worker
section names it as the triage note to read before writing anything.

## Principles

### Durable over precise

A brief can wait days or weeks for a batch. Meanwhile STAGE changes, another batch may touch the same objects, and a
workflow whose runtime behaviour changes gets a fresh id. Write the brief so it stays true:

- Name every object by name or stable key (table below), never by a hand-written id. Ids differ between STAGE and
  PRODUCTION, and a workflow's id changes with every runtime change, so a copied id points at the wrong row or at
  nothing.
- No line numbers in a procedure definition and no positional references ("the third widget"); both go stale.
- Date every piece of evidence and name the environment it came from (`<stage-db>` or `<prod-db>`).

### Behavioural, not procedural

Describe what a user or a query can observe after the change, not the steps to get there. The builder chooses how,
inside the batch brief's rules, and explores the live system fresh.

- Good: "The Inspections grid on the Facility dashboard lists only active inspections, newest first."
- Bad: "Add an active-flag filter to the grid's procedure at line 40."

### Every criterion has its proof

Each acceptance criterion is checkable on its own and names how it is proven, using the builder's three proof types:

| Proof | Use for | Write down |
|---|---|---|
| Database proof | Anything a query or a procedure shows | The query or procedure, the exact parameter values, the expected rows before and after |
| Browser proof | Back-office pages a staff user sees | The page and how to reach it, the role signed in, what must be seen |
| Click-list | Pages only a signed-in external user reaches | Numbered steps for a person; unproven until a person runs them |

If `valence-playwright` is installed, name the check that turns the silent failure (an empty grid, a form that never
saves) into a pass or a fail.

### Explicit scope

"Out of scope" names the adjacent changes the builder must not make. It stops gold-plating, and it keeps the
fixed-price boundary visible to the builder, who otherwise only sees the ticket.

## Naming objects

| Object | Name it by |
|---|---|
| Page, tab, dashboard | Its name as shown and where it sits in the menu |
| Widget or grid | Its title and the page it sits on; resolve its settings row from the atlas |
| Procedure, function, view | Its schema-qualified name |
| Lookup row | The lookup list's name and the row's code or display value |
| Workflow | Its name; for an embedded sub-workflow, the parent workflow's name as well |
| Form, dialog, portal page | Its name and how a user opens it |
| Document template | Its name and the merge fields it uses |
| Role or permission | The role name and the object it grants on |

If an object has no stable name, write how to find it (the atlas note, or the value-finder search) instead of an id.

## Template

```markdown
# Ticket brief: <ticket>, <short title>

**Ticket:** <ticket>, raised <date>   **Intake:** <date>, <engineer>
**Category:** defect | change request
**State:** <state>, recommended <date>, confirmed by <engineer> <date>
**Summary:** <one line: what must be true after the work>

## Current behaviour
<what happens now, in the user's terms>
Evidence: <query or observation, its parameters, environment, date, result>

## Desired behaviour
<what a user or a query observes after the work, including edge cases and empty states>

## Key objects
- <object, by name or stable key>: <what changes and why>. Exists on STAGE: confirmed <date>.

## Acceptance criteria
- [ ] <criterion>. Proof: database | browser | click-list: <exact parameters, page and role, or steps>.

## Client decision cited
- <decision>: decided by <who>, <date>, in <link to the Open-Questions note, meeting note or comment>.
(Or: "None needed", with the reason no client-visible choice is involved.)

## Out of scope
- <adjacent change that must not be made>

## Open questions
- <question>: blocking | non-blocking, because <reason>. Owner: engineer | client.

## Intake record
- Duplicate check: looked in <value finder for "...", earlier tickets, "Prior requests" lists>; found <none | link>.
- Prior-rejection check: read <notes>; <no match | matched <note>, resolved how>.
- Verification: <confirmed | not reproduced | already as requested | not enough detail>; evidence above.
- Why a person (ready-for-human only): <MFA step | page only a signed-in external user reaches | judgment call>.

## Draft comments
<intake notes, decline or already-built comment, for a person to post>
```

## Illustrative example

Invented for illustration; it describes no client system.

```markdown
# Ticket brief: <ticket>, Withdrawn status for applications

**Ticket:** <ticket>, raised <date>   **Intake:** <date>, <engineer>
**Category:** change request
**State:** ready-for-agent, recommended <date>, confirmed by <engineer> <date>
**Summary:** Staff can mark an application as withdrawn by the applicant, and the status shows everywhere statuses do.

## Current behaviour
The Application Status lookup list has no withdrawn value, so staff close withdrawn applications as Denied.
Evidence: SELECT of the list's rows by list name on <stage-db> and <prod-db>, <date>: no row whose display value
contains "Withdrawn", active or inactive.

## Desired behaviour
"Withdrawn by applicant" is an active status staff can choose on an application. The Applications grid's status
filter offers it. Applicants see it on the portal's My Applications page. Existing applications keep their status.

## Key objects
- Lookup list "Application Status": one new active row, display value "Withdrawn by applicant". Exists on STAGE:
  list confirmed <date>.
- Applications grid on the Licensing dashboard: its status filter reads the lookup list; no change expected.

## Acceptance criteria
- [ ] The list has exactly one active row "Withdrawn by applicant". Proof: database: SELECT the list's rows by list
      name on <stage-db>.
- [ ] The grid's status filter offers the new value. Proof: browser: Licensing dashboard, signed in as <staff role>.
- [ ] Existing applications keep their status. Proof: database: count of applications per status before and after
      the deploy, same query; every existing status keeps its count.
- [ ] An applicant sees the new status. Proof: click-list: sign in as a test applicant whose application staff set
      to the new status; open My Applications; the status reads "Withdrawn by applicant".

## Client decision cited
- Wording "Withdrawn by applicant": decided by <client role>, <date>, in <link to the Open-Questions note>.

## Out of scope
- Moving applications to the new status automatically.
- Renaming any other status.

## Open questions
- None.
```

A brief that fails:

```markdown
<ticket>: fix statuses
Add id 4471 to the lookup table and update the grid proc, see line 88. Client is fine with it.
```

It has no category, state or summary; a hand-written id that differs between databases; a line number that goes
stale; steps instead of behaviour; "client is fine with it", which names no who, when or where; no acceptance
criteria and no proof; and no out of scope.

## Intake board

`intake/<date>_INTAKE.md` is what the planner receives instead of the one-line ticket list.

```markdown
# Intake board, <date>

| Ticket | Title | Category | State | Brief | Waiting for |
|---|---|---|---|---|---|
| <ticket> | <title> | change request | ready-for-agent | intake/<ticket>_TICKET-BRIEF.md | a planner batch |
| <ticket> | <title> | defect | needs-info | intake/<ticket>_TICKET-BRIEF.md | client: which record (draft comment ready) |
| <ticket> | <title> | change request | needs-client-decision | intake/<ticket>_TICKET-BRIEF.md | questionnaire <path>, sent <date> or not yet sent |
| <ticket> | <title> | change request | out-of-scope (recommended) | intake/<ticket>_TICKET-BRIEF.md | engineer: confirm the scope-check verdict |
```

Each state is the one the engineer confirmed. A recommendation not yet confirmed carries "(recommended)", and the
planner skips that row.

## Draft comments

All are drafts for a person to post, in the `asana-comments` style if installed.

Intake notes, for `needs-info`:

```
Intake notes

What we have established so far:
- <point>

What we still need from you:
- <one specific fact: which record, which user, which date, what the screen showed>
```

Keep everything already settled under "established", so it is not lost or asked again. Each question names exactly
what is needed; "please send more information" is not a question.

Already built:

```
This already works: <where it lives and how a user reaches it>. If what you see is different, could you tell us
<the one fact that would show the difference>?
```

Decline, only after the engineer confirms out-of-scope: short and plain, citing the scope note's reason in one
sentence, in the wording the engineer approves.
