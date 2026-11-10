# Intent drift report template

Copy the block below into `<client-folder>/<YYYY-MM-DD>_INTENT_DRIFT.md`. Keep the headings in this order; delete the
italic guidance lines. Report only differences: a match gets no line, only a place in the coverage counts.

Evidence rules: every finding carries the SELECT that produced it, the environment, the time it ran, and the result
limited to keys, configuration columns, LEN, CHECKSUM, flags and stamps. Never paste record contents.

---

````markdown
# Intent drift: <client>, <YYYY-MM-DD>

| Item | Value |
|---|---|
| Trigger | weekly / before the sync of <date> / after batch <batch> |
| STAGE | `<stage-db>`, read <YYYY-MM-DD hh:mm> |
| PROD | `<prod-db>`, read <YYYY-MM-DD hh:mm> (or "not read: <reason>") |
| Change window | <from> to <to> (since <previous report> / first run: last 30 days) |
| Atlas | <generated date> / not installed; drift attribution: yes / no |
| Coverage | <n> notes read, <n> assertions, <n> checked, <n> unanchored, <n> not read |

## Before the next sync

*Forbidden findings on either environment, Unlogged changes, and Environment splits that no logged batch explains.
One line each, linking to the finding below. Write "None." if there are none.*

- [<ID>](#<id>) <Category>: <one line>

## Summary

| Category | New | Still open |
|---|---|---|
| Missing | | |
| Incomplete | | |
| Shortcut | | |
| Divergence | | |
| Forbidden | | |
| Unlogged change | | |
| Environment split | | |
| Embedded drift | | |
| Undocumented | | |

## Findings by note

### <Note title> (`<note path>`, dated <YYYY-MM-DD>)

*Write "No drift detected." when this note has no difference.*

#### <ID>: <Category>, <one-line title>

- **Assertion:** `<note-slug>-A<n>` "<quote>" (claim date <YYYY-MM-DD>, <claim / note / file date>)
- **Object:** <kind> <stable key>; STAGE Id <id>; PROD Id <id>
- **Expected:** <value or behaviour; must be / must not be>
- **Observed:** STAGE: <value>. PROD: <value>.
- **Evidence:**

  ```sql
  -- STAGE <stage-db>, <YYYY-MM-DD hh:mm>
  SELECT ...
  ```

  Result: <keys and configuration columns only>

  ```sql
  -- PROD <prod-db>, <YYYY-MM-DD hh:mm>
  SELECT ...
  ```

  Result: <...>

- **Attribution:** `Modified` <stamp>, `ModifiedBy` <value>; logged in <session log path> / not logged / atlas
  attribution: <session or "none">
- **Status:** new / still open since <previous report date>
- **Recommendation:** update the note / open a ticket / ask the client, because <one sentence>.
- **Draft note change** *(if recommended; goes through the KB ingestion path, not edited by this run)*:

  > As of <YYYY-MM-DD> (Modified <stamp> on <environment>), <object> <claim>. Supersedes the claim of <old date>.

- **Draft ticket** *(if recommended; four sentences or fewer, client comment style, for a person to post)*:

  > <draft>

## Expected splits

*STAGE and PROD differ because a logged batch has not synced yet. Not counted as drift; listed so the reader sees
what the next sync will carry.*

| Object | STAGE | PROD | Logged batch or ticket | Carried by the next sync |
|---|---|---|---|---|

## Undocumented changes in the window

*Grouped by `ModifiedBy`, one line per ticket or stamp.*

| `ModifiedBy` | Objects (count and kinds) | Logged session | Note that should explain it (proposed) |
|---|---|---|---|

## For a person to resolve

### Unanchored assertions

| Assertion | Note | Quote | Proposed anchor | Candidates found |
|---|---|---|---|---|

### Contradictions between notes

| Claim in note A (date) | Claim in note B (date) | Objects | Question to ask |
|---|---|---|---|

### Scope flags

*Out-of-scope features found live. Route each through scope-check; none is counted as drift.*

| Feature | Note | Object | Environment | Evidence |
|---|---|---|---|---|

### Undated claims

*Claims with no date beside them. Recommend the dated-claims rule: every "currently / now / is" claim carries a date
or a Modified stamp, and old claims are superseded, not rewritten.*

| Note | Quote | Date used for this run |
|---|---|---|

## Not read

| Note or object | Environment | Reason (tunnel down, read not permitted, not found by key, truncated read) |
|---|---|---|

## How this report was made

SELECT only on both environments. No note or configuration object was edited. Nothing was posted, sent or synced.
Every remedy above is a draft for a person to accept or reject.
````

---

Part of `valence-intent-drift`; credits and license are in [SKILL.md](../SKILL.md#credits).
