const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../public/admin-recipes.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/admin-recipes.js'), 'utf8');

function editor(fetch) {
  const nodes = new Map();
  const document = { activeElement: null, addEventListener() {}, getElementById: id => {
    assert.ok(nodes.has(id), `Unknown editor element ${id}`);
    return nodes.get(id);
  } };
  for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const classes = new Set((match[0].match(/class="([^"]*)"/)?.[1] || '').split(' '));
    const node = {
      value: '', textContent: '', innerHTML: '', disabled: false, attributes: {},
      classList: {
        contains: value => classes.has(value),
        add: (...values) => values.forEach(value => classes.add(value)),
        remove: (...values) => values.forEach(value => classes.delete(value)),
        toggle(value, force = !classes.has(value)) { if (force) classes.add(value); else classes.delete(value); },
      },
      focus() { document.activeElement = node; },
      setAttribute(key, value) { node.attributes[key] = value; },
      querySelectorAll() { return []; },
    };
    nodes.set(match[1], node);
  }
  const submit = { disabled: false };
  nodes.get('recipe-form').querySelector = () => submit;
  nodes.get('recipe-form').reset = () => {};
  nodes.get('recipe-import-source').value = 'url';
  document.activeElement = nodes.get('import-recipe-open-btn');
  const context = vm.createContext({
    document, fetch, AbortController, URLSearchParams,
    window: { location: { search: '' } }, history: { replaceState() {} },
  });
  vm.runInContext(script, context);
  return { context, node: id => document.getElementById(id), submit };
}

function response() {
  return {
    ok: true, json: async () => ({
      import_record_id: 42,
      context_summary: { source_type: 'text', model_used: 'gpt-5.4-mini' },
      draft: {
        title: 'Rice', description: 'Comfort food', ingredients: [{ display_text: '1 cup rice' }],
        steps: [{ instruction_text: 'Simmer.' }], tags: ['easy'], source_url: null,
      },
    }),
  };
}

test('source selection exposes a labeled text editor, preserves both inputs, and resets to URL for a new draft', () => {
  const e = editor();
  e.context.resetForm();
  e.context.openRecipeModal({ showImport: true, focusImport: true });
  assert.equal(e.node('recipe-import-source').value, 'url');
  assert.equal(e.node('recipe-import-text-field').classList.contains('hidden'), true);
  e.node('recipe-import-url').value = 'https://example.com';
  e.node('recipe-import-source').value = 'text';
  e.context.setImportSource(true);
  assert.equal(e.node('recipe-import-url-field').classList.contains('hidden'), true);
  assert.equal(e.node('recipe-import-text-field').classList.contains('hidden'), false);
  e.node('recipe-import-text').value = 'Personal recipe notes';
  e.node('recipe-import-source').value = 'url';
  e.context.setImportSource();
  assert.equal(e.node('recipe-import-url').value, 'https://example.com');
  assert.equal(e.node('recipe-import-text').value, 'Personal recipe notes');
  e.context.resetForm();
  assert.equal(e.node('recipe-import-text').value, '');
  assert.equal(e.node('recipe-import-url').value, '');
  assert.doesNotMatch(html, /maxlength=/);
  assert.match(html, /aria-describedby="recipe-import-text-help recipe-import-text-count"/);
});

test('text import populates the editable fields and preserves import linkage in the save payload', async () => {
  const calls = [];
  const e = editor(async (url, options) => { calls.push({ url, options }); return response(); });
  e.node('recipe-import-source').value = 'text';
  e.node('recipe-import-text').value = '  Simmer a cup of rice.\nDinner!  ';
  e.node('recipe-import-url').value = 'https://ignored.example';
  await e.context.importRecipe();
  assert.equal(calls.length, 1, 'import must not save automatically');
  assert.equal(calls[0].url, '../api/recipes/import');
  assert.deepEqual(JSON.parse(calls[0].options.body), { text: 'Simmer a cup of rice.\nDinner!' });
  assert.equal(e.node('recipe-title').value, 'Rice');
  assert.equal(e.node('recipe-ingredients').value, '1 cup rice');
  assert.equal(e.node('recipe-steps').value, 'Simmer.');
  assert.equal(e.node('recipe-source-url').value, '');
  assert.match(e.node('recipe-import-meta').textContent, /pasted text/);
  e.node('recipe-title').value = 'Edited Rice';
  const payload = e.context.buildPayload();
  assert.equal(payload.title, 'Edited Rice');
  assert.equal(payload.import_id, 42);
  assert.equal(payload.ingredients[0], '1 cup rice');
  assert.equal(e.submit.disabled, false);
});

