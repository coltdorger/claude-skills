# Dependency search

Generic SELECT patterns for finding every reference to a name, a code or an id: in module definitions, in workflow
JSON (standalone rows and the embedded copies inside parents), in settings columns, and in records. They complement
the atlas impact report, which sees only what it can parse. Real table and column names come from the atlas; this page
uses placeholders and SQL Server's own catalog views.

| Placeholder | Means |
|---|---|
| `<term>` | What you search for: a procedure name, a lookup code, a workflow id, a template field name, a page key, a role name |
| `<workflow-table>`, `<workflow-id-column>`, `<workflow-name-column>`, `<workflow-json-column>` | The workflow catalog table and its columns |
| `<settings-table>`, `<settings-id-column>`, `<settings-column>` | A table that holds settings rows, its key, and the column that holds the settings text |
| `<data-table>`, `<data-column>`, `<date-column>` | A table of records, the column that holds the lookup value or id, and a date column if it has one |
| `<lookup-table>` | The table that holds the lookup's values |

## Rules for every search

- SELECT only. Run the tunnel check first. Run every search on STAGE and on PROD: production can hold consumers STAGE
  never had, and the reverse.
- Use CHARINDEX for a literal search, not LIKE. In LIKE, `_`, `%` and `[` are wildcards, and object names and codes
  often contain underscores.
- Run through a SQL client library and read the full text. The command-line tool truncates long columns, which turns a
  hit into a miss.
- Read every hit. A substring search also finds comments, longer names (`<term>_OLD`) and codes inside other codes.
  Classify each one: live reference, dead text (a comment, a disabled branch), or a different object.
- Select keys, LEN, CHECKSUM, stamps and counts. Never copy record contents: records hold the public's personal data.
- Keep text scans to configuration tables, which are small. Do not CHARINDEX-scan large record tables on a live
  production system; count record usage by key instead (section 4).
- Record each statement, the environment, the time and the hit count in the plan (section 7). A zero with no
  statement beside it proves nothing.

Search forms, from least to most noise:

| What | Search for | Why |
|---|---|---|
| A name or code in workflow JSON | `N'"<term>"'` | A JSON string value is wrapped in double quotes |
| A code in SQL text | `N'''<term>'''` | A SQL string literal is wrapped in single quotes; the doubled quote escapes it |
| A numeric id in JSON | `N':<term>,'`, `N':<term>}'`, `N': <term>,'`, `N': <term>}'` | A JSON number follows a colon and ends at a comma or brace |
| Anything | `N'<term>'` | Bare: catches everything, including the noise; read every hit |

Prefer searching a name or code to an id. A bare number matches everywhere.

## 1. Procedures, functions, views and triggers

```sql
-- Modules whose definition mentions <term>
SELECT  OBJECT_SCHEMA_NAME(m.object_id) AS schema_name,
        OBJECT_NAME(m.object_id)        AS object_name,
        o.type_desc,
        o.modify_date,
        LEN(m.definition)               AS def_len,
        CHECKSUM(m.definition)          AS def_chk
FROM    sys.sql_modules AS m
JOIN    sys.objects     AS o ON o.object_id = m.object_id
WHERE   CHARINDEX(N'<term>', m.definition) > 0
ORDER BY schema_name, object_name;
```

```sql
-- Context around the first hit, to classify it
SELECT  OBJECT_SCHEMA_NAME(m.object_id) AS schema_name,
        OBJECT_NAME(m.object_id)        AS object_name,
        SUBSTRING(m.definition, IIF(p.pos > 200, p.pos - 200, 1), 400) AS context
FROM    sys.sql_modules AS m
CROSS APPLY (SELECT CHARINDEX(N'<term>', m.definition) AS pos) AS p
WHERE   p.pos > 0;
```

This shows the first hit only. For a module with several, read the whole definition.

```sql
-- Static references the engine recorded (a complement: it misses dynamic SQL and names built from strings)
SELECT  OBJECT_SCHEMA_NAME(d.referencing_id) AS schema_name,
        OBJECT_NAME(d.referencing_id)        AS referencing_object,
        d.referenced_schema_name,
        d.referenced_entity_name
FROM    sys.sql_expression_dependencies AS d
WHERE   d.referenced_entity_name = N'<term>';
```

```sql
-- Synonyms that point at it, and modules whose text cannot be searched
SELECT name, base_object_name FROM sys.synonyms WHERE CHARINDEX(N'<term>', base_object_name) > 0;

SELECT OBJECT_SCHEMA_NAME(m.object_id) AS schema_name, OBJECT_NAME(m.object_id) AS object_name
FROM   sys.sql_modules AS m
WHERE  m.definition IS NULL;   -- encrypted: list them in the plan as "not searchable"
```

Scheduled jobs can call a procedure from outside the configuration. If you can read `msdb`, search the job steps too;
if you cannot, write "jobs not searched: no access" in the plan.

```sql
SELECT j.name AS job_name, s.step_id, s.step_name, s.database_name
FROM   msdb.dbo.sysjobs     AS j
JOIN   msdb.dbo.sysjobsteps AS s ON s.job_id = j.job_id
WHERE  CHARINDEX(N'<term>', s.command) > 0;
```

## 2. Workflow JSON

A parent that embeds a sub-workflow holds a copy of its JSON, so one search of the JSON column finds direct
references, launches and embedded copies together. Use the atlas, or the context of each hit, to tell them apart.

