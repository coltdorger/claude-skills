# Turning a note into checkable assertions

A KB note is prose written for people. A check needs a list of claims, each naming one object, one expected value or
behaviour, and a date. This page shows how to get from one to the other. Every name below is a placeholder; real
table, column and object names come from the client's atlas.

## What counts as an assertion

A sentence asserts something checkable when it says or implies that a configuration object has a value, a behaviour
or an absence. Signal words: "is", "shows", "calls", "uses", "sends", "routes", "only", "never", "must", "do not",
"we decided", "the answer is".

| Sentence type | Example shape | What to do |
|---|---|---|
| Assertion | "The <grid> shows only active records." | Extract it |
| Prohibition | "Do not configure <feature>." | Extract it with polarity "must not be" |
| Reason | "...because staff kept renewing expired records." | Keep it as context; do not check it |
| History | "Previously sorted oldest first (superseded <date>)." | Skip; check only the newest claim |
| Open question | "Q: Should <workflow> route to a supervisor?" with no answer | Skip; it asserts nothing |
| Plan | "We may later add <feature>." | Skip; no date, no decision |
| Practice | "Counter staff review each notice by hand." | Skip; no configuration holds it |

Keep the reasons. They decide the route later: a Divergence that still serves the note's reason is usually a note
update, and one that defeats it is usually a ticket.

## Steps

1. Read the whole note once. Write down its date and every date that sits beside a claim.
2. Mark each sentence: assertion, prohibition, reason, history, question, plan or practice.
3. Split compound claims. "The grid shows only active records and sorts by expiry date" is two assertions, because
   each can fail alone.
4. Name the object. A sentence that names a screen element ("the renewals grid") maps to the configuration object
   that holds the behaviour: the widget's settings row and the procedure it calls. Use the atlas for the mapping.
5. Write the expected result as something a SELECT can return: a parameter value in a widget's settings column, a
   lookup code with its active flag set, a step present or absent in workflow JSON, a permission row's flag.
6. Set the polarity: must be, or must not be.
7. Set the claim date: the date beside the claim, else the note's date, else the KB file date marked "file date".
8. Write the check and its match condition before running anything: which SELECT, on which environment, and which
   result counts as a match.
9. If step 4 finds no object, record the assertion as unanchored with a proposed anchor, and do not check it.

## Anchors by object kind

Prefer a stable key to an Id. Ids can differ between STAGE and PROD, so an Id is recorded per environment, beside the
key, never instead of it.

| Object kind | Stable key | Also record | Where the real names come from |
|---|---|---|---|
| Procedure, function, view | Schema and name | LEN and CHECKSUM of the definition, `modify_date` | `sys.sql_modules`, `sys.objects` |
| Widget or grid | Page key and widget name; then its settings row Id per environment | The procedure and parameters in its settings column | Atlas pages and widgets |
| Settings row | Table and a stable key column; Id per environment | LEN and CHECKSUM of the settings column, `Modified`, `ModifiedBy` | Atlas |
| Lookup value | Lookup type and code | Active flag; Id per environment | Atlas data model |
| Workflow | Workflow id and name; the parents that embed it | `Modified`; the step the note describes | Atlas workflows |
| Document template | Template name and field name or XSLT path | The data source that fills it | Atlas; `valence-doc-templates` if installed |
| Page, tab, dashboard | Page key or name; the tabs and roles that show it | | Atlas |
| Role, permission row | Role name; the object and the permission | The permission columns | Atlas roles and access |
| Outbound-mail gate | The gate setting's key | Its value and stamp | Atlas |

## The assertion record

```
- id: <note-slug>-A<n>
  quote: "<the sentence, short>"
  object: <kind> <stable key> (STAGE Id <id>, PROD Id <id>)
  expected: <value or behaviour>
  polarity: must be | must not be
  claim date: <YYYY-MM-DD> (claim | note | file date)
  environments: STAGE, PROD
  check: <what the SELECT reads>; match when <condition>
  status: anchored | unanchored (proposed anchor: <object>; candidates found: <n>)
```

## Worked examples

All names are placeholders. The SELECTs are outlines; write the real ones against the table and column names the
atlas gives, and read long text through a SQL client library.

### 1. Why-This-Config: a grid filter

Note, dated `<date-1>`: "The `<renewals-grid>` on `<record-page>` shows only active records. Expired ones are on the
archive tab, because counter staff kept renewing expired records by mistake."

