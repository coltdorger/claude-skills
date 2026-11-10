# Configuration design template

Use this for a large or risky ticket: one that changes a workflow's runtime behaviour, a procedure other objects call,
a role or permission row, the outbound-mail gate or a template's data contract, or anything else on the client's
landmine list. Save it as `build/<date>_<ticket>-DESIGN.md` in the client folder and link it from the ticket's worker
section in the brief, so the builder and the reviewers read the same document.

How the review splits it: everything above `## Build plan` is the whole-document scope (should this change exist, and
is it the simplest safe one); `## Build plan` and below is the detailed scope (can a builder execute it without a
decision). Keep that heading exactly, because the review finds the split by it.

Writing a design deploys nothing. Read the current state with SELECT only, on STAGE, after the tunnel check. Fill
every section; where one does not apply, write "None" and say why in a clause, because a blank reads as forgotten.
The comments say what each section needs; delete them once it is filled.

Copy everything between the two rules.

---

# <ticket>: <short title>

- Client: `<client>` · Stage database: `<stage-db>` · Date: <YYYY-MM-DD>
- Status: Draft | In review | Approved

<!-- No author line: reviewers are not told who wrote the design, so the writing is judged and not the writer. -->


## Ticket and client decision

<!-- Quote the request in one or two lines. Cite the recorded decision that covers it, by note path and heading,
and quote it. If no recorded decision covers the change, stop: the design cannot be approved until one exists. -->

- Ticket `<ticket>`: "<the request, quoted>"
- Decision `<KB path>#<heading>`: "<the decision, quoted>"
- Scope: in | grey, per `<scope note>#<heading>`: "<the line, quoted>"

## Goals

<!-- What the change achieves for the client, each in terms someone could check after the build. -->

- <goal>

## Non-goals

<!-- What this change will not do, including nearby things a builder might be tempted to tidy. -->

- <non-goal>

## Current state

<!-- Every object the change touches or depends on, as read on STAGE at design time. The grounding reviewer re-reads
each one; a difference means someone changed it since. Take table names from the atlas. -->

| Object | Table and Id or stable key | Column | LEN | CHECKSUM | Modified (ModifiedBy) | Read on |
|---|---|---|---|---|---|---|
| <the widget's settings row> | `<table>` Id `<id>` | `<settings column>` | | | | `<stage-db>`, <date> |
| <procedure> | `<schema>.<name>` in `sys.sql_modules` | definition | | | `modify_date` | `<stage-db>`, <date> |
| <workflow> | `<workflow catalog table>` Id `<id>` | workflow JSON | | | `Modified` | `<stage-db>`, <date> |
| <lookup row> | `<table>` key `<stable key>` | `<value>`, active flag | | | | `<stage-db>`, <date> |

## Proposed change per object

<!-- One row per object. "Before → after" is a summary; the exact text goes in the build plan. A workflow whose
runtime behaviour changes gets a fresh id and the old row stays as the rollback. -->

| Object | Change | Before → after | Fresh workflow id? | Stamp | Worker |
|---|---|---|---|---|---|
| | | | yes / no / not a workflow | `<stamp>` | |

## Alternatives considered

<!-- At least the options that apply among: a settings row, a widget parameter or lookup row, a procedure edit, a new
workflow id. For each: what it would change, its cost to build, prove, sync and roll back, and why it was rejected.
A rejection attributed to the client cites the note. -->

### <Alternative, such as "change the widget's settings row">

- What it changes:
- Cost to build, prove, sync and roll back:
- Rejected because:

### <Alternative, such as "edit the shared procedure">

- What it changes:
- Cost to build, prove, sync and roll back:
- Rejected because:

## Landmines and gates

<!-- Each item on the client's landmine list that this change comes near, and how the design handles it. Each
Do-Not-Configure and Open-Questions entry that applies, cited, with its gate. -->

| Landmine or gate | Applies? | How it is handled | Source |
|---|---|---|---|
| Shared procedure narrowed | | | |
| Outbound-mail gate | | | |
| Permission or role rows | | | |
| Embedded sub-workflow copies | | | |
| Template data contract | | | |
| Rows the sync would carry | | | |
| <client-specific landmine> | | | `<landmine list path>` |

## Impact

<!-- From atlas impact (`valence-atlas` if installed; otherwise from the atlas notes by hand, and say so): every
caller of a changed procedure, every page, widget and grid that shows the changed data, every parent workflow with an
embedded copy, every template that reads a changed field, every role affected. -->

| Affected object | How it is affected | Proved by |
|---|---|---|

## Rollback

<!-- Per object: the pre-image path under rollback/, the rollback script, and the order to run them. For a fresh
workflow id, the old row stays: say how the launcher points back to it. Say what the rollback cannot undo (data
saved by users in the meantime, for example). -->

| Order | Object | Pre-image | Rollback script | Restores |
|---|---|---|---|---|

## Proof plan

<!-- Per change, a proof that would catch a silent failure: the procedure run with the widget's exact parameters and
the rows expected, including a case that must return rows; the saved row re-read after a form save; a numbered
click-list for portal pages only a signed-in external user can see; for a permission change, one role that gains
access and one that must not. -->

| Change | Proof | Parameters or steps | Passes when |
|---|---|---|---|

## Sync effect

<!-- Which rows get a new Modified stamp, so the environment sync will carry them; any row stamped that the ticket did
not mean to change; whether this must move with, before or after another batch. -->

## Open questions

<!-- Each unresolved item, linked to its Open-Questions entry, or drafted for a person to add. Mark each one that
blocks the build "Do not build until decided". -->

- <question> (`<Open-Questions path>#<heading>`): Do not build until decided | does not block, because <reason>

## Draft ticket comment

<!-- Plain English, four sentences or fewer, in asana-comments style if installed. Claim only what the proof plan
will show. Include a needs-discussion line for every open question. A person sends it. -->

## Build plan

<!-- The detailed scope: numbered steps a builder can follow without making a decision. Name the exact table and Id
or key, column, edit, stamp and proof parameters in each step, and say what to do if a check fails. For a
workflow-form change, capture the submitted payload before the first deploy and after each deploy. -->

1. Run the tunnel check. If the stage database is not reachable, stop and record the resume point.
2. Re-read each object in Current state. If any LEN, CHECKSUM or `Modified` differs, stop and record the deviation.
3. Save the pre-image of `<object>` under `rollback/` and write its rollback script.
4. Deploy the script in `sql/` under the brief's dated name: <the exact change>. Stamp `Modified` and `ModifiedBy`
   with `<stamp>`.
5. Re-read `<object>`: record LEN and CHECKSUM of its settings column or definition, before and after, and the stamp.
6. Prove it: <the proof from the proof plan, with its exact parameters>.
7. <next object, in dependency order>
8. Write the session log and the draft ticket comment.

---

## Credits

Adapted from the design document template in github.com/google/elephant-goldfish-model
(`skills/egm-draft/references/design_doc.md`) (Apache-2.0, Copyright 2026 Google LLC). Modified for Valence
configuration work, November 2026. License texts are in `THIRD_PARTY_NOTICES.md` at the repository root.
