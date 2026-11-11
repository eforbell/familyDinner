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

// The end of the argument list that opens at text[open] ('('), skipping string and template literals (a ')' inside a
// URL or message is not syntax) and following ${...} inside templates.
function closingParen(text, open) {
  const stack = [')'];
  for (let i = open + 1; i < text.length; i += 1) {
    const c = text[i];
    const top = stack[stack.length - 1];
    if (top === '`') {
      if (c === '\\') i += 1;
      else if (c === '`') stack.pop();
      else if (c === '$' && text[i + 1] === '{') { stack.push('}'); i += 1; }
      continue;
    }
    if (c === "'" || c === '"') {
      for (i += 1; i < text.length && text[i] !== c; i += 1) if (text[i] === '\\') i += 1;
      continue;
    }
    if (c === '`') stack.push('`');
    else if (c === '(') stack.push(')');
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === top) { stack.pop(); if (!stack.length) return i; }
  }
  return text.length - 1;
}

// Every fetch(...) call in the text, with its whole argument list.
function fetchCalls(text) {
  const calls = [];
  for (const match of text.matchAll(/\bfetch\(/g)) {
    const open = match.index + match[0].length - 1;
    calls.push(text.slice(match.index, closingParen(text, open) + 1));
  }
  return calls;
}

// A call that names a method at all (literal, shorthand `{ method }`, or built) is a write unless it is a literal GET.
const NAMES_METHOD = /\bmethod\b/;
const LITERAL_GET = /\bmethod:\s*['"`]GET['"`]/;
const JSON_TYPE = /'Content-Type':\s*'application\/json'/;

function pageSources() {
  const pages = fs.readdirSync(PUBLIC).filter((name) => name.endsWith('.js') || name.endsWith('.html'))
    .map((name) => [name, fs.readFileSync(path.join(PUBLIC, name), 'utf8')]);
  // The Tonight page is rendered by server.js: its whole route, markup and script, between it and the next route.
  // In server.js the page's backticks and ${ are escaped; unescape them so the page reads as the browser gets it.
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const start = server.indexOf("app.get('/tonight'");
  const end = server.indexOf("app.get('/api/tonight'");
  assert.ok(start !== -1 && end > start, 'the Tonight route is where this test expects it');
  const tonight = server.slice(start, end).replace(/\\`/g, '`').replace(/\\\$\{/g, '${');
  return [...pages, ['server.js (Tonight page)', tonight]];
}

test('every page write says it is JSON, even with no body', () => {
  let writes = 0;
  for (const [name, text] of pageSources()) {
    for (const call of fetchCalls(text)) {
      if (!NAMES_METHOD.test(call) || LITERAL_GET.test(call)) continue;
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