- **A1.** Object: widget `<renewals-grid>` on `<record-page>`, its settings row. Expected: the settings column names
  `<procedure>` and passes `@<status-param>` = `<active-code>`. Check: SELECT the settings column by Id on each
  environment; match when both the procedure name and the parameter value are present.
- **A2.** Object: tab `<archive-tab>` on `<record-page>` and the grid on it. Expected: that grid passes
  `<expired-code>`. Check: as A1.
- Reason, kept as context: staff renewed expired records by mistake.
- Possible findings: the parameter is present on STAGE but absent on PROD (Environment split, and Missing on PROD);
  the procedure declares `@<status-param>` but never uses it in its WHERE clause (Incomplete, found by reading the
  definition); the grid shows every status and highlights expired rows (Divergence; it may still serve the reason, so
  recommend asking the client).

### 2. Do-Not-Configure: automatic mail

Note, dated `<date-2>`: "Do not configure automatic reminder mail for `<notice-template>`. The agency sends these by
hand after review."

- **A1.** Polarity: must not be. Object: any workflow whose JSON holds a send-mail step that uses `<notice-template>`.
  Check: a CHARINDEX search of the workflow JSON column for the template's name and its Id, on each environment, and
  a reading of every hit. Match when no hit is a live send step in a workflow that something launches (the atlas
  shows launchers and parents).
- Possible findings: a send step in a launched workflow (Forbidden; on PROD it goes first in the report); the step
  sits only in an embedded copy inside a parent (Forbidden and Embedded drift).
- Never launch the workflow or run a mail procedure to see whether it sends.

### 3. Scope decision: portal permissions

Note, dated `<date-3>`: "In scope, delivered under `<ticket>`: signed-in portal users can upload documents on
`<application-page>`. Out of scope: deleting them."

- **A1.** Object: the permission row for `<portal-role>` on `<documents-widget>`. Expected: upload allowed. Check only
  because the work is delivered; in-scope work with no LIVE log is pending, not drift.
- The out-of-scope sentence asserts nothing about configuration. If delete is live for `<portal-role>`, list it under
  "Scope flags" for `scope-check`. If a Do-Not-Configure note also forbids delete, it is a Forbidden finding instead.

### 4. Answered Open-Question: a routing threshold

Note: "Q: When should an inspection route to a supervisor? A (`<date-4>`, client project manager): when the score is
below the pass mark. The agency must be able to change the pass mark without a ticket."

- **A1.** Object: workflow `<inspection-workflow>` and every parent that embeds it. Expected: a branch that routes to
  `<supervisor-role>` when the score is below the pass mark.
- **A2.** Object: the settings row or lookup value `<pass-mark-key>`. Expected: the branch reads the pass mark from it,
  not from a literal.
- Possible findings: the JSON compares the score with a literal `<number>` (Shortcut: the decision was "editable");
  the routing lives in a second workflow launched after the first (Divergence); a parent embeds an older copy with no
  branch (Embedded drift).

### 5. Unanchored claims

- "The fee screen should feel simpler for counter staff." No object and no checkable value. Record it unanchored.
  Proposed anchor: page `<fee-page>` and its widgets as the atlas lists them. Suggest the note state the decision as
  configuration ("hide `<field>` on `<fee-page>` for `<counter-role>`, decided `<date>`"), or route the UX intent to
  `crm-ux-auditor` if installed.
- "Renewal notices are emailed to the record holder." A behaviour without an object. Search the workflow JSON for
  `<renewal-template>`. If the search finds several candidates, list them as candidates and let a person pick; check
  nothing until the anchor is in the note.

### 6. Undated and superseded claims

Note: "The `<queue-widget>` currently shows the oldest cases first. (Superseded `<date-6>`: newest first, at the
client's request.)"

- Check only "newest first", dated `<date-6>`. The older claim is history.
- If a note says "currently" with no date at all, use the note's date, mark the claim date "note date", and add the
  claim to the report's "Undated claims" list with a recommendation of the dated-claims rule.

## Before you move to the next note

- Every assertion names one object and one expected result.
- Every anchored assertion has a match condition written before its SELECT ran.
- Reasons are kept as context and not checked.
- Unanswered questions, superseded claims, plans and undelivered in-scope work produced no assertion.
- Every unanchored assertion has a proposed anchor or the words "no candidate found".

Part of `valence-intent-drift`; credits and license are in [SKILL.md](../SKILL.md#credits).
