const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OPENAI_API_KEY = '';
const { app, pool } = require('../server');

test('without an API key, text import explains configuration while URL JSON-LD fallback still works', async t => {
  const realFetch = global.fetch;
  const originalQuery = pool.query;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    global.fetch = realFetch;
    pool.query = originalQuery;
    await new Promise(resolve => server.close(resolve));
  });
  let queries = 0;
  let fetches = 0;
  pool.query = async (sql, params) => {
    queries++;
    if (/SELECT value FROM app_config/.test(sql)) return { rows: [] };
    assert.match(sql, /INSERT INTO recipe_imports/);
    assert.equal(params[0], 'https://8.8.8.8/recipe');
    assert.equal(params[1], 'fallback');
    assert.equal(params[2], 'json-ld');
    return { rows: [{ id: 1 }] };
  };
  global.fetch = async url => {
    fetches++;
    assert.equal(String(url), 'https://8.8.8.8/recipe');
    return new Response('<title>Rice</title><script type="application/ld+json">{"@type":"Recipe","name":"Rice","recipeIngredient":["1 cup rice"],"recipeInstructions":["Simmer"]}</script>');
  };
  const post = body => realFetch(`http://127.0.0.1:${server.address().port}/api/recipes/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const textRes = await post({ text: 'Rice: boil a cup of rice in water.' });
  assert.equal(textRes.status, 503);
  assert.match((await textRes.json()).error, /OPENAI_API_KEY/);
  assert.equal(queries, 0);
  assert.equal(fetches, 0);
  const urlRes = await post({ url: 'https://8.8.8.8/recipe' });
  assert.equal(urlRes.status, 200);
  const data = await urlRes.json();
  assert.equal(data.draft.source_url, 'https://8.8.8.8/recipe');
  assert.equal(data.draft.ingredients[0].display_text, '1 cup rice');
  assert.equal(data.context_summary.model_used, 'json-ld');
  assert.equal(fetches, 1);
});
