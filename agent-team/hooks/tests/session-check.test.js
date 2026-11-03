'use strict';
// Run: node agent-team/hooks/tests/session-check.test.js
process.env.GUARD_FOLDER_PATTERN = 'CLIENT-';

const assert = require('assert');
const { needsCheck, stateLine } = require('../session-check.js');

let n = 0;
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); n++; };

eq(needsCheck('C:\\Users\\me\\Projects\\CLIENT-A'), true);
eq(needsCheck('C:\\Users\\me\\Projects\\CLIENT-A\\build'), true);
eq(needsCheck('C:\\Users\\me\\Projects\\personal-site'), false);
eq(needsCheck(''), false);
eq(needsCheck(undefined), false);
eq(stateLine('Up'), 'VPN tunnel: Up');
eq(stateLine('Down'), 'VPN tunnel: Down, re-dial before any stage work');
eq(stateLine('Degraded'), 'VPN tunnel: Degraded, re-dial before any stage work');
eq(stateLine(undefined), 'VPN tunnel: Unknown, re-dial before any stage work');
console.log('session-check: ' + n + ' assertions passed');