test('URL selection posts only URL even when pasted text is retained', async () => {
  let payload;
  const e = editor(async (_, options) => { payload = JSON.parse(options.body); return response(); });
  e.node('recipe-import-url').value = ' https://example.com/recipe ';
  e.node('recipe-import-text').value = 'retained text';
  await e.context.importRecipe();
  assert.deepEqual(payload, { url: 'https://example.com/recipe' });
});

test('invalid input does not fetch; failed imports preserve text and the existing draft for retry', async () => {
  let calls = 0;
  const e = editor(async () => { calls++; return { ok: false, json: async () => ({ error: 'Try again later' }) }; });
  e.node('recipe-import-source').value = 'text';
  e.node('recipe-import-text').value = ' \n';
  await e.context.importRecipe();
  assert.match(e.node('recipe-modal-status').textContent, /Paste recipe text first/);
  e.node('recipe-import-text').value = 'x'.repeat(12001);
  await e.context.importRecipe();
  assert.match(e.node('recipe-modal-status').textContent, /12,000/);
  assert.equal(calls, 0);
  e.node('recipe-import-text').value = 'Rice: simmer until tender';
  e.node('recipe-title').value = 'Existing title';
  await e.context.importRecipe();
  assert.equal(calls, 1);
  assert.equal(e.node('recipe-import-text').value, 'Rice: simmer until tender');
  assert.equal(e.node('recipe-title').value, 'Existing title');
  assert.match(e.node('recipe-modal-status').textContent, /Try again later/);
  assert.equal(e.node('recipe-import-btn').disabled, false);
  assert.equal(e.submit.disabled, false);
});

test('closing an in-flight import aborts it and late results cannot overwrite the next draft', async () => {
  let finish;
  let signal;
  const e = editor((_, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  e.context.openRecipeModal({ showImport: true });
  e.node('recipe-import-source').value = 'text';
  e.node('recipe-import-text').value = 'Simmer rice';
  const pending = e.context.importRecipe();
  assert.equal(e.submit.disabled, true);
  assert.equal(e.node('recipe-import-source').disabled, true);
  assert.equal(e.node('recipe-import-panel').attributes['aria-busy'], 'true');
  await e.context.importRecipe(); // ignored duplicate request
  await e.context.saveRecipe({ preventDefault() {} }); // cannot save an incomplete import
  e.context.closeRecipeModal();
  assert.equal(signal.aborted, true);
  e.context.resetForm();
  e.context.openRecipeModal();
  e.node('recipe-title').value = 'New draft';
  finish(response());
  await pending;
  assert.equal(e.node('recipe-title').value, 'New draft');
  assert.equal(e.node('recipe-import-id').value, '');
  assert.equal(e.submit.disabled, false);
});

test('long text is counted without truncation and retry focus returns to the source editor', async () => {
  const e = editor(async () => ({ ok: false, json: async () => ({ error: 'Try again' }) }));
  e.node('recipe-import-source').value = 'text';
  e.node('recipe-import-text').value = 'x'.repeat(13000);
  e.context.updateImportTextCount();
  assert.equal(e.node('recipe-import-text').value.length, 13000);
  assert.equal(e.node('recipe-import-text-count').textContent, '13,000 / 12,000 characters');
  assert.equal(e.node('recipe-import-text').attributes['aria-invalid'], 'true');
  e.node('recipe-import-text').value = 'Recipe notes';
  await e.context.importRecipe();
  assert.equal(e.context.document.activeElement, e.node('recipe-import-text'));
});
