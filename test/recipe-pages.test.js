const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { app } = require('../server');

test('recipe browser stays focused on browsing while builder stays separate', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const browserRes = await fetch(`${baseUrl}/recipes`);
  assert.equal(browserRes.status, 200);
  const browserHtml = await browserRes.text();
  assert.match(browserHtml, /Recipe Builder/);
  assert.doesNotMatch(browserHtml, /id="recipe-import-url"/);
  assert.match(browserHtml, /meal-admin-layout recipe-layout/);
  assert.match(browserHtml, /recipe-toolbar/);
  assert.match(browserHtml, /id="recipe-sort"/);
  assert.match(browserHtml, /recipe-card-grid/);
  assert.doesNotMatch(browserHtml, /Open builder/);
  assert.doesNotMatch(browserHtml, /Cook-view first/);
  assert.doesNotMatch(browserHtml, /What moved\?/);
  assert.doesNotMatch(browserHtml, /Need to edit or import\?/);

  const builderRes = await fetch(`${baseUrl}/admin/recipes`);
  assert.equal(builderRes.status, 200);
  const builderHtml = await builderRes.text();
  assert.match(builderHtml, /Recipe Builder/);
  assert.match(builderHtml, /Import from URL/);
  assert.match(builderHtml, /id="recipe-import-url"/);
  assert.match(builderHtml, /new-recipe-btn/);
});

test('cook-view edit action points to the recipe builder route', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'recipe.js'), 'utf8');
  assert.match(script, /\.\.\/admin\/recipes\?recipeId=/);
});

test('cook-view template includes a back link to the recipe browser', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'recipe.html'), 'utf8');
  assert.match(html, /Back to recipes/);
  assert.match(html, /href="\.\.\/recipes"/);
  assert.doesNotMatch(html, /Cook View/);
});

test('recipe browser lets the page scroll instead of nesting list scrolling', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(css, /\.recipe-browser-list\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/s);
  assert.match(css, /\.meal-admin-layout\.recipe-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
});

test('recipe browser and builder scripts use relative app paths for subpath deployments', () => {
  const browserScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'recipes.js'), 'utf8');
  const builderScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-recipes.js'), 'utf8');
  const browserHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'recipes.html'), 'utf8');
  const builderHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-recipes.html'), 'utf8');

  assert.match(browserScript, /fetch\(`api\/recipes/);
  assert.match(browserScript, /href="recipes\/\$\{recipe\.id\}"/);
  assert.match(browserHtml, /href="admin\/recipes"/);

  assert.match(builderScript, /fetch\('\.\.\/api\/recipes'\)/);
  assert.match(builderScript, /history\.replaceState\(null, '', `recipes\?recipeId=\$\{recipe\.id\}`\)/);
  assert.match(builderScript, /viewLink\.href = `\.\.\/recipes\/\$\{selectedRecipeId\}`/);
  assert.match(builderHtml, /href="\.\.\/recipes"/);
});
