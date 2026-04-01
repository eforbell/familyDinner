const test = require('node:test');
const assert = require('node:assert/strict');

const { escapeHtml } = require('../server');

test('escapeHtml escapes dangerous HTML characters for server-rendered templates', () => {
  assert.equal(
    escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
  );
  assert.equal(
    escapeHtml('" onclick="evil()'),
    '&quot; onclick=&quot;evil()'
  );
});
