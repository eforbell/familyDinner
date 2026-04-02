const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDefaultOrderIn,
  escapeHtml,
  parseRestaurantOptionsInput,
  renderRecipeDetailPage,
  resolveDayOrderIn,
  serializeRestaurantOptions,
} = require('../server');

test('escapeHtml escapes dangerous HTML characters for server-rendered templates', () => {
  assert.equal(
    escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
  );
  assert.equal(
    escapeHtml('" onclick="evil()'),
    '&quot; onclick=&quot;evil()'
  );
});

test('renderRecipeDetailPage injects recipe-specific title and metadata', () => {
  const html = renderRecipeDetailPage({
    id: 42,
    title: 'Recipe <Name>',
    description: 'A "great" dinner.',
  });

  assert.match(html, /<title>Recipe &lt;Name&gt; · Family Dinner<\/title>/);
  assert.match(html, /<meta property="og:title" content="Recipe &lt;Name&gt;">/);
  assert.match(html, /<meta property="og:description" content="A &quot;great&quot; dinner\.">/);
  assert.match(html, /<h1 id="recipe-detail-title">Recipe &lt;Name&gt;<\/h1>/);
});

test('resolveDayOrderIn creates vote options for protected nights without an explicit order-in record', () => {
  const restaurants = [
    { id: 1, name: 'Chipotle', emoji: '🌯' },
    { id: 2, name: 'Pizza', emoji: '🍕' },
  ];

  const orderIn = resolveDayOrderIn(
    '2026-04-02',
    { id: 10, name: 'Thursday Night Out', is_protected: true },
    null,
    restaurants
  );

  assert.equal(orderIn.order_date, '2026-04-02');
  assert.equal(orderIn.is_default, true);
  assert.deepEqual(orderIn.votes, [
    { id: 1, name: 'Chipotle', emoji: '🌯', count: 0, voters: [] },
    { id: 2, name: 'Pizza', emoji: '🍕', count: 0, voters: [] },
  ]);
});

test('buildDefaultOrderIn starts protected order-in nights with zeroed vote counts', () => {
  const orderIn = buildDefaultOrderIn('2026-04-02', [
    { id: 7, name: 'Panda Express', emoji: '🥡' },
  ]);

  assert.deepEqual(orderIn.votes, [
    { id: 7, name: 'Panda Express', emoji: '🥡', count: 0, voters: [] },
  ]);
});

test('restaurant option settings parse and serialize simple planner input', () => {
  const parsed = parseRestaurantOptionsInput(`
    🌯 Chipotle
    Pizza
    🌯 Chipotle
    🍟 McDonald's
  `);

  assert.deepEqual(parsed, [
    { emoji: '🌯', name: 'Chipotle' },
    { emoji: null, name: 'Pizza' },
    { emoji: '🍟', name: "McDonald's" },
  ]);

  assert.equal(
    serializeRestaurantOptions(parsed),
    "🌯 Chipotle\nPizza\n🍟 McDonald's"
  );
});
