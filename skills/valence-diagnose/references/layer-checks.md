# Valence layer checks

Use this tree in phase 3 to localise a failure and to turn each hypothesis into one query. Start at the layer the
symptom table points to, then walk outward. For every layer it gives how the layer fails silently, the SELECT-only
check that proves or clears it, and the `valence-atlas` operation that does the same work if it is installed.

A layer is **proven** when its check reproduces the symptom for the minimised case on its own, and **cleared** when the
check shows the layer behaves. Record either outcome against the hypothesis in the diagnosis note; a cleared layer is
progress, not a wasted query.

Names in angle brackets are placeholders. Resolve the real table and column names from the atlas or the client
CLAUDE.md, never by guessing, because a query against a guessed name fails quietly into a wrong conclusion. `sys.*`
names are SQL Server catalog views. Every check here is a SELECT; run the tunnel check first, and run each check on
the environment where the symptom was reported.

## Where to start

| Symptom | Start at | Then |
|---|---|---|
| Empty grid | 3. The procedure with exact parameters | 2, then 4 or 1 |
| Form that never saves | 5. Role and permission rows | 6, then 4 (payload comparison: loop c) |
| Workflow that does not launch | 6. Workflow: current id | 5, then 7 |
| Workflow that stalls | 6. Workflow: instance | 4, then 5 |
| Document with blank fields | 8. Template data contract | 4 |
| Notice that was never mailed | 9. Outbound-mail gate | 6 |
| Portal page an applicant cannot see | 1. Page, tab and widget | 5 |
| STAGE works, PROD does not | 7. Environment drift | whichever layer the drift points at |

## 1. Page, tab and widget: active and visible to the role

**Fails silently as** a missing tab, a widget that does not render, or a portal page that shows an empty shell. The
platform hides what a role may not see, so nobody gets an error.

**Check**
- The active flag on the page, the tab and the widget rows, and that the widget sits on the tab the user opened.
- The visibility or permission rows for the failing role on each of the three (the role side is layer 5).
- For a portal page: the page's audience setting, and the external user's link to the record (the applicant or
  licensee relationship). An external user normally sees only records linked to their own account.

**Proves** an inactive row, a missing visibility row, or no link between this user and this record. **Clears** when all
three are active, visible to the role and, for the portal, linked.

**Atlas**: impact (the page to tab to widget chain); form readiness for portal pages.

## 2. Widget settings: data source and parameter map

**Fails silently as** an empty grid when the parameter map names a parameter the procedure does not declare, passes a
value in the wrong type or format, omits one the procedure needs, or points at a renamed procedure; or when an id
inside the settings belongs to another database.

**Check**

```sql
-- The widget's settings row
SELECT Id, LEN(<settings-column>) AS Len, CHECKSUM(<settings-column>) AS Chk, Modified, ModifiedBy, <settings-column>
FROM <widget-settings-table>
WHERE Id = <widget-id>;

-- The parameters the procedure declares, to compare with the parameter map name by name
SELECT p.parameter_id, p.name, TYPE_NAME(p.user_type_id) AS TypeName, p.max_length
FROM sys.parameters AS p
WHERE p.object_id = OBJECT_ID('<schema>.<procedure>')
ORDER BY p.parameter_id;
```

`OBJECT_ID` returning NULL means the data source names a procedure that does not exist. `sys.parameters` reports
`has_default_value = 0` for every T-SQL procedure, so read which parameters are optional from the definition text.

**Proves** a name or type mismatch, a missing parameter, or a missing procedure. **Clears** when every mapped parameter
is declared with a compatible type and every parameter without a default is passed.

**Atlas**: config lint; value finder (where else this procedure or parameter is used).

## 3. The procedure with exact parameters

**Fails silently as** zero rows for the failing parameters, an error caught by TRY/CATCH and swallowed, or a run longer
than the page's command timeout, which the grid shows as empty.

**Check**

```sql
SELECT o.name, o.modify_date, LEN(m.definition) AS Len, CHECKSUM(m.definition) AS Chk, m.definition
FROM sys.sql_modules AS m
JOIN sys.objects AS o ON o.object_id = m.object_id
WHERE o.object_id = OBJECT_ID('<schema>.<procedure>');
```

Read the definition, then run the procedure with the exact parameters under loop (a)'s read-only rule, with
`SET STATISTICS TIME ON` to see how long it takes. In the text, look for a TRY/CATCH that returns nothing on error, a
filter on a status or lookup value, an INNER JOIN the failing record has no row for, a filter on the current date, and
a branch on a user or role parameter.

**Proves** zero rows, or the wrong rows, for the exact parameters, or a run past the timeout. **Clears** when the
expected rows come back quickly; the cause is then above the procedure, in layer 2 or 1.

**Atlas**: impact (who else calls this procedure, which matters before anyone changes it).

## 4. The view, function and data beneath

**Fails silently as** the record dropping out at one join or filter: a NULL join key, a missing link row, an inactive
lookup row, a status the view filters out.

**Check**

```sql
-- What the procedure reads from. Dynamic SQL is not listed here; read the definition for it.
SELECT d.referenced_schema_name, d.referenced_entity_name, o.type_desc
FROM sys.sql_expression_dependencies AS d
LEFT JOIN sys.objects AS o ON o.object_id = d.referenced_id
WHERE d.referencing_id = OBJECT_ID('<schema>.<procedure>');
```

Lift the procedure's main SELECT into a read-only script, filter it to the minimised record, and add its joins and
filters back one at a time; the step at which the row disappears names the cause. To compare a failing record with a
working one, select the same columns for each and diff them with EXCEPT in both directions.

**Proves** the join or filter that drops the record, and the column value that makes it drop. **Clears** when the
record survives every step.

