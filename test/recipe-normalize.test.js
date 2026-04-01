const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeRecipePayload,
  recipeToMealDraft,
  validateRecipePayload,
} = require('../lib/recipe-normalize');

test('normalizeRecipePayload preserves ingredient and step order', () => {
  const recipe = normalizeRecipePayload({
    title: 'Sheet Pan Fajitas',
    tags: 'chicken, easy',
    ingredients: ['1 lb chicken', '2 peppers'],
    steps: ['Heat oven', 'Roast everything'],
  });

  assert.equal(recipe.ingredients[0].position, 1);
  assert.equal(recipe.ingredients[1].display_text, '2 peppers');
  assert.equal(recipe.steps[0].instruction_text, 'Heat oven');
  assert.equal(recipe.steps[1].position, 2);
  assert.deepEqual(recipe.tags, ['chicken', 'easy']);
});

test('validateRecipePayload requires title, ingredients, and steps', () => {
  assert.equal(validateRecipePayload(normalizeRecipePayload({})), 'title is required');
  assert.equal(
    validateRecipePayload(normalizeRecipePayload({ title: 'Test', steps: ['Cook'] })),
    'at least one ingredient is required'
  );
  assert.equal(
    validateRecipePayload(normalizeRecipePayload({ title: 'Test', ingredients: ['1 egg'] })),
    'at least one step is required'
  );
});

test('normalizeRecipePayload preserves fuzzy import ingredient text', () => {
  const recipe = normalizeRecipePayload({
    title: 'Imported soup',
    ingredients: [{ display_text: '', ingredient_text: 'olive oil', prep_note: 'for the pot' }],
    steps: ['Warm the pot'],
  });

  assert.equal(recipe.ingredients[0].display_text, 'olive oil, for the pot');
  assert.equal(recipe.ingredients[0].ingredient_text, 'olive oil');
});

test('recipeToMealDraft derives lightweight meal metadata from a recipe', () => {
  const meal = recipeToMealDraft(normalizeRecipePayload({
    title: 'Teriyaki Chicken Bowls',
    description: 'Sweet-savory bowls',
    prep_time_min: 10,
    total_time_min: 30,
    tags: ['chicken', 'bowls'],
    ingredients: ['1 lb chicken'],
    steps: ['Cook the chicken', 'Serve over rice'],
  }));

  assert.equal(meal.name, 'Teriyaki Chicken Bowls');
  assert.equal(meal.notes, 'Sweet-savory bowls');
  assert.equal(meal.active_time_min, 10);
  assert.equal(meal.total_time_min, 30);
  assert.deepEqual(meal.tags, ['chicken', 'bowls']);
});
