# mechanical.json and the summary

What `scripts/form-lint.cjs` writes into the pack, and what the merge reads from it. Every string in it has passed
the personal-data backstop: an email, SSN or phone pattern is replaced with `[withheld]` and counted in
`summary.withheld`. Values from the census never appear; findings cite widget ids, field names, census paths and
target.md or keyboard.md line numbers.

## Shape

```json
{
  "tool": "valence-form-lint",
  "contract": 1,
  "capture": "LIVE WALK",
  "inputs": {
    "target.md": true,
    "census.json": { "widgets": 42, "footer": 2, "captureWidth": 1280 },
    "keyboard.md": "structured",
    "client-block.md": true
  },
  "summary": {
    "critical": 1, "major": 2, "minor": 1, "advisory": 1,
    "waived": 1,
    "checks": { "finding": 5, "none_found": 16, "not_checked": 3 },
    "withheld": 0,
    "exit": 1,
    "stop": false
  },
  "owned": [ { "check": "unlabelled-field", "area": "words", "informs": "field labels" } ],
  "checks": [
    { "id": "small-target", "title": "Interactive targets are at least 24x24 px", "severity": "minor",
      "area": "responsive_accessible", "informs": "target size", "source": "U",
      "needs": ["widget.type", "widget.visible", "widget.box"], "uses": ["widget.readOnly"],
      "status": "not_checked", "findings": 0, "waived": 0, "unchecked": 18, "missing": ["widget.box"] }
  ],
  "findings": [
    { "id": "dropdown-options/ddl-county", "check": "dropdown-options", "severity": "critical", "kind": "defect",
      "area": "widget_fit", "title": "List has no options",
      "where": { "widget": "ddl-county", "census": "widgets[7]", "field": "CountyId", "section": "Address" },
      "evidence": "census widgets[7].options is 0.",
      "why": "An empty list is usually an inactive or empty lookup failing silently, ...",
      "fix": "Check the lookup rows and their active flag, and the procedure parameters, on STAGE.",
      "waived": null }
  ],
  "waivers": [
    { "check": "generic-button", "widget": "btn-save", "source": "fixed_constraint", "file": "target.md", "line": 21,
      "reason": "the client's procedure manual names this button Submit", "applied_to": ["generic-button/btn-save"] }
  ],
  "waiver_errors": [ { "file": "target.md", "line": 9, "error": "a target.md waiver must sit under the Fixed constraints heading, ..." } ]
}
```

## Fields

| Field | Meaning |
|---|---|
| `capture` | The mode on the Capture line: `LIVE WALK`, `REPLICA ONLY`, `unknown`, or null without target.md. |
| `inputs` | What the lint found to read. `keyboard.md` is `structured`, `not structured` (no walk table) or `missing`. |
| `summary` | Counts of active (unwaived) findings by severity; `waived`; check states; `exit` (0 or 1, the same as the process exit); `stop` (a staging critical: do not launch the auditor). |
| `owned` | The checks that ran over every widget they apply to (status `finding` or `none_found`, nothing unchecked), staging excepted. This list, and nothing else from the lint, goes into the auditor's prompt. |
| `checks[]` | One row per check: what it declares (`needs`, `uses`), its `status`, how many findings and waived findings it raised, how many widgets it could not check, and the field names it lacked. |
| `findings[]` | Every finding, waived ones included. `id` is `<check>/<widget, surface or place>`, with `#2` on a repeat. `kind` is `defect` or `gap`. `where` holds `widget` (and `widgets` when one finding covers several), `census` (the path in census.json), `field`, `section`, `surface`, `file`, `line`, `step` or `screenshot`, as they apply. `waived` is null or `{source, file, line, reason}`. |
| `waivers[]` | Every accepted waiver line, its source (`fixed_constraint` or `platform_limit`), its reason, and the finding ids it covered. One that covered nothing is stale; remove it from target.md or the client block. |
| `waiver_errors[]` | Every rejected `lint-waive` line, with the reason it was rejected. A rejected waiver waives nothing. |

## How the merge reads it

- `summary.stop` true: the auditor was not launched; restage.
- `owned`: the criteria the auditor gave full points to. Map each `area` and `informs` to the criterion name in the
  rubric copy.
- `findings[]` with `waived: null`: kind `gap` goes to `verify`; kind `defect` is matched against the auditor's
  findings by `where.widget` (or `where.surface`) and criterion, as SKILL.md's merge steps say.
- `findings[]` with `waived` set: added with `fixed_constraint: true` or `platform_limit: true` by `waived.source`.
- `checks[]` with status `not_checked`: nothing is added; the auditor judged those criteria.

## The console summary

```
form-lint: FAIL, 2 critical, 2 major, 1 minor, 1 advisory (1 waived); checks: 7 with findings, 15 none found, 2 not checked
  critical dropdown-options/ddl-type: List has no options
  critical error-as-empty/grd-history: Error is shown as an empty state
  major unlabelled-field/txt-notes: Placeholder is the only label
  major internal-name/txt-last: Label shows an internal name "LastName"
form-lint: not checked: small-target (widget.box); keyboard-order (widget.box)
form-lint: owned (the only lint output the auditor is given): words: field labels, ...; actions: button wording, ...
form-lint: wrote mechanical.json
```

The first line reads PASS or FAIL with the counts. A `STOP` line follows when staging failed. Up to ten critical and
major findings are listed, criticals first; the rest are counted. Rejected waivers and withheld values get a line
each when there are any. The `owned` line is the one the orchestrator copies into the auditor's prompt. On exit 2 the
only line is `form-lint: COULD NOT RUN: <reason>` and nothing is written; a `mechanical.json` from an earlier run is
left as it was, so never merge after a 2.
