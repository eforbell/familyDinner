const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

test('main Tonight rendering handles explicit order-in before empty meal fallback', () => {
  const orderInBranch = appScript.indexOf('if (orderIn)');
  const noMealBranch = appScript.indexOf('if (!meal)');

  assert.ok(orderInBranch > -1, 'expected explicit order-in branch');
  assert.ok(noMealBranch > -1, 'expected no-meal fallback branch');
  assert.ok(orderInBranch < noMealBranch, 'order-in nights without meals must not render as empty');
});

test('restaurant vote rendering escapes voter names as well as restaurant names', () => {
  assert.match(appScript, /const voters = Array\.isArray\(r\.voters\) \? r\.voters\.map\(esc\)\.join\(', '\) : '';/);
  assert.match(appScript, /<span class="r-name">\$\{esc\(r\.name\)\}<\/span>/);
});
