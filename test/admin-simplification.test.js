const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { app } = require('../server');

async function withServer(t) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('/admin/meals stays focused on meal library actions', async (t) => {
  const baseUrl = await withServer(t);
  const res = await fetch(`${baseUrl}/admin/meals`);
  const html = await res.text();

  assert.equal(res.status, 200);
  assert.match(html, /id="new-meal-btn"/);
  assert.match(html, /id="magic-generate-btn"/);
  assert.match(html, /id="meal-search"/);
  assert.doesNotMatch(html, /id="magic-meal-prompt"/);
  assert.doesNotMatch(html, /id="magic-grocery-prompt"/);
  assert.doesNotMatch(html, /id="magic-grocery-week-date"/);
});

test('/plan owns week-scoped Magic Grocery UI', async (t) => {
  const baseUrl = await withServer(t);
  const res = await fetch(`${baseUrl}/plan`);
  const html = await res.text();
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'plan.js'), 'utf8');

  assert.equal(res.status, 200);
  assert.match(html, /id="magic-grocery-generate-btn"/);
  assert.match(html, /id="magic-grocery-modal"/);
  assert.match(script, /week_start_date: weekStart/);
  assert.match(script, /planData && planData\.week_start/);
});

test('/admin/settings centralizes LLM prompt settings', async (t) => {
  const baseUrl = await withServer(t);
  const res = await fetch(`${baseUrl}/admin/settings`);
  const html = await res.text();

  assert.equal(res.status, 200);
  assert.match(html, /Magic & Import Settings/);
  assert.match(html, /id="magic-meal-prompt"/);
  assert.match(html, /id="magic-grocery-prompt"/);
  assert.match(html, /id="magic-recipe-import-prompt"/);
  assert.match(html, /id="magic-recipe-detail-prompt"/);
});

test('Recipe Builder links to AI settings instead of embedding prompt editors', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-recipes.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-recipes.js'), 'utf8');

  assert.match(html, /href="\.\.\/admin\/settings"/);
  assert.doesNotMatch(html, /id="magic-recipe-import-prompt"/);
  assert.doesNotMatch(script, /saveRecipeSettings/);
  assert.doesNotMatch(script, /recipe-import\/settings/);
});
