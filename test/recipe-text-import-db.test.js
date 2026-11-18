require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

process.env.OPENAI_API_KEY = 'test-only-not-a-real-key';
const { app, pool } = require('../server');

test('text import can be reviewed, saved, fetched and linked to its audit record in PostgreSQL', async t => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is not configured');
  try {
    await pool.query('SELECT 1');
  } catch {
    await pool.end();
    return t.skip('PostgreSQL is unavailable');
  }
  const realFetch = global.fetch;
  const title = `Text import ${randomUUID()}`;
  let recipeId;
  let importId;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    global.fetch = realFetch;
    if (importId) await pool.query('DELETE FROM recipe_imports WHERE id = $1', [importId]);
    if (recipeId) await pool.query('DELETE FROM recipes WHERE id = $1', [recipeId]);
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  });
  global.fetch = async url => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      title, description: 'Family notes', ingredients: ['1 cup rice'], steps: ['Simmer rice.'],
    }) } }] });
  };
  const api = `http://127.0.0.1:${server.address().port}/api/recipes`;
  const post = (url, body) => realFetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const importRes = await post(`${api}/import`, { text: 'Rice: simmer a cup of rice in water.' });
  assert.equal(importRes.status, 200);
  const imported = await importRes.json();
  importId = imported.import_record_id;
  const beforeSave = await pool.query('SELECT id FROM recipes WHERE title = $1', [title]);
  assert.equal(beforeSave.rows.length, 0, 'import only creates a draft, not a recipe');
  const savedRes = await post(api, { ...imported.draft, import_id: importId, title: `${title} edited` });
  assert.equal(savedRes.status, 201);
  const saved = await savedRes.json();
  recipeId = saved.id;
  const fetched = await (await realFetch(`${api}/${recipeId}`)).json();
  assert.equal(fetched.title, `${title} edited`);
  assert.equal(fetched.source_url, null);
  assert.equal(fetched.ingredients[0].display_text, '1 cup rice');
  assert.equal(fetched.steps[0].instruction_text, 'Simmer rice.');
  const audit = (await pool.query('SELECT * FROM recipe_imports WHERE id = $1', [importId])).rows[0];
  assert.equal(audit.recipe_id, recipeId);
  assert.equal(audit.source_url, null);
  assert.equal(audit.raw_text_excerpt, 'Rice: simmer a cup of rice in water.');
});
