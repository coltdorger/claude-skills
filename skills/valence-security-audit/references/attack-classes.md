# Attack classes for a Valence configuration audit

Twelve classes plus a wildcard. Each names the invariant a hunter checks, what to look at (SELECT-only, in
Valence artifacts and the snapshot), the evidence to cite, and the common false positives. A hunter is assigned
units, not a whole class; the parent copies the relevant blocks into the hunter prompt in full, and lists the
excluded blocks with a reason so the hunter does not re-hunt them.

Resolve real object and table names from the atlas; this file uses generic descriptions ("the widget's settings
row", "the portal detail procedure") because names are client-specific. A finding needs a reachable boundary
violation, not a missing best practice: a checklist gap with no crossed boundary is a hardening note.

Upstream's code, binary, browser and protocol classes are dropped. The Valence platform owns those; the audit
reviews one client's configuration, not the engine. Where only platform behaviour would settle a point, the
record is `needs_validation` with an owner question, never a confirmed finding.

## V1 Portal exposure

- **Invariant:** an anonymous portal user reaches only what the client intends to publish.
- **Check:** every portal page, dialog and widget reachable before sign-in; the procedures they call and what
  parameters the page supplies versus what the procedure filters on; grids and exports on anonymous pages; a
  lookup or settings read that leaks internal configuration.
- **Evidence:** the portal page and widget names, the procedure name and the parameter map, a snapshot of the
  definition, a numbered click-list for anything only the live portal shows.
- **False positives:** a page that looks anonymous but sits behind a sign-in redirect; data the client has
  decided is public (confirm against the scope and Why-This-Config notes).

## V2 Applicant isolation

- **Invariant:** every portal read or write ties the record to the signed-in user.
- **Check:** for each portal read or write, whether the procedure joins the record to the signed-in person or
  trusts an Id from the page. Compare siblings: list, detail, download and save for the same record often take
  different paths, and one may bind while another does not. Check inactive or ended relationships: a procedure
  that joins on the relationship table but ignores the active flag still returns ended records.
- **Evidence:** the four sibling procedures, the WHERE or JOIN that binds (or its absence), a click-list run by
  a person with the client-provided dummy accounts A and B showing A reaching B's record by Id.
- **False positives:** binding enforced one layer up (a page filter or a view) that the procedure relies on;
  confirm the control is actually on the path, not merely present somewhere.

## V3 Roles and permissions

- **Invariant:** every path to a state change checks the right permission for the right principal.
- **Check:** a weaker permission on another path to the same change (a dialog gated, its procedure callable
  from a widget that is not); broad grants to a role that should be narrow; test, demo or consultant accounts
  with admin rights left enabled; a permission row that grants more than its label implies.
- **Evidence:** the two paths and the permission each checks, the role and permission rows (names and the
  active flag), the account rows by login name, never by person.
- **False positives:** a second check downstream that still blocks the action; a broad grant the client
  accepted in writing.

## V4 Dynamic SQL

- **Invariant:** no untrusted value reaches `EXEC` or `sp_executesql` unparameterised.
- **Check:** parameters, settings values and stored row values that build a statement string; whether the value
  is parameterised, allow-listed or wrapped in `QUOTENAME`; second-order values an applicant entered earlier
  that a later procedure concatenates; `EXECUTE AS` that widens the context around the dynamic statement.
- **Evidence:** the procedure or function name, the definition lines that build and run the string, the source
  of each concatenated value traced back to an entry surface.
- **False positives:** a value limited to a fixed list of column or table names and quoted; a statement built
  only from constants; a parameter that is passed, not concatenated.

## V5 Workflow integrity

- **Invariant:** a workflow cannot be driven into a state its design forbids.
- **Check:** skipping a required step; self-approval (the same principal submits and approves); replaying a
  transition after a final status; a transition condition that reads an applicant-editable field; a guard that
  differs between a parent workflow's embedded copy of a sub-workflow and the standalone sub-workflow row (they
  drift). A workflow whose runtime behaviour changed should have a fresh id; an old launchable row is wildcard
  territory too.
- **Evidence:** the workflow id and name, the JSON path of the activity or condition, the embedded versus
  standalone comparison, the field the condition reads and who can edit it.
