'use strict';
// Run: node agent-team/hooks/tests/prod-guard.test.js
process.env.PROD_GUARD_EXEMPT = 'SANDBOX_Prod_App';
process.env.PROD_GUARD_BLOCKED_PROCS = 'DBMailItem_QueueAllPending';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { decide, referencedText } = require('../prod-guard.js');

let n = 0;
const ok = (v, msg) => { assert.ok(v, msg); n++; };
const none = (v, msg) => { assert.strictEqual(v, null, msg); n++; };

none(decide('sqlcmd -S x -d CLIENT_Stage_App -E -C -W -Q "UPDATE dbo.X SET a=1"'), 'stage write is allowed');
none(decide('sqlcmd -S x -d CLIENT_Prod_App -E -C -W -Q "SELECT TOP 5 * FROM wf.Instance"'), 'prod read is allowed');
ok(decide('sqlcmd -S x -d CLIENT_Prod_App -E -C -W -Q "UPDATE dbo.X SET a=1"'), 'prod UPDATE is blocked');
ok(decide('sqlcmd -S x -d CLIENT_Prod_App -Q "CREATE OR ALTER PROCEDURE dbo.P AS SELECT 1"'), 'prod CREATE OR ALTER is blocked');
ok(decide("$c.ConnectionString='Server=x;Database=CLIENT_Prod_App'; $cmd.CommandText='EXEC dbo.DocketCloseApply 1'"), 'prod EXEC ...Apply is blocked');
ok(decide('sqlcmd -d CLIENT_Stage_App -Q "EXEC dbo.DBMailItem_QueueAllPending"'), 'a blocked proc is blocked even on stage');
ok(decide('powershell -c "Invoke-Sqlcmd -Database Other_Prod_Db -Query \'DELETE FROM t\'"'), 'any _Prod_ name counts');
none(decide('ls -la'), 'unrelated command allowed');
none(decide(undefined), 'missing command allowed');
none(decide(''), 'empty command allowed');
none(decide('sqlcmd -d CLIENT_Prod_App -Q "SELECT Name FROM dbo.WorkflowJob WHERE Name LIKE \'%Status Change%\'"'), 'a read with no write verb is allowed');

// Hardening: SELECT INTO, mail and save procs, GRANT, and script files named on the command line.
ok(decide('sqlcmd -d CLIENT_Prod_App -Q "SELECT * INTO dbo.Bk_X FROM dbo.X"'), 'prod SELECT INTO a permanent table is blocked');
none(decide('sqlcmd -d CLIENT_Prod_App -Q "SELECT Id INTO #t FROM dbo.X"'), 'prod SELECT INTO a temp table is allowed');
ok(decide('sqlcmd -d CLIENT_Prod_App -Q "EXEC dbo.StageEmail 1"'), 'prod EXEC of a mail proc is blocked');
ok(decide('sqlcmd -d CLIENT_Prod_App -Q "GRANT SELECT ON dbo.X TO u"'), 'prod GRANT is blocked');

// Exemption for an environment with no stage: only the listed name, and only when it is the only prod name.
none(decide('sqlcmd -d SANDBOX_Prod_App -Q "UPDATE dbo.X SET a=1"'), 'an exempt prod write is allowed');
ok(decide('sqlcmd -d SANDBOX_Prod_App -Q "INSERT INTO CLIENT_Prod_App.dbo.X VALUES (1)"'), 'a second, non-exempt prod name keeps the block');
ok(decide('sqlcmd -d SANDBOX_Prod_App -Q "EXEC dbo.DBMailItem_QueueAllPending"'), 'a blocked proc stays blocked on an exempt database');
ok(decide('sqlcmd -d SANDBOX_Prod_App_Copy -Q "DELETE FROM t"'), 'a lookalike name is not exempt');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-guard-test-'));
try {
  const writeFile = path.join(dir, 'write.sql');
  fs.writeFileSync(writeFile, 'USE CLIENT_Prod_App;\nGO\nUPDATE dbo.X SET a = 1;\n');
  const writeCmd = 'sqlcmd -S x -i "' + writeFile + '"';
  none(decide(writeCmd), 'the command text alone names no prod database');
  ok(decide(writeCmd + referencedText(writeCmd)), 'a sqlcmd -i file that targets prod with an UPDATE is blocked');

  const readFile = path.join(dir, 'read.sql');
  fs.writeFileSync(readFile, 'USE CLIENT_Prod_App;\nGO\nSELECT TOP 5 * FROM dbo.X;\n');
  const readCmd = 'sqlcmd -S x -i "' + readFile + '"';
  none(decide(readCmd + referencedText(readCmd)), 'a sqlcmd -i file that only reads prod is allowed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('prod-guard: ' + n + ' assertions passed');
