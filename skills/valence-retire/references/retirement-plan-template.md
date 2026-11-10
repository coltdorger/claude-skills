# Retirement plan template

Copy the block below into `<client-folder>/build/<YYYY-MM-DD>_<object>-RETIRE-PLAN.md`. It is the planner's input:
each phase becomes its own ticket or worker section with its own ownership rows, so Expand, each Migrate unit and
Contract never share a section, a ticket or a sync. Keep the headings; delete the italic guidance lines.

---

````markdown
# Change or retire: <object kind> <stable key>, <YYYY-MM-DD>

| Item | Value |
|---|---|
| Object | <kind> <stable key>; STAGE Id <id>; PROD Id <id> |
| Change | retire / change its observable behaviour: <one sentence> |
| Requested by | <ticket> |
| Replacement | <object>, proven on STAGE <date> (<evidence path>) / not built yet (built in Expand) |
| Deprecation | advisory: KB note <path>, <date> / compulsory: client decision <note path>, <date>, removal by <date> |
| Scope | scope-check: in / out / grey, citing <contract or note> |

## 1. Deciding questions

| Question | Answer | Evidence |
|---|---|---|
| Who depends on it? | <n> consumers (section 3); <n> hits not yet identified | Section 7 |
| What does it observably promise? | Section 2 | |
| Is a replacement in place and proven? | | |
| What does keeping it cost? | | |
| Who migrates the consumers? | Churn rule: <who>. scope-check: <result> | |

*Contract cannot be planned while any hit is unidentified or the migration is out of scope with no client decision.*

## 2. Observable promise

*Every surface a consumer can see. A surface not listed here is not re-proved.*

| Surface | Current value | Consumers that read it | Kept by the replacement? |
|---|---|---|---|
| Result column <n> | `<column>` <type> | | |
| Parameter | `@<param>`, position <n>, default <value> | | |
| Lookup code | `<code>`, display text "<text>" | | |
| Template field | `<field>` / XSLT path `<path>` | | |
| Side effect | sends <template> mail / sets <status> | | |

## 3. Consumers

| # | Consumer | Kind | How it uses the object | Environments | Migrate unit | Proof |
|---|---|---|---|---|---|---|
| C1 | Widget `<widget>` on `<page>`, settings row Id <id> | widget | calls it with `@<param>` = `<value>` | STAGE, PROD | M1 | procedure run with these exact parameters; rows before and after |
| C2 | Workflow `<workflow-id>`, step `<step>` | workflow | branches on `<code>` | STAGE, PROD | M2 | form save; record state before and after |
| C3 | Template `<template>` | template | merge field `<field>` | PROD only | M3 | document render; every field checked |

Unidentified hits: *list each with its search row in section 7, or "None".*

## 4. Phases

### Phase 1: Expand (`<ticket-E>`)

- Objects owned: <new objects only>
- Change: <what is added beside the old; nothing old is touched>
- Stamp: `Modified` / `ModifiedBy` = `<ticket-E>`
- Pre-image and rollback: under `rollback/`; the rollback removes the added objects only
- Proof: LEN and CHECKSUM of every old object equal its pre-image; the new object proven with C<n>'s exact parameters
- Gates: <Do-Not-Configure and Open-Questions notes that apply>
- Sync: alone, sync <n>

### Phase 2: Migrate (one unit per consumer)

| Unit | Ticket or section | Consumer | Change | Stamp | Pre-image and rollback | Proof | Sync |
|---|---|---|---|---|---|---|---|
| M1 | `<ticket-M1>` | C1 | repoint to <replacement> | `<ticket-M1>` | `rollback/...` | as C1 | after Expand has synced |

*A Migrate unit that fails its proof is rolled back alone; the others carry on.*

### Phase 3: Contract (`<ticket-C>`)

- Preconditions: every Migrate unit released by the adversary and synced; the section 7 searches re-run on the day of
  Contract on both environments with zero live references; for any delete, the client decision recorded at <note path>.
- Change: inactive flag / left in place, unreferenced and marked deprecated / old workflow row kept as the rollback /
  delete (only with the recorded decision)
- Objects owned: <the old object only>
- Stamp: `Modified` / `ModifiedBy` = `<ticket-C>`
- Pre-image and rollback: under `rollback/`; for a flag, the rollback sets it back
- Proof: the re-run searches; every consumer re-checked once more after the change
- Workflow backup: `workflow-push` run before Contract (workflows only)
- Sync: alone, after every Migrate sync

## 5. Sync order

| Order | Phase or unit | Earliest sync | Hold if |
|---|---|---|---|
| 1 | Expand | next sync | any old object's LEN or CHECKSUM moved |
| 2 to n | Migrate units | after Expand has synced | that unit's proof failed or is held |
| last | Contract | after every Migrate unit has synced and been proven on the target | any live reference found on the day |

## 6. Client decisions needed

| Decision | Why it is the client's | Draft question | Status |
|---|---|---|---|
| Delete rather than deactivate | Irreversible; records may hold it | <draft> | open |
| Removal date (compulsory deprecation) | Forces every consumer to move by a date | <draft> | open |
| Migration in scope | Fixed price | <draft> | open |

## 7. Dependency search evidence

*One row per search kind and environment, from the dependency-search reference. Re-run on the day of Contract.*

| Search | Environment | Statement | Run at | Hits | Live references | Notes |
|---|---|---|---|---|---|---|

Not searchable, or outside every search: *encrypted modules, scheduled jobs without access, outside reports, other
databases, integrations, links in mail already sent.*

## 8. For the planner and the adversary

- One worker section per phase, and per Migrate unit where two units would touch the same object. Contract alone.
- Ownership rows: copy each phase's "Objects owned". No object appears in two phases' ownership.
- Landmines for the adversary: the section 2 promise list and the section 3 consumer list, so the audit re-checks
  every consumer and not only the changed object.
````

---

## KB deprecation note (advisory)

Route it through the KB ingestion path; do not write the KB directly.

```markdown
**Deprecated <YYYY-MM-DD>:** <object kind> <stable key>. Replacement: <object>. Reason: <one sentence>.
Removal: none set (advisory) / <date>, client decision <note path>. New consumers use the replacement.
Consumers still on the old object: <n>, listed in <plan path>. Supersedes nothing; earlier claims about this object
stay as they are.
```

Part of `valence-retire`; credits and license are in [SKILL.md](../SKILL.md#credits).
