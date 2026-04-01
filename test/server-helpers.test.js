const test = require('node:test');
const assert = require('node:assert/strict');

const { escapeHtml, renderRecipeDetailPage } = require('../server');

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