```sql
SELECT  w.<workflow-id-column>                 AS workflow_id,
        w.<workflow-name-column>               AS workflow_name,
        w.Modified,
        LEN(w.<workflow-json-column>)          AS json_len,
        CHECKSUM(w.<workflow-json-column>)     AS json_chk,
        (LEN(w.<workflow-json-column>)
          - LEN(REPLACE(w.<workflow-json-column>, N'"<term>"', N''))) / LEN(N'"<term>"') AS quoted_hits
FROM    <workflow-table> AS w
WHERE   CHARINDEX(N'<term>', w.<workflow-json-column>) > 0
ORDER BY workflow_name;
```

Then read the context of each hit as in section 1, with `w.<workflow-json-column>` in place of `m.definition`. If the
column is `ntext` or `text`, wrap it in `CAST(... AS nvarchar(max))`: CHARINDEX does not accept those types.

## 3. Settings columns

The atlas lists which tables hold settings rows and which column holds the text. Write one SELECT per table, joined
with UNION ALL, and read the whole statement before running it.

```sql
SELECT  N'<settings-table-1>' AS source,
        s.<settings-id-column> AS row_id,
        s.Modified, s.ModifiedBy,
        LEN(s.<settings-column>) AS settings_len,
        CHECKSUM(s.<settings-column>) AS settings_chk
FROM    <settings-table-1> AS s
WHERE   CHARINDEX(N'<term>', s.<settings-column>) > 0
UNION ALL
SELECT  N'<settings-table-2>', s.<settings-id-column>, s.Modified, s.ModifiedBy,
        LEN(s.<settings-column>), CHECKSUM(s.<settings-column>)
FROM    <settings-table-2> AS s
WHERE   CHARINDEX(N'<term>', s.<settings-column>) > 0;
```

A widget's settings row names the procedure it calls and the parameters it passes, so this search is how most widget
consumers of a procedure are found when the atlas is stale.

Without the atlas, list the long-text columns as candidates from the catalog, decide which are settings, and write the
search above by hand:

```sql
SELECT  OBJECT_SCHEMA_NAME(c.object_id) AS schema_name,
        OBJECT_NAME(c.object_id)        AS table_name,
        c.name                          AS column_name,
        TYPE_NAME(c.user_type_id)       AS type_name,
        c.max_length                    -- bytes; -1 means max
FROM    sys.columns AS c
JOIN    sys.tables  AS t ON t.object_id = c.object_id
WHERE   TYPE_NAME(c.user_type_id) IN (N'nvarchar', N'varchar', N'ntext', N'text', N'xml')
  AND   (c.max_length = -1 OR c.max_length >= 1000)
ORDER BY table_name, column_name;
```

Do not turn this list into dynamic SQL and execute it. A generated statement that nobody read is how a SELECT-only
rule gets broken, and it would scan record tables too.

## 4. Record usage

The atlas data model (or its value finder or record tracer, if installed) names the columns that hold a lookup's id or
code. Count; never list.

```sql
SELECT  N'<data-table>.<data-column>' AS holder,
        COUNT(*)            AS records,
        MAX(<date-column>)  AS latest     -- omit if the table has no date column
FROM    <data-table>
WHERE   <data-column> = <lookup-id-or-code>;
```

Records that are recent or still open mean active usage. Historical usage alone still means Contract by the inactive
flag, never a delete, because the records keep the value.

Declared foreign keys show more holders where the schema has them. Many configuration-driven schemas do not declare
them, so an empty result proves nothing.

```sql
SELECT  OBJECT_NAME(fk.parent_object_id)                          AS referencing_table,
        COL_NAME(fkc.parent_object_id, fkc.parent_column_id)      AS referencing_column
FROM    sys.foreign_keys        AS fk
JOIN    sys.foreign_key_columns AS fkc ON fkc.constraint_object_id = fk.object_id
WHERE   fk.referenced_object_id = OBJECT_ID(N'<lookup-table>');
```

## 5. Document templates

- The data contract: search the procedure or view that fills the template (section 1) for the field's column alias.
- XSLT held as text: search it like a settings column (section 3) for the field name and for its XSLT path.
- Word mail-merge templates held as binary cannot be searched with CHARINDEX. List their merge fields with
  `valence-doc-templates` if installed; otherwise open each template the atlas links to the data source and list its
  fields by hand.

## 6. Pages, tabs and roles

- Navigation edges come from the atlas: pages in tabs, tabs in roles, permission rows.
- Then search settings columns, workflow JSON and template text for the page key (sections 2, 3 and 5), because a link
  to a page can live in text that the navigation edges do not show.
- For a role: count the users who hold it (a COUNT on the user-role rows the atlas names), list its permission rows,
  and search workflow JSON for the role's name and id, since workflow steps can route to it.

## What no search sees

Say so in the plan for every object, so "zero hits" is not read as "zero consumers": reports and exports defined
outside the database, other databases on the server, integrations that call in from outside, links in mail already
sent, and staff bookmarks to a page.

## 7. Recording the result

Paste one row per search and per environment into the plan:

| Search | Environment | Statement (file or inline) | Run at | Hits | Live references | Notes |
|---|---|---|---|---|---|---|
| Modules, quoted code | STAGE | `<path or inline>` | `<YYYY-MM-DD hh:mm>` | | | |
| Modules, quoted code | PROD | | | | | |
| Workflow JSON | STAGE | | | | | |
| Settings columns | STAGE | | | | | |
| Record usage | PROD | | | | | |

A zero-usage claim for Contract needs one row for every search kind on each environment, run on the day of Contract.

Part of `valence-retire`; credits and license are in [SKILL.md](../SKILL.md#credits).
