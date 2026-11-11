'use strict';

// Under Home Base's suite identity (tailnet mode) every write must say it is JSON, even with no body (a DELETE, a
// POST that only triggers something), and come from Dinner's own origin. A page write that forgets the header
// works in local mode and is refused only on a tailnet household, so every page write is checked here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

// Every fetch(...) call in the text, with its whole argument list (balanced parentheses, so multi-line options count).
function fetchCalls(text) {
  const calls = [];
  for (let start = text.indexOf('fetch('); start !== -1; start = text.indexOf('fetch(', start + 1)) {
    let depth = 0;
    let end = start + 'fetch'.length;
    for (; end < text.length; end += 1) {
      if (text[end] === '(') depth += 1;
      else if (text[end] === ')' && --depth === 0) break;
    }
    calls.push(text.slice(start, end + 1));
  }
  return calls;
}

const WRITE = /method:\s*'(?:POST|PUT|PATCH|DELETE)'/;
const JSON_TYPE = /'Content-Type':\s*'application\/json'/;

function pageSources() {
  const pages = fs.readdirSync(PUBLIC).filter((name) => name.endsWith('.js') || name.endsWith('.html'))
    .map((name) => [name, fs.readFileSync(path.join(PUBLIC, name), 'utf8')]);
  // The Tonight page is rendered by server.js; its script calls the API with ./api/ paths. The server's own
  // outbound calls (OpenAI, recipe import) are not page writes.
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const tonight = fetchCalls(server).filter((call) => /^fetch\(\s*\\?[`']\.\/api\//.test(call)).join('\n');
  return [...pages, ['server.js (Tonight page)', tonight]];
}

test('every page write says it is JSON, even with no body', () => {
  let writes = 0;
  for (const [name, text] of pageSources()) {
    for (const call of fetchCalls(text)) {
      if (!WRITE.test(call)) continue;
      writes += 1;
      assert.match(call, JSON_TYPE, `${name}: ${call.replace(/\s+/g, ' ')}`);
    }
  }
  // Guards the scan itself: if it stopped finding writes, the assertion above would pass on nothing.
  assert.ok(writes >= 25, `found ${writes} page writes`);
});

test('pages write only through fetch: no form posts, uploads or beacons', () => {
  for (const [name, text] of pageSources()) {
    assert.doesNotMatch(text, /<form[^>]*\bmethod=/i, `${name}: a form that submits itself`);
    assert.doesNotMatch(text, /\bnew FormData\b|\bXMLHttpRequest\b|\bsendBeacon\b/, name);
  }
});