**Atlas**: record tracer (the record's rows across tables); value finder.

## 5. Role and permission rows

**Fails silently as** a save that seems to do nothing, a missing button or tab, or a grid branch that returns nothing
for one role.

**Check**
- The failing user's active role memberships.
- The permission rows on the failing path (page, tab, widget, form or workflow action) for the failing role and for
  the nearest working role, diffed:

```sql
-- Rows the working role has that the failing role lacks
SELECT <object-key>, <permission-columns> FROM <permission-table> WHERE <role-key> = '<working-role>'
EXCEPT
SELECT <object-key>, <permission-columns> FROM <permission-table> WHERE <role-key> = '<failing-role>';
```

**Proves** a missing or different permission row on the failing path. **Clears** when both roles have the same rows for
the path; the cause is then usually the record, not the role.

The fix for a missing permission row is that row, through the builder and the `valence-config` gate. It is never a
broader role, and the adversary treats any permission change as a landmine.

## 6. Workflow: embedded copy, current id, instance

**Fails silently as** a launcher that does nothing or runs old behaviour, a sub-workflow that behaves differently when
its parent launches it, or an instance parked on one step for good.

**Check**
- **Current id.** Compare the workflow id that the launcher button, form or parent references with the newest active
  catalog row of that workflow. A workflow whose runtime behaviour changes gets a fresh id and the old row stays as the
  rollback, so a reference left on the old id runs the old behaviour, or nothing if that row is inactive.
- **Embedded copy against standalone row.** A parent holds an embedded copy of each sub-workflow it runs. Compare the
  copy inside the parent's JSON with the standalone row; an edit made only to the standalone row does not reach a
  parent that runs its own copy.

  ```sql
  SELECT Id, LEN(<workflow-json-column>) AS Len, CHECKSUM(<workflow-json-column>) AS Chk, Modified
  FROM <workflow-catalog-table>
  WHERE Id IN (<parent-id>, <standalone-id>);
  ```

  Then find the sub-workflow's id inside the parent's JSON and compare that block with the standalone row's JSON.
  Workflow catalog rows carry `Modified` but no `ModifiedBy`, so attribute changes from `workflow-push` history and
  session logs.
- **Instance.** For a stall, find the record's workflow instance, its current step and what that step waits for: an
  assignment to a role with no active members, a condition on a lookup value that was deactivated, a date that has not
  arrived, a sub-workflow that never returned.

**Proves** a stale id, a drifted embedded copy, or the step and condition an instance is stuck on. **Clears** when the
reference is current, the copies match and the instance moves.

**Atlas**: embedded-workflow drift; record tracer for the instance rows.

## 7. Environment drift: STAGE against PROD

**Fails silently as** STAGE working and PROD not, with no error on either.

**Check**, for every object on the failing path, on both databases, matched by name or business key because ids differ
between databases:
- LEN and CHECKSUM of the definition or settings column, plus `Modified` (and `modify_date` for modules): the
  verifier's method.
- Every id inside a settings column or workflow JSON (data source, workflow, lookup ids) resolves on PROD to the same
  named object. An id copied by hand from STAGE points at nothing, or at the wrong thing, on PROD.
- Active flags on the lookup rows the path filters on.
- The STAGE row's `Modified` against the date of the change and of the last sync. The sync detects change by
  `Modified`, so a STAGE edit that was not restamped never reached PROD.
- Data, not configuration: PROD records can sit in statuses or combinations STAGE never has. Diff the failing PROD
  record against the nearest STAGE record with the same columns.

Equal LEN and CHECKSUM is strong evidence, not proof: CHECKSUM can collide, and under a case-insensitive collation it
returns the same value for strings that differ only in case. When both match but behaviour differs, compare
`HASHBYTES('SHA2_256', <column>)` (SQL Server 2016 or later for long text) or diff the text itself.

**Proves** the object, id, flag or stamp that differs on the failing path. **Clears** when every object matches; the
cause is then in data or in the environment's own settings (the mail gate, for example, differs by design).

**Atlas**: drift watch between snapshots; sync planning.

## 8. Template data contract (documents)

**Fails silently as** a document that renders with blank fields. The merge does not fail; it fills what it finds.

**Check**
- The field names the template expects: merge fields in a Word template, element and attribute names in the XSLT's
  XPath expressions.
- The fields the template's data source returns for the failing record: run the data source under loop (a)'s
  read-only rule with the record's id, and list each field and whether it is NULL for this record.
- Compare name by name. XPath is case-sensitive, so a field that differs only in case is a different field.

**Proves** a name the data source does not return, or a NULL for this record. **Clears** when every field is returned
and populated; then look at the template's own logic, such as a condition that hides the field. A field that is NULL
for this record only is a data question, not a template one.

**Skill**: `valence-doc-templates`, if installed, for the repair once the cause is known.

## 9. Outbound-mail gate (missing mail)

**Fails silently as** a notice nobody received, with no error anywhere.

**Check**, by SELECT only. Never run anything that sends, re-queues or releases mail, on any environment. `prod-guard`
blocks the bulk-mail job everywhere and mail procedures on production, but the rule here is wider than the hook.
- Did the workflow reach its mail step for this record? (Layer 6, instance.)
- Was a mail row queued for this record and notice, with a recipient address, and what state is it in?
- What does the outbound-mail gate allow on this environment? STAGE normally holds mail on purpose, so held mail on
  STAGE is the gate working, not a defect.
- Did the record have a recipient address at the time the step ran?

**Proves** that the step never ran, no row was queued, the row has no recipient, or the gate holds it. **Clears** when
the row was queued and released by the gate. Delivery beyond the platform is a question for the client's mail
administrators: draft a comment, change nothing.
