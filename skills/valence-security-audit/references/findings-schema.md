# Findings and ledger contract

The human-readable contract the two validators enforce. `scripts/validate-findings.cjs` reads
`findings.json`; `scripts/validate-ledger.cjs` reads `coverage-ledger.json`. The validators are the source of
truth; this page explains them so a hunter or verifier can produce conforming output and a reviewer can read it.
Both validators are zero-dependency, open files with a plain `fs.statSync` then `fs.readFileSync` (no
`O_NOFOLLOW`, so they run the same on Windows, where this work happens, and on Linux), cap input at 5 MiB, print
up to 100 messages each with a JSON path, and exit `0` clean, `1` on violations, `2` when they could not run
(unreadable file, not valid JSON, wrong argument count). A `2` is never allowed to read as a `0`.

Evidence cites object names, row Ids and column names, never personal-data values. Both validators fail any
string field that contains an email address, a US SSN (`###-##-####`) or a North American phone number written
with separators or brackets (`(334) 555-0142`, `334.555.0142`, `+1 334 555 0142`), because a value in the output
means the audit copied personal data out of the database. A bare run of ten digits is not flagged, so a CHECKSUM or
a large row Id is fine; nor is a number whose area code or exchange starts with 0 or 1, which no real number has.

## `findings.json`

A JSON array of records. Each record is exactly one of three verdicts, and the validator rejects any field not
listed for that verdict (`additionalProperties: false`). Records are sorted by `fingerprint` and fingerprints
are unique. The sort is ordinal (byte order), so keep fingerprints in one case convention.

### Fields on every record

| Field | Rule |
|---|---|
| `verdict` | `confirmed`, `needs_validation`, or `rejected`. |
| `fingerprint` | Matches `^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$`. Stable across states and runs; derived from the root cause and the object, never from a line number, wave, agent or verdict. |
| `title` | One line. |
| `description` | What the issue is, in plain English. |
| `attack_class` | `V1` to `V12`, or `wildcard`. |
| `trace` | Non-empty array of steps. Each step: `kind` (`entrypoint`, `propagation`, `sink`), `object_type` (enum below), `object` (name or stable key), optional `location` (e.g. a line in the definition or a JSON path), `description`. A one-step trace is an `entrypoint` or a `sink`; a longer trace starts `entrypoint`, ends `sink`, and every step between is `propagation`. |
| `evidence` | Non-empty array. Each item: `kind` (`select`, `snapshot`, `atlas`, `click_list`), `ref` (what was read: an object name, a snapshot path, an atlas note, a numbered click-list), `observed` (what it showed, citing Ids not values), `environment` (`stage`, `prod`, `snapshot`). |

`object_type` enum: `portal_page`, `page`, `tab`, `dashboard`, `widget`, `grid`, `form`, `dialog`, `launcher`,
`procedure`, `function`, `view`, `trigger`, `workflow`, `settings_row`, `lookup`, `role`, `permission`,
`user_account`, `template`, `mail_gate`, `table`, `other`.

### `confirmed` adds

- `root_cause`, `intended_behavior`, `observed_result` -- plain strings.
- `boundary` -- object with all five of `lower_trust_principal`, `action`, `intended_control`,
  `crossed_boundary`, `affected_resource`. This is the candidate gate made explicit.
- `remediation` -- `strategy`; optional `config_changes`, an array of `{ object, change }`.
- `severity` -- `likelihood` and `impact`, each `{ level, reason }` where `level` is one of `informational`,
  `low`, `medium`, `high`, `critical`; plus `overall_severity` from the same five. The validator rejects an
  `overall_severity` ranked above `impact.level`, because severity can never exceed the demonstrated impact.
- `confidence` -- `{ score, reason }`, score a number from 0 to 1.

### `needs_validation` adds

- `claimed_root_cause`.
- `blockers` -- non-empty array of strings: exactly what the snapshot and SELECT-only STAGE access cannot settle.
- `validation_plan` -- object with at least one non-empty of `stage_select` (a SELECT to run on STAGE),
  `click_list` (a numbered walk for a person), `owner_question` (a question for the engineer, PM or a
  builder-run probe). No severity; `needs_validation` is never a parking place for a speculative idea.

### `rejected` adds

- `claimed_root_cause` and `reason`. No severity, remediation, blockers or plan.

The validator also forbids a field from the wrong verdict: a `severity` on a `needs_validation` record, a
`blockers` on a `rejected` record, a `claimed_root_cause` on a `confirmed` record, and so on.

## `coverage-ledger.json`

A JSON array of units, sorted by `coverage_id`, no duplicates. A unit is one hunt target: a surface, a boundary
and an attack class. `coverage_id` must equal `surface::boundary::attack_class`, so no part may contain `::` or
lead or trail whitespace. Canonical refs are object names or stable keys (for example
`procedure:dbo.Example_Record_Get`), never identity Ids, which differ across STAGE and PROD.

| Field | Rule |
|---|---|
| `coverage_id`, `surface`, `boundary`, `attack_class` | Required. `attack_class` is `V1`..`V12` or `wildcard`. |
| `status` | `planned`, `covered`, `candidate`, `blocked`, `deferred`, `out_of_scope`, `not_applicable`. |
| `label`, `wave`, `prior_status`, `starting_objects`, `agent_id`, `checks`, `result_fingerprints`, `reason`, `hardening`, `attempts` | Optional, subject to the state rules. |

`agent_id` (on a unit, a check or an attempt) matches `^[a-z0-9][a-z0-9_-]{0,63}$` and is not a Windows device
name (`con`, `prn`, `aux`, `nul`, `com1`..`com9`, `lpt1`..`lpt9`), so an id can always become a scratch folder.

A `check` is `{ objects (non-empty), invariant, method (snapshot|select), result }`, optionally its own
`agent_id`. State rules:

| Status | Owner (`agent_id`) | `checks` | `result_fingerprints` | `reason` |
|---|---|---|---|---|
| `planned` | none | empty | empty | empty |
| `covered` | required | non-empty | empty | -- |
| `candidate` | required | non-empty | non-empty | -- |
| `blocked` | required | non-empty | empty | required |
| `deferred`, `out_of_scope`, `not_applicable` | none | empty | empty | required |

`deferred`, `out_of_scope` and `not_applicable` carry no evidence: partial work with evidence is `blocked`, not
one of these. When a coverage critic reopens a unit, its prior terminal state is archived in `attempts` (each
`{ status (covered|candidate|blocked), agent_id, checks, reassignment_reason }`, optional `wave`,
`result_fingerprints`, `reason`); every attempt and the live owner must be a different `agent_id`, because each
attempt gets a fresh hunter.

`prior_status` (additive runs) is one of `none`, `new`, `prior_confirmed_unchanged`, `prior_confirmed_changed`,
`prior_needs_validation`, `prior_blocked`, `prior_deferred`, `prior_out_of_scope`, `prior_covered_unchanged`,
`prior_covered_changed`, `prior_rejected_changed`.