- **False positives:** a guard enforced by a separate permission check; a step that looks skippable in the JSON
  but is gated by the launcher.

## V6 Templates and exports

- **Invariant:** a document or export holds only data its recipient may see, and user text cannot inject markup.
- **Check:** a Word mail-merge or XSLT template, or a grid export, whose data contract pulls a field the
  recipient should not see; `disable-output-escaping="yes"` over a user-entered field in an XSLT template.
- **Evidence:** the template name and the field in its data contract, the procedure that fills it, the XSLT
  element with the escaping flag.
- **False positives:** a field present in the contract but never populated for this recipient class; an export
  gated to staff only.

## V7 Outbound mail

- **Invariant:** mail leaves only when the per-environment gate allows it, to the intended recipient, once.
- **Check:** the gate setting per environment; procedures that send or queue mail without reading the gate;
  recipients taken from an editable field rather than a bound relationship; a retry path that can send twice.
  Never EXEC a mail procedure during an audit; reason from the definition.
- **Evidence:** the mail gate settings row (name and value per environment), the sending or queueing procedure,
  the recipient's source field, the callers of the procedure from the atlas.
- **False positives:** a procedure that reads the gate before sending; a queue the platform mail sender
  re-checks the gate for (confirm with an owner question, not an EXEC).

## V8 Derived copies

- **Invariant:** a copy of a record is no more visible than the record.
- **Check:** history, error, queue and import tables that hold a copy with weaker access; a soft-deleted or
  inactive record still returned by a read path that ignores the status flag; a staging table an export reads.
- **Evidence:** the copy table and the read path, the status column the path ignores, a count of rows a
  lower-trust path returns.
- **False positives:** a copy table only staff can reach; a read that does honour the status flag.

## V9 Portal identity linking

- **Invariant:** linking an account to a person, license or business proves the claim.
- **Check:** a link procedure that matches on a guessable value (a license number, a case number) with no
  secret or confirmation; a delegate-removal path that another delegate can call for an unrelated account.
- **Evidence:** the link procedure and the matched columns, whether the match value is guessable or sequential,
  the delegate-removal path and what it checks.
- **False positives:** a match that also requires a secret the client issues out of band.

## V10 Change trail

- **Invariant:** a change to a security-relevant row is attributable.
- **Check:** a write path that does not stamp `Modified`/`ModifiedBy`; rows with an unknown or service-account
  `ModifiedBy` where a person is expected; a disabled trigger that should stamp or audit. Usually a hardening
  note, because a missing stamp is not itself a boundary violation -- unless it hides an unauthorised change,
  which raises it.
- **Evidence:** the write path, the stamp columns before and after, the trigger's enabled state.
- **False positives:** a batch job that legitimately stamps a service account; a stamp set one layer up.

## V11 Secrets and obvious things

- **Invariant:** no credential or dangerous primitive sits in configuration.
- **Check:** credentials in settings rows, procedure or function bodies, or templates; `xp_cmdshell` or
  `OPENROWSET` in a definition; a debug or verbose setting left on in an environment.
- **Evidence:** the settings row or definition and the line, the environment the debug flag is on in. Cite the
  setting name and that a secret is present; do not copy the secret value into the output.
- **False positives:** a placeholder or empty setting; a debug flag off in the environment that matters.

## V12 Environment drift

- **Invariant:** security-relevant rows match between STAGE and PROD, or differ only as intended.
- **Check:** compare the mail gate, roles, permissions, debug settings and feature flags between environments
  (only if the client allows PROD reads, and only SELECT). A control on in one and off in the other is drift.
- **Evidence:** the row and its value in each environment, by stable key, not identity Id.
- **False positives:** a difference the client intends (a test flag on in STAGE only); confirm against the
  scope notes.

## Wildcard

- **Invariant:** the audit finds boundary violations outside the twelve classes.
- **Check:** legacy but still launchable workflows; orphan buttons; widgets pointing at dropped procedures;
  half-finished or compatibility configuration that got the least review. Keep the same bar: a reachable
  boundary violation with a concrete result, not a tidiness note.
- **Evidence:** the launchable object, what it reaches, and the observed or owner-observable result.
- **False positives:** a dead button that reaches nothing; a legacy workflow no launcher points at.
