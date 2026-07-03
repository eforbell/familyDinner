require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const { app } = require('../server');

async function cleanupRecipe(pool, recipeId, mealId) {
  if (mealId) await pool.query('DELETE FROM meals WHERE id = $1', [mealId]);
  if (!recipeId) return;
  await pool.query('DELETE FROM meals WHERE recipe_id = $1', [recipeId]);
  await pool.query('DELETE FROM recipe_imports WHERE recipe_id = $1', [recipeId]);
  await pool.query('DELETE FROM recipe_steps WHERE recipe_id = $1', [recipeId]);
  await pool.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [recipeId]);
  await pool.query('DELETE FROM recipes WHERE id = $1', [recipeId]);
}

test('recipe API can create, fetch, and convert a recipe into a meal', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is not configured');
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let server;
  let baseUrl;
  const title = `Test Recipe ${randomUUID()}`;
  let recipeId;
  let mealId;

  t.after(async () => {
    await cleanupRecipe(pool, recipeId, mealId);
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    await pool.end();
  });

  try {
    await pool.query('SELECT 1');
  } catch {
    t.skip('DATABASE_URL is configured but PostgreSQL is unavailable');
    return;
  }

  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;

  const createRes = await fetch(`${baseUrl}/api/recipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      description: 'A test recipe from node:test',
      tags: 'test, api',
      ingredients: ['1 cup rice', '2 cups water'],
      steps: ['Combine ingredients', 'Cook until tender'],
    }),
  });

  assert.equal(createRes.status, 201);
  const createdRecipe = await createRes.json();
  recipeId = createdRecipe.id;
  assert.equal(createdRecipe.title, title);
  assert.equal(createdRecipe.ingredients.length, 2);

  const getRes = await fetch(`${baseUrl}/api/recipes/${recipeId}`);
  assert.equal(getRes.status, 200);
  const fetchedRecipe = await getRes.json();
  assert.equal(fetchedRecipe.steps[0].instruction_text, 'Combine ingredients');

  const mealRes = await fetch(`${baseUrl}/api/recipes/${recipeId}/create-meal`, {
    method: 'POST',
  });
  assert.equal(mealRes.status, 201);
  const mealPayload = await mealRes.json();
  assert.equal(mealPayload.created, true);
  assert.equal(mealPayload.meal.recipe_id, recipeId);
  mealId = mealPayload.meal.id;

  const secondMealRes = await fetch(`${baseUrl}/api/recipes/${recipeId}/create-meal`, {
    method: 'POST',
  });
  assert.equal(secondMealRes.status, 200);
  const secondMealPayload = await secondMealRes.json();
  assert.equal(secondMealPayload.created, false);

  const deleteRes = await fetch(`${baseUrl}/api/recipes/${recipeId}`, {
    method: 'DELETE',
  });
  assert.equal(deleteRes.status, 200);
  const deletePayload = await deleteRes.json();
  assert.equal(deletePayload.success, true);
  assert.equal(deletePayload.unlinked_meals, 1);

  const deletedGetRes = await fetch(`${baseUrl}/api/recipes/${recipeId}`);
  assert.equal(deletedGetRes.status, 404);

  const mealAfterDelete = await pool.query('SELECT recipe_id FROM meals WHERE id = $1', [mealId]);
  assert.equal(mealAfterDelete.rows.length, 1);
  assert.equal(mealAfterDelete.rows[0].recipe_id, null);
  recipeId = null;
});
