const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertSafeRecipeSourceUrl,
  buildImportSource,
  extractRecipeJsonLd,
  inferDomainFromUrl,
  isPrivateAddress,
  stripHtml,
} = require('../lib/recipe-import');

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
  <head>
    <title>Sheet Pan Chicken Fajitas</title>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": "Sheet Pan Chicken Fajitas",
        "description": "Fast weeknight fajitas.",
        "recipeYield": "4 servings",
        "prepTime": "PT15M",
        "cookTime": "PT30M",
        "totalTime": "PT45M",
        "recipeIngredient": ["1 lb chicken thighs", "2 peppers"],
        "recipeInstructions": ["Heat oven to 425F", "Roast until cooked"],
        "keywords": "chicken, weeknight"
      }
    </script>
  </head>
  <body>
    <article>
      <p>A lovely family recipe with a lot of story text.</p>
    </article>
  </body>
</html>`;

test('extractRecipeJsonLd finds recipe schema blocks', () => {
  const recipe = extractRecipeJsonLd(SAMPLE_HTML);
  assert.equal(recipe.name, 'Sheet Pan Chicken Fajitas');
  assert.equal(recipe.recipeIngredient.length, 2);
});

test('buildImportSource turns recipe schema into a baseline draft', () => {
  const result = buildImportSource(SAMPLE_HTML, 'https://example.com/fajitas');
  assert.equal(result.usedJsonLd, true);
  assert.equal(result.baselineDraft.title, 'Sheet Pan Chicken Fajitas');
  assert.equal(result.baselineDraft.total_time_min, 45);
  assert.equal(result.baselineDraft.ingredients[0].display_text, '1 lb chicken thighs');
  assert.equal(result.baselineDraft.steps[1].instruction_text, 'Roast until cooked');
});

test('stripHtml removes tags while preserving readable text', () => {
  assert.equal(stripHtml('<div>Hello <strong>world</strong></div>'), 'Hello world');
});

test('inferDomainFromUrl returns a clean hostname', () => {
  assert.equal(inferDomainFromUrl('https://www.example.com/recipe'), 'example.com');
  assert.equal(inferDomainFromUrl('not-a-url'), null);
});

test('isPrivateAddress identifies loopback and RFC1918 ranges', () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('192.168.1.20'), true);
  assert.equal(isPrivateAddress('10.0.0.5'), true);
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});

test('assertSafeRecipeSourceUrl blocks localhost and private-network URLs', async () => {
  await assert.rejects(
    () => assertSafeRecipeSourceUrl('http://127.0.0.1:3000/test'),
    /private-network addresses/
  );
  await assert.rejects(
    () => assertSafeRecipeSourceUrl('http://localhost:3000/test'),
    /private-network addresses/
  );
});
