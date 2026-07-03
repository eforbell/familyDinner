require('dotenv').config();
const express = require('express');
const fs = require('fs');
const { Pool } = require('pg');
const path = require('path');
const {
  isValidDateOnlyString,
  localDateString,
  mealVoteWeekContext,
  mondayOf,
  parseDateOnly,
  resolveMealVoteDate,
} = require('./lib/date-utils');
const {
  cookLogRowsToCsv,
  parsePositiveInt,
} = require('./lib/cook-log');
const {
  assertSafeRecipeSourceUrl,
  buildImportSource,
} = require('./lib/recipe-import');
const {
  normalizeRecipePayload,
  recipeToMealDraft,
  validateRecipePayload,
} = require('./lib/recipe-normalize');

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_SOVEREIGN_FONT_SANS_CSS_URL = 'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&display=swap';
const DEFAULT_SOVEREIGN_FONT_MONO_CSS_URL = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap';

function buildSovereignFontsCss() {
  const source = String(process.env.SOVEREIGN_FONT_SOURCE || 'google').trim().toLowerCase();
  if (source === 'off') return '/* Sovereign fonts disabled via SOVEREIGN_FONT_SOURCE=off */\n';

  const isLocal = source === 'local';
  const sansUrl = (isLocal ? process.env.SOVEREIGN_FONT_SANS_CSS_URL_LOCAL : process.env.SOVEREIGN_FONT_SANS_CSS_URL)
    || DEFAULT_SOVEREIGN_FONT_SANS_CSS_URL;
  const monoUrl = (isLocal ? process.env.SOVEREIGN_FONT_MONO_CSS_URL_LOCAL : process.env.SOVEREIGN_FONT_MONO_CSS_URL)
    || DEFAULT_SOVEREIGN_FONT_MONO_CSS_URL;

  return [
    '/* Generated from environment: /sovereign-fonts.css */',
    `@import url('${sansUrl}');`,
    `@import url('${monoUrl}');`,
    '',
  ].join('\n');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_RECIPE_MODEL = process.env.OPENAI_RECIPE_MODEL || OPENAI_MODEL;
// GPT-5.1+ dropped 'minimal'; 'none' is the replacement for reasoning-off.
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || 'none';

// gpt-4o/gpt-4/gpt-3.5 reject the reasoning_effort param outright, so only
// send it to models that understand it (o-series and gpt-5+).
function reasoningParamsFor(model) {
  const supportsReasoning = /^(o\d|gpt-5)/.test(String(model || ''));
  return supportsReasoning ? { reasoning_effort: OPENAI_REASONING_EFFORT } : {};
}
const RECIPE_IMPORT_USER_AGENT = process.env.RECIPE_IMPORT_USER_AGENT || [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/136.0.0.0 Safari/537.36',
].join(' ');
const DEFAULT_MAGIC_MEAL_PROMPT = [
  'Design one new dinner idea for this household.',
  'Use the family meal history, ratings, and repetition patterns to find something that fits.',
  'Prefer practical dinners that feel like a house standard, not restaurant fantasy food.',
  'Avoid creating a near-duplicate of an existing meal.',
  'Return one meal draft that can be edited and saved into the meal library.',
].join(' ');
const DEFAULT_MAGIC_RECIPE_IMPORT_PROMPT = [
  'Extract a structured family-friendly recipe from the source material.',
  'Remove story text and unrelated content.',
  'Preserve useful ingredient, yield, and timing details when supported by the source.',
  'Return ordered ingredients and detailed, cook-friendly steps.',
  'Do not invent unsupported ingredients or major recipe changes.',
].join(' ');
const DEFAULT_MAGIC_RECIPE_DETAIL_PROMPT = [
  'When the source instructions are terse, expand them into more explicit home-cook guidance.',
  'Keep the recipe faithful to the source while making the steps easier to follow.',
].join(' ');
const DEFAULT_MAGIC_GROCERY_PROMPT = [
  'Generate a practical grocery list for the upcoming family dinner week.',
  'Use the week plan, meal details, and recipe tips to infer likely ingredients.',
  'Consolidate duplicates and quantities across meals when possible.',
  'Keep outputs realistic for a normal grocery run, grouped by store section.',
  'Prefer concise, clear list items and include short prep notes only when useful.',
].join(' ');
const RECIPE_DETAIL_TEMPLATE = fs.readFileSync(path.join(__dirname, 'public', 'recipe.html'), 'utf8');

app.use(express.json());

// ── Helpers ──────────────────────────────────────────────────

function parseTextList(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeRestaurantKey(name) {
  return String(name || '').trim().toLowerCase();
}

function dedupeRestaurants(restaurants) {
  const deduped = new Map();

  for (const restaurant of restaurants) {
    const key = normalizeRestaurantKey(restaurant.name);
    if (!key || deduped.has(key)) continue;
    deduped.set(key, restaurant);
  }

  return [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mergeRestaurantVoteRows(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const key = normalizeRestaurantKey(row.name);
    if (!key) continue;

    if (!grouped.has(key)) {
      grouped.set(key, {
        id: row.id,
        name: row.name,
        emoji: row.emoji,
        count: 0,
        voters: new Set(),
      });
    }

    const entry = grouped.get(key);
    entry.count += Number(row.count || 0);
    for (const voter of row.voters || []) {
      if (voter) entry.voters.add(voter);
    }
  }

  return [...grouped.values()]
    .map(entry => ({
      id: entry.id,
      name: entry.name,
      emoji: entry.emoji,
      count: entry.count,
      voters: [...entry.voters],
    }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
}

function buildOrderInVotes(restaurants) {
  return restaurants.map(restaurant => ({
    id: restaurant.id,
    name: restaurant.name,
    emoji: restaurant.emoji,
    count: 0,
    voters: [],
  }));
}

function buildDefaultOrderIn(dateStr, restaurants) {
  return {
    id: null,
    order_date: dateStr,
    created_by: null,
    created_at: null,
    is_default: true,
    votes: buildOrderInVotes(restaurants),
  };
}

function resolveDayOrderIn(dateStr, meal, orderIn, restaurants) {
  if (orderIn) return { ...orderIn, is_default: false };
  if (meal && meal.is_protected) return buildDefaultOrderIn(dateStr, restaurants);
  return null;
}

function serializeRestaurantOptions(restaurants) {
  return restaurants
    .map(restaurant => `${restaurant.emoji ? `${restaurant.emoji} ` : ''}${restaurant.name}`)
    .join('\n');
}

function parseRestaurantOptionsInput(input) {
  const seen = new Set();

  return String(input || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [firstToken, ...rest] = line.split(/\s+/);
      const hasEmojiPrefix = rest.length > 0 && /[^\p{L}\p{N}'&().,-]/u.test(firstToken);
      return {
        emoji: hasEmojiPrefix ? firstToken : null,
        name: hasEmojiPrefix ? rest.join(' ').trim() : line,
      };
    })
    .filter(option => option.name)
    .filter(option => {
      const key = option.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function parseRestaurantWriteIn(rawName, rawEmoji) {
  const name = String(rawName || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
  if (!name) return null;
  if (name.length > 100) return null;

  const emoji = String(rawEmoji || '').trim() || null;
  return { name, emoji };
}

function normalizeMealPayload(body) {
  const activeTime = body.active_time_min === '' || body.active_time_min == null
    ? null
    : Number(body.active_time_min);
  const totalTime = body.total_time_min === '' || body.total_time_min == null
    ? null
    : Number(body.total_time_min);

  return {
    recipe_id: body.recipe_id === '' || body.recipe_id == null
      ? null
      : Number(body.recipe_id),
    name: String(body.name || '').trim(),
    notes: body.notes ? String(body.notes).trim() : null,
    recipe_tips: body.recipe_tips ? String(body.recipe_tips).trim() : null,
    active_time_min: Number.isFinite(activeTime) ? activeTime : null,
    total_time_min: Number.isFinite(totalTime) ? totalTime : null,
    equipment: parseTextList(body.equipment),
    cook: body.cook ? String(body.cook).trim() : null,
    kid_rating: body.kid_rating ? String(body.kid_rating).trim() : null,
    is_new: Boolean(body.is_new),
    is_protected: Boolean(body.is_protected),
    tags: parseTextList(body.tags),
  };
}

function validateMealPayload(meal) {
  if (!meal.name) return 'name is required';
  if (meal.recipe_id !== null && (!Number.isInteger(meal.recipe_id) || meal.recipe_id < 1)) {
    return 'recipe_id must be a valid recipe id';
  }
  if (meal.active_time_min !== null && (!Number.isInteger(meal.active_time_min) || meal.active_time_min < 0)) {
    return 'active_time_min must be a non-negative integer';
  }
  if (meal.total_time_min !== null && (!Number.isInteger(meal.total_time_min) || meal.total_time_min < 0)) {
    return 'total_time_min must be a non-negative integer';
  }
  return null;
}

function extractAssistantText(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        if (part && part.type === 'output_text' && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

function renderRecipeDetailPage(recipe) {
  const recipeName = recipe && recipe.title ? recipe.title : 'Recipe';
  const pageTitle = `${recipeName} · Family Dinner`;
  const ogDescription = recipe && recipe.description
    ? recipe.description
    : `Cook view for ${recipeName}.`;

  return RECIPE_DETAIL_TEMPLATE
    .replace(
      '<title>Recipe</title>',
      `<title>${escapeHtml(pageTitle)}</title>
  <meta property="og:title" content="${escapeHtml(recipeName)}">
  <meta property="og:description" content="${escapeHtml(ogDescription)}">
  <meta property="og:image" content="../og-image.svg">
  <meta property="og:type" content="article">`
    )
    .replace(
      '<h1 id="recipe-detail-title">Recipe</h1>',
      `<h1 id="recipe-detail-title">${escapeHtml(recipeName)}</h1>`
    )
    .replace(
      '<p id="recipe-detail-description" class="admin-copy"></p>',
      `<p id="recipe-detail-description" class="admin-copy">${escapeHtml(recipe && recipe.description ? recipe.description : '')}</p>`
    );
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeScriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

async function getAppConfigValue(key, fallback = null, queryable = pool) {
  const { rows } = await queryable.query('SELECT value FROM app_config WHERE key = $1', [key]);
  return rows.length ? rows[0].value : fallback;
}

async function setAppConfigValue(key, value, queryable = pool) {
  await queryable.query(
    `INSERT INTO app_config (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

async function getActiveRestaurants() {
  const { rows } = await pool.query(
    'SELECT id, name, emoji, active FROM restaurants WHERE active = true ORDER BY lower(name), id'
  );
  return dedupeRestaurants(rows);
}

async function getMagicMealSettings() {
  return {
    magic_meal_prompt: await getAppConfigValue('magic_meal_prompt', DEFAULT_MAGIC_MEAL_PROMPT),
  };
}

async function getMagicGrocerySettings() {
  return {
    magic_grocery_prompt: await getAppConfigValue('magic_grocery_prompt', DEFAULT_MAGIC_GROCERY_PROMPT),
  };
}

async function getMagicRecipeSettings() {
  return {
    magic_recipe_import_prompt: await getAppConfigValue('magic_recipe_import_prompt', DEFAULT_MAGIC_RECIPE_IMPORT_PROMPT),
    magic_recipe_detail_prompt: await getAppConfigValue('magic_recipe_detail_prompt', DEFAULT_MAGIC_RECIPE_DETAIL_PROMPT),
  };
}

const DEFAULT_RESTAURANTS = [
  ['Chipotle', '🌯'],
  ['Panda Express', '🥡'],
  ['Pizza', '🍕'],
  ['McDonald\'s', '🍟'],
];

async function countTable(tableName, queryable = pool) {
  const allowed = new Set(['family_members', 'meals', 'meal_rotation', 'restaurants']);
  if (!allowed.has(tableName)) throw new Error(`Unsupported count table: ${tableName}`);
  const { rows } = await queryable.query(`SELECT COUNT(*)::int AS count FROM ${tableName}`);
  return Number(rows[0]?.count || 0);
}

async function bootstrapState(queryable = pool) {
  const [members, meals, rotationSlots, restaurants] = await Promise.all([
    countTable('family_members', queryable),
    countTable('meals', queryable),
    countTable('meal_rotation', queryable),
    countTable('restaurants', queryable),
  ]);
  const needsHousehold = members === 0;
  const needsStarterContent = restaurants === 0;

  return {
    status: needsHousehold || needsStarterContent ? 'needs_setup' : 'ready',
    app: 'family-dinner',
    version: '1.0.0',
    bootstrap: {
      needs_household: needsHousehold,
      needs_auth: false,
      needs_starter_content: needsStarterContent,
      ready: !needsHousehold && !needsStarterContent,
    },
    counts: {
      family_members: members,
      meals,
      meal_rotation: rotationSlots,
      restaurants,
    },
  };
}

async function withPoolTransaction(fn) {
  if (typeof pool.connect !== 'function') return fn(pool);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

const BOOTSTRAP_PARENT_AVATARS = ['👨‍🍳', '👩‍🍳', '🧑‍🍳'];
const BOOTSTRAP_KID_AVATARS = ['🧑', '👧', '👦'];

function normalizeBootstrapMembers(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  let parentIndex = 0;
  let kidIndex = 0;

  return input
    .map(member => ({
      name: String(member?.name || '').trim(),
      role: member?.role === 'kid' ? 'kid' : 'parent',
      is_picky: Boolean(member?.is_picky),
      hates_leftovers: Boolean(member?.hates_leftovers),
    }))
    .filter(member => member.name)
    .filter(member => {
      const key = member.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(member => {
      const index = member.role === 'parent' ? parentIndex++ : kidIndex++;
      const avatars = member.role === 'parent' ? BOOTSTRAP_PARENT_AVATARS : BOOTSTRAP_KID_AVATARS;
      return { ...member, avatar_emoji: avatars[index % avatars.length] };
    });
}

async function installStarterContent(queryable = pool) {
  for (const [name, emoji] of DEFAULT_RESTAURANTS) {
    await queryable.query(
      `INSERT INTO restaurants (name, emoji, active)
       VALUES ($1, $2, true)
       ON CONFLICT DO NOTHING`,
      [name, emoji]
    );
  }
}

function defaultRotationStartDate() {
  return localDateString(mondayOf(new Date()));
}

async function installDefaultAppConfig(rotationStartDate = defaultRotationStartDate(), queryable = pool) {
  const entries = [
    ['rotation_start_date', rotationStartDate],
    ['magic_meal_prompt', DEFAULT_MAGIC_MEAL_PROMPT],
    ['magic_grocery_prompt', DEFAULT_MAGIC_GROCERY_PROMPT],
    ['magic_recipe_import_prompt', DEFAULT_MAGIC_RECIPE_IMPORT_PROMPT],
    ['magic_recipe_detail_prompt', DEFAULT_MAGIC_RECIPE_DETAIL_PROMPT],
  ];

  for (const [key, value] of entries) {
    await queryable.query(
      `INSERT INTO app_config (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
  }
}

async function redirectToSetupIfNeeded(req, res, target = 'setup') {
  try {
    const state = await bootstrapState();
    if (state.bootstrap.needs_household) {
      res.redirect(target);
      return true;
    }
    return false;
  } catch (err) {
    res.status(500).json({ error: err.message });
    return true;
  }
}

app.use(async (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) return next();
  if (req.path === '/setup' || req.path === '/setup.html') return next();
  if (req.path === '/' || req.path === '/index.html') {
    if (await redirectToSetupIfNeeded(req, res, 'setup')) return;
  }
  return next();
});

app.get('/sovereign-fonts.css', (_req, res) => {
  res.set('content-type', 'text/css; charset=utf-8');
  res.set('cache-control', 'public, max-age=300');
  res.send(buildSovereignFontsCss());
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

function createRecipeResponseSchema() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'recipe_import_draft',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'description',
          'source_url',
          'source_domain',
          'source_title',
          'servings_text',
          'prep_time_min',
          'cook_time_min',
          'total_time_min',
          'notes',
          'tags',
          'image_url',
          'ingredients',
          'steps',
        ],
        properties: {
          title: { type: 'string' },
          description: { type: ['string', 'null'] },
          source_url: { type: ['string', 'null'] },
          source_domain: { type: ['string', 'null'] },
          source_title: { type: ['string', 'null'] },
          servings_text: { type: ['string', 'null'] },
          prep_time_min: { type: ['integer', 'null'], minimum: 0 },
          cook_time_min: { type: ['integer', 'null'], minimum: 0 },
          total_time_min: { type: ['integer', 'null'], minimum: 0 },
          notes: { type: ['string', 'null'] },
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
          image_url: { type: ['string', 'null'] },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['display_text', 'quantity_text', 'unit_text', 'ingredient_text', 'prep_note'],
              properties: {
                display_text: { type: 'string' },
                quantity_text: { type: ['string', 'null'] },
                unit_text: { type: ['string', 'null'] },
                ingredient_text: { type: ['string', 'null'] },
                prep_note: { type: ['string', 'null'] },
              },
            },
          },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'instruction_text'],
              properties: {
                title: { type: ['string', 'null'] },
                instruction_text: { type: 'string' },
              },
            },
          },
        },
      },
    },
  };
}

async function getRecipeById(recipeId) {
  const { rows } = await pool.query(
    `SELECT r.*,
            linked.id AS linked_meal_id,
            linked.name AS linked_meal_name
     FROM recipes r
     LEFT JOIN LATERAL (
       SELECT id, name
       FROM meals
       WHERE recipe_id = r.id
       ORDER BY id
       LIMIT 1
     ) linked ON true
     WHERE r.id = $1`,
    [recipeId]
  );

  if (!rows.length) return null;

  const recipe = rows[0];
  const [ingredientsResult, stepsResult] = await Promise.all([
    pool.query(
      `SELECT position, display_text, quantity_text, unit_text, ingredient_text, prep_note
       FROM recipe_ingredients
       WHERE recipe_id = $1
       ORDER BY position`,
      [recipeId]
    ),
    pool.query(
      `SELECT position, title, instruction_text
       FROM recipe_steps
       WHERE recipe_id = $1
       ORDER BY position`,
      [recipeId]
    ),
  ]);

  return {
    ...recipe,
    linked_meal: recipe.linked_meal_id ? {
      id: recipe.linked_meal_id,
      name: recipe.linked_meal_name,
    } : null,
    ingredients: ingredientsResult.rows,
    steps: stepsResult.rows,
  };
}

async function writeRecipeChildren(client, recipeId, recipe) {
  await client.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [recipeId]);
  await client.query('DELETE FROM recipe_steps WHERE recipe_id = $1', [recipeId]);

  for (const ingredient of recipe.ingredients) {
    await client.query(
      `INSERT INTO recipe_ingredients (
         recipe_id, position, display_text, quantity_text, unit_text, ingredient_text, prep_note
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        recipeId,
        ingredient.position,
        ingredient.display_text,
        ingredient.quantity_text,
        ingredient.unit_text,
        ingredient.ingredient_text,
        ingredient.prep_note,
      ]
    );
  }

  for (const step of recipe.steps) {
    await client.query(
      `INSERT INTO recipe_steps (
         recipe_id, position, title, instruction_text
       ) VALUES ($1, $2, $3, $4)`,
      [recipeId, step.position, step.title, step.instruction_text]
    );
  }
}

async function saveRecipe(recipe, existingRecipeId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let recipeId = existingRecipeId;
    if (existingRecipeId) {
      const { rowCount } = await client.query(
        `UPDATE recipes
         SET title = $2,
             description = $3,
             source_url = $4,
             source_domain = $5,
             source_title = $6,
             servings_text = $7,
             prep_time_min = $8,
             cook_time_min = $9,
             total_time_min = $10,
             notes = $11,
             tags = $12,
             image_url = $13,
             created_by_member_id = $14,
             updated_at = NOW()
         WHERE id = $1`,
        [
          existingRecipeId,
          recipe.title,
          recipe.description,
          recipe.source_url,
          recipe.source_domain,
          recipe.source_title,
          recipe.servings_text,
          recipe.prep_time_min,
          recipe.cook_time_min,
          recipe.total_time_min,
          recipe.notes,
          recipe.tags,
          recipe.image_url,
          recipe.created_by_member_id,
        ]
      );
      if (!rowCount) {
        await client.query('ROLLBACK');
        return null;
      }
    } else {
      const { rows } = await client.query(
        `INSERT INTO recipes (
           title, description, source_url, source_domain, source_title, servings_text,
           prep_time_min, cook_time_min, total_time_min, notes, tags, image_url, created_by_member_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [
          recipe.title,
          recipe.description,
          recipe.source_url,
          recipe.source_domain,
          recipe.source_title,
          recipe.servings_text,
          recipe.prep_time_min,
          recipe.cook_time_min,
          recipe.total_time_min,
          recipe.notes,
          recipe.tags,
          recipe.image_url,
          recipe.created_by_member_id,
        ]
      );
      recipeId = rows[0].id;
    }

    await writeRecipeChildren(client, recipeId, recipe);

    if (recipe.import_id) {
      await client.query(
        `UPDATE recipe_imports
         SET recipe_id = $2
         WHERE id = $1`,
        [recipe.import_id, recipeId]
      );
    }

    await client.query('COMMIT');
    return recipeId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function generateRecipeImportDraft(sourceUrl) {
  const parsedUrl = await assertSafeRecipeSourceUrl(sourceUrl);

  const response = await fetch(parsedUrl.toString(), {
    headers: {
      'User-Agent': RECIPE_IMPORT_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'Referer': `${parsedUrl.protocol}//${parsedUrl.hostname}/`,
    },
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('Recipe source fetch failed: 403 forbidden. This site is blocking automated fetches; try another URL or paste the recipe manually.');
    }
    throw new Error(`Recipe source fetch failed: ${response.status}`);
  }

  const html = await response.text();
  const source = buildImportSource(html, parsedUrl.toString());
  const settings = await getMagicRecipeSettings();

  let draft = source.baselineDraft;
  let extractorModel = source.usedJsonLd ? 'json-ld' : 'heuristic';
  let fetchStatus = 'fallback';

  if (OPENAI_API_KEY) {
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_RECIPE_MODEL,
        ...reasoningParamsFor(OPENAI_RECIPE_MODEL),
        max_completion_tokens: 2200,
        response_format: createRecipeResponseSchema(),
        messages: [
          {
            role: 'system',
            content: [
              'You clean up web recipe extractions for a household dinner app.',
              'Return valid JSON matching the provided schema.',
              settings.magic_recipe_import_prompt,
              settings.magic_recipe_detail_prompt,
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              url: parsedUrl.toString(),
              baseline_draft: source.baselineDraft,
              source_title: source.sourceTitle,
              used_json_ld: source.usedJsonLd,
              source_excerpt: source.cleanedTextExcerpt,
            }),
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`OpenAI request failed: ${aiResponse.status} ${errorText}`);
    }

    const data = await aiResponse.json();
    const message = data.choices && data.choices[0] ? data.choices[0].message : null;
    const content = extractAssistantText(message);
    if (!content) {
      throw new Error('OpenAI did not return a recipe draft.');
    }
    draft = JSON.parse(content);
    extractorModel = OPENAI_RECIPE_MODEL;
    fetchStatus = 'ok';
  }

  if (!draft || !draft.title || !Array.isArray(draft.ingredients) || !Array.isArray(draft.steps)) {
    throw new Error('Recipe extraction did not produce a usable recipe draft.');
  }

  const normalizedDraft = normalizeRecipePayload(draft);
  if (!normalizedDraft.source_url) normalizedDraft.source_url = parsedUrl.toString();
  if (!normalizedDraft.source_domain) normalizedDraft.source_domain = parsedUrl.hostname.replace(/^www\./, '');
  if (!normalizedDraft.source_title) normalizedDraft.source_title = source.sourceTitle;

  const { rows } = await pool.query(
    `INSERT INTO recipe_imports (
       source_url, fetch_status, extractor_model, raw_text_excerpt, extracted_json, error_message
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id`,
    [
      parsedUrl.toString(),
      fetchStatus,
      extractorModel,
      source.cleanedTextExcerpt,
      JSON.stringify(normalizedDraft),
      null,
    ]
  );

  return {
    draft: normalizedDraft,
    import_record_id: rows[0].id,
    context_summary: {
      used_json_ld: source.usedJsonLd,
      model_used: extractorModel,
      prompt_used: settings.magic_recipe_import_prompt,
    },
  };
}

async function getMagicMealContext() {
  const [{ rows: meals }, { rows: stats }, settings] = await Promise.all([
    pool.query(
      `SELECT id, name, notes, active_time_min, total_time_min,
              equipment, cook, kid_rating, is_new, is_protected, tags
       FROM meals
       ORDER BY name`
    ),
    pool.query(
      `SELECT m.id,
              COALESCE(c.times_cooked, 0)::int AS times_cooked,
              c.last_cooked_date,
              COALESCE(v.love_count, 0)::int AS love_count,
              COALESCE(v.like_count, 0)::int AS like_count,
              COALESCE(v.dislike_count, 0)::int AS dislike_count,
              COALESCE(v.shrug_count, 0)::int AS shrug_count
       FROM meals m
       LEFT JOIN (
         SELECT meal_id,
                COUNT(*) AS times_cooked,
                MAX(cooked_date) AS last_cooked_date
         FROM cook_log
         WHERE meal_id IS NOT NULL
         GROUP BY meal_id
       ) c ON c.meal_id = m.id
       LEFT JOIN (
         SELECT meal_id,
                COUNT(*) FILTER (WHERE reaction = '❤️') AS love_count,
                COUNT(*) FILTER (WHERE reaction = '👍') AS like_count,
                COUNT(*) FILTER (WHERE reaction = '👎') AS dislike_count,
                COUNT(*) FILTER (WHERE reaction = '🤷') AS shrug_count
         FROM meal_votes
         GROUP BY meal_id
       ) v ON v.meal_id = m.id
       ORDER BY m.name`
    ),
    getMagicMealSettings(),
  ]);

  const statsByMealId = new Map(stats.map(row => [row.id, row]));

  return {
    settings,
    meals: meals.map(meal => {
      const mealStats = statsByMealId.get(meal.id) || {};
      return {
        id: meal.id,
        name: meal.name,
        notes: meal.notes,
        active_time_min: meal.active_time_min,
        total_time_min: meal.total_time_min,
        equipment: meal.equipment,
        cook: meal.cook,
        kid_rating: meal.kid_rating,
        is_new: meal.is_new,
        is_protected: meal.is_protected,
        tags: meal.tags,
        times_cooked: mealStats.times_cooked || 0,
        last_cooked_date: mealStats.last_cooked_date || null,
        votes: {
          love: mealStats.love_count || 0,
          like: mealStats.like_count || 0,
          dislike: mealStats.dislike_count || 0,
          shrug: mealStats.shrug_count || 0,
        },
      };
    }),
  };
}

async function getCookLogEntries(limit = 150) {
  const safeLimit = Math.min(parsePositiveInt(limit, 150), 1000);
  const { rows } = await pool.query(
    `SELECT c.id,
            c.cooked_date,
            c.meal_id,
            cooked.name AS meal_name,
            c.planned_meal_id,
            planned.name AS planned_meal_name,
            c.was_planned,
            c.notes,
            c.created_at
     FROM cook_log c
     LEFT JOIN meals cooked ON cooked.id = c.meal_id
     LEFT JOIN meals planned ON planned.id = c.planned_meal_id
     ORDER BY c.cooked_date DESC, c.created_at DESC, c.id DESC
     LIMIT $1`,
    [safeLimit]
  );

  return rows.map(row => ({
    ...row,
    meal_name: row.meal_name || 'Unknown meal',
    planned_meal_name: row.planned_meal_name || null,
  }));
}

async function generateMagicMeal(requestNotes = '') {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured on the server.');
  }

  const context = await getMagicMealContext();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      ...reasoningParamsFor(OPENAI_MODEL),
      max_completion_tokens: 1600,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'magic_meal_draft',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'notes', 'recipe_tips', 'active_time_min', 'total_time_min', 'equipment', 'cook', 'kid_rating', 'is_new', 'is_protected', 'tags', 'why_it_fits'],
            properties: {
              name: {
                type: 'string',
                description: 'Plain meal title only, like "Lemon Herb Chicken Skillet". Do not return JSON, schema text, or labels.',
              },
              notes: {
                type: 'string',
                description: 'Short description of the meal and why it fits a weeknight slot.',
              },
              recipe_tips: {
                type: 'string',
                description: 'Compact prep and cooking guidance for the household cook.',
              },
              active_time_min: { type: ['integer', 'null'], minimum: 0 },
              total_time_min: { type: ['integer', 'null'], minimum: 0 },
              equipment: {
                type: 'array',
                items: { type: 'string' },
                description: 'Short equipment list, e.g. ["skillet", "knife", "cutting board"].',
              },
              cook: {
                type: 'string',
                description: 'One cook label such as "👨‍🍳", "👩‍🍳", "👨‍🍳 / 👩‍🍳", "👩‍🍳 or 👨‍🍳", or "—".',
              },
              kid_rating: {
                type: 'string',
                enum: ['', '🟢', '🟡', '🔵', '🔴'],
                description: 'Pick one household rating emoji or empty string.',
              },
              is_new: { type: 'boolean' },
              is_protected: { type: 'boolean' },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Short lowercase tags only.',
              },
              why_it_fits: {
                type: 'string',
                description: 'Short explanation of why this meal fits the household patterns and preferences.',
              },
            },
          },
        },
      },
      messages: [
        {
          role: 'system',
          content: [
            'You are helping a family dinner app propose one new recurring meal draft.',
            'The response must be valid JSON matching the provided schema.',
            'Recommend exactly one new meal idea that fits the household and is distinct from the existing meal list.',
            'Keep the dish practical, realistic, and appealing for repeated use.',
            'Be concise so you have room to return the full JSON object.',
            'The name field must be a human-readable meal title only, never schema text or JSON fragments.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            task: 'Propose one new dinner meal draft for the household meal library.',
            stored_prompt: context.settings.magic_meal_prompt,
            request_notes: requestNotes,
            meal_history: context.meals,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const message = data.choices && data.choices[0] ? data.choices[0].message : null;
  const finishReason = data.choices && data.choices[0] ? data.choices[0].finish_reason : '';
  const refusal = message && typeof message.refusal === 'string' ? message.refusal : '';
  const content = extractAssistantText(message);

  if (!content) {
    if (finishReason === 'length') {
      throw new Error('OpenAI ran out of completion budget before returning the meal draft. Try again with a shorter request note or different model.');
    }
    throw new Error(refusal || `OpenAI did not return a meal draft. Raw response: ${JSON.stringify(data)}`);
  }

  const draft = JSON.parse(content);
  if (
    !draft ||
    typeof draft.name !== 'string' ||
    !draft.name.trim() ||
    draft.name.trim().startsWith('{') ||
    draft.name.includes('"type"')
  ) {
    throw new Error('Magic Meal returned an invalid meal name. Retry generation.');
  }
  return {
    draft,
    context_summary: {
      meal_count: context.meals.length,
      prompt_used: context.settings.magic_meal_prompt,
    },
  };
}

async function getMagicGroceryContext(date) {
  const [settings, week] = await Promise.all([
    getMagicGrocerySettings(),
    weekDataForDate(date),
  ]);

  const plannedMeals = week.days
    .filter(day => day.meal && !day.order_in && !day.meal.is_protected)
    .map(day => ({
      date: day.date,
      day_name: day.day_name,
      meal_name: day.meal.name,
      notes: day.meal.notes,
      recipe_tips: day.meal.recipe_tips,
      active_time_min: day.meal.active_time_min,
      total_time_min: day.meal.total_time_min,
      tags: day.meal.tags || [],
      cook: day.meal.cook,
    }));

  const weekStartDate = parseDateOnly(week.week_start);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekEndDate.getDate() + 6);

  return {
    settings,
    week_start: week.week_start,
    week_end: localDateString(weekEndDate),
    planned_meals: plannedMeals,
  };
}

async function generateMagicGroceryList(targetDate, requestNotes = '') {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured on the server.');
  }

  const context = await getMagicGroceryContext(targetDate);
  if (!context.planned_meals.length) {
    return {
      list: {
        title: 'Weekly Grocery List',
        sections: [],
        prep_notes: ['No cook-at-home meals found for this week.'],
      },
      context_summary: {
        week_start: context.week_start,
        week_end: context.week_end,
        meal_count: 0,
        prompt_used: context.settings.magic_grocery_prompt,
      },
    };
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      ...reasoningParamsFor(OPENAI_MODEL),
      max_completion_tokens: 2200,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'magic_grocery_list',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'sections', 'prep_notes'],
            properties: {
              title: { type: 'string' },
              sections: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['name', 'items'],
                  properties: {
                    name: { type: 'string' },
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['name', 'quantity', 'used_for'],
                        properties: {
                          name: { type: 'string' },
                          quantity: { type: 'string' },
                          used_for: {
                            type: 'array',
                            items: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
              prep_notes: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
        },
      },
      messages: [
        {
          role: 'system',
          content: [
            'You generate practical weekly grocery lists for a family dinner app.',
            'Infer likely ingredients from meal names, notes, and recipe tips.',
            'Consolidate overlapping ingredients and prefer realistic quantity estimates.',
            'Group by typical grocery sections.',
            'Return valid JSON that matches the schema exactly.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            task: 'Generate one consolidated grocery list for the planned week meals.',
            stored_prompt: context.settings.magic_grocery_prompt,
            request_notes: requestNotes,
            week_start: context.week_start,
            planned_meals: context.planned_meals,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const message = data.choices && data.choices[0] ? data.choices[0].message : null;
  const finishReason = data.choices && data.choices[0] ? data.choices[0].finish_reason : '';
  const refusal = message && typeof message.refusal === 'string' ? message.refusal : '';
  const content = extractAssistantText(message);

  if (!content) {
    if (finishReason === 'length') {
      throw new Error('OpenAI ran out of completion budget before returning the grocery list. Try a shorter request note or different model.');
    }
    throw new Error(refusal || `OpenAI did not return a grocery list. Raw response: ${JSON.stringify(data)}`);
  }

  const list = JSON.parse(content);
  if (!list || !Array.isArray(list.sections)) {
    throw new Error('Magic Grocery returned invalid JSON. Retry generation.');
  }

  return {
    list,
    context_summary: {
      week_start: context.week_start,
      week_end: context.week_end,
      meal_count: context.planned_meals.length,
      prompt_used: context.settings.magic_grocery_prompt,
    },
  };
}

/** ISO day-of-week: Mon=1 … Sun=7 */
function isoDay(date) {
  const d = date.getDay();
  return d === 0 ? 7 : d;
}

/** Rotation week (1–3) for the week that contains `date`. */
async function rotationWeek(date) {
  const monday = mondayOf(date);
  const { rows } = await pool.query(
    "SELECT value FROM app_config WHERE key = 'rotation_start_date'"
  );
  if (!rows.length) return 1;
  const start = mondayOf(parseDateOnly(rows[0].value));
  const weeks = Math.round((monday - start) / (7 * 86400 * 1000));
  return ((weeks % 3) + 3) % 3 + 1;
}

/** Fetch the planned meal for a given date. */
async function mealForDate(date) {
  const dateStr = localDateString(date);
  const { rows } = await pool.query(
    `SELECT m.*, p.note AS plan_note
     FROM plan_days p
     JOIN meals m ON m.id = p.meal_id
     WHERE p.plan_date = $1`,
    [dateStr]
  );
  return rows[0] || null;
}

/** Rotation-template suggestions for the week containing `date`, keyed by ISO day. */
async function rotationWeekSlots(date) {
  const rw = await rotationWeek(date);
  const { rows } = await pool.query(
    `SELECT r.day_of_week, m.id, m.name, m.cook, m.kid_rating, m.is_new,
            m.is_protected, m.active_time_min, m.total_time_min
     FROM meal_rotation r
     JOIN meals m ON m.id = r.meal_id
     WHERE r.week_number = $1`,
    [rw]
  );
  return new Map(rows.map(row => [row.day_of_week, row]));
}

/** Set or clear the planned meal for a date. `mealId` null clears the day. */
async function upsertPlanDay(date, mealId, note = null, createdBy = null) {
  if (mealId === null) {
    await pool.query('DELETE FROM plan_days WHERE plan_date = $1', [date]);
    return;
  }
  await pool.query(
    `INSERT INTO plan_days (plan_date, meal_id, note, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (plan_date)
     DO UPDATE SET meal_id = $2, note = $3, created_by = $4, updated_at = NOW()`,
    [date, mealId, note, createdBy]
  );
}

/** Week plan payload for the Plan page: resolved days + rotation suggestions. */
async function planForDate(date) {
  const [week, suggestions] = await Promise.all([
    weekDataForDate(date),
    rotationWeekSlots(date).catch(() => new Map()),
  ]);

  return {
    ...week,
    days: week.days.map(day => ({
      ...day,
      rotation_suggestion: suggestions.get(day.day_of_week) || null,
    })),
  };
}

/** Returns order-in status + restaurant vote tallies for a date, or null. */
async function orderInForDate(dateStr) {
  const { rows } = await pool.query(
    'SELECT * FROM order_in_nights WHERE order_date = $1', [dateStr]
  );
  if (!rows.length) return null;

  const { rows: voteRows } = await pool.query(
    `SELECT r.id, r.name, r.emoji,
            COUNT(rv.id)::int AS count,
            COALESCE(ARRAY_AGG(f.name) FILTER (WHERE f.name IS NOT NULL), '{}') AS voters
     FROM restaurants r
     LEFT JOIN restaurant_votes rv ON rv.restaurant_id = r.id AND rv.order_date = $1
     LEFT JOIN family_members f ON f.id = rv.member_id
     WHERE r.active = true
     GROUP BY r.id, r.name, r.emoji
     ORDER BY lower(r.name), r.id`,
    [dateStr]
  );
  return { ...rows[0], votes: mergeRestaurantVoteRows(voteRows) };
}

async function weekDataForDate(date) {
  const now      = new Date(date);
  const monday   = mondayOf(now);
  const sunday   = new Date(monday);
  const todayStr = localDateString(new Date()); // actual today, not the requested week

  sunday.setDate(monday.getDate() + 6);

  const weekStart = localDateString(monday);
  const weekEnd   = localDateString(sunday);

  const [{ rows: planRows }, { rows: orderInRows }, { rows: addonRows }, restaurants] = await Promise.all([
    pool.query(
      `SELECT p.plan_date, p.note AS plan_note, m.*
       FROM plan_days p
       JOIN meals m ON m.id = p.meal_id
       WHERE p.plan_date BETWEEN $1 AND $2
       ORDER BY p.plan_date`,
      [weekStart, weekEnd]
    ),
    pool.query(
      `SELECT o.order_date, o.id AS order_in_id, o.created_by, o.created_at,
              r.id, r.name, r.emoji,
              COUNT(rv.id)::int AS count,
              COALESCE(ARRAY_AGG(f.name) FILTER (WHERE f.name IS NOT NULL), '{}') AS voters
       FROM order_in_nights o
       JOIN restaurants r ON r.active = true
       LEFT JOIN restaurant_votes rv
         ON rv.order_date = o.order_date
        AND rv.restaurant_id = r.id
       LEFT JOIN family_members f ON f.id = rv.member_id
       WHERE o.order_date BETWEEN $1 AND $2
       GROUP BY o.order_date, o.id, o.created_by, o.created_at, r.id, r.name, r.emoji
       ORDER BY o.order_date, count DESC, r.name`,
      [weekStart, weekEnd]
    ),
    pool.query(
      `SELECT addon_date, note, updated_by, updated_at
       FROM tonight_addons
       WHERE addon_date BETWEEN $1 AND $2`,
      [weekStart, weekEnd]
    ),
    getActiveRestaurants(),
  ]);

  const plansByDate = new Map(
    planRows.map(row => [localDateString(parseDateOnly(row.plan_date)), row])
  );
  const addonsByDate = new Map(
    addonRows.map(row => [localDateString(parseDateOnly(row.addon_date)), row])
  );
  const orderInByDate = new Map();

  for (const row of orderInRows) {
    const dateStr = localDateString(parseDateOnly(row.order_date));
    if (!orderInByDate.has(dateStr)) {
      orderInByDate.set(dateStr, {
        id: row.order_in_id,
        order_date: dateStr,
        created_by: row.created_by,
        created_at: row.created_at,
        vote_rows: [],
      });
    }

    orderInByDate.get(dateStr).vote_rows.push({
      id: row.id,
      name: row.name,
      emoji: row.emoji,
      count: row.count,
      voters: row.voters,
    });
  }

  for (const [dateStr, orderIn] of orderInByDate.entries()) {
    orderInByDate.set(dateStr, {
      id: orderIn.id,
      order_date: orderIn.order_date,
      created_by: orderIn.created_by,
      created_at: orderIn.created_at,
      votes: mergeRestaurantVoteRows(orderIn.vote_rows),
    });
  }

  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);

    const dateStr = localDateString(day);
    const meal = plansByDate.get(dateStr) || null;
    const orderIn = resolveDayOrderIn(dateStr, meal, orderInByDate.get(dateStr) || null, restaurants);
    days.push({
      date: dateStr,
      day_name: day.toLocaleDateString('en-US', { weekday: 'long' }),
      day_of_week: i + 1,
      is_today: dateStr === todayStr,
      meal,
      order_in: orderIn,
      addon_note: addonsByDate.get(dateStr)?.note || '',
    });
  }

  return {
    week_start: weekStart,
    days,
  };
}

// ── Routes ───────────────────────────────────────────────────

app.get('/', async (req, res) => {
  if (await redirectToSetupIfNeeded(req, res, 'setup')) return;
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/setup', async (req, res) => {
  try {
    const state = await bootstrapState();
    if (!state.bootstrap.needs_household) return res.redirect('./');
    res.sendFile(path.join(__dirname, 'public', 'setup.html'));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    app: 'family-dinner',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      app: 'family-dinner',
      checks: { db: 'ok' },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      app: 'family-dinner',
      checks: { db: 'error' },
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/bootstrap', async (_req, res) => {
  try {
    res.json(await bootstrapState());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bootstrap/starter-content', async (_req, res) => {
  try {
    if ((await countTable('restaurants')) > 0) {
      return res.status(409).json({ error: 'Starter content already installed', code: 'starter_content_exists' });
    }
    await withPoolTransaction(async queryable => {
      await installStarterContent(queryable);
      await installDefaultAppConfig(defaultRotationStartDate(), queryable);
    });
    res.status(201).json({ ok: true, bootstrap: (await bootstrapState()).bootstrap });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bootstrap/household', async (req, res) => {
  try {
    const state = await bootstrapState();
    if (!state.bootstrap.needs_household) {
      return res.status(409).json({ error: 'Household already initialized', code: 'household_already_initialized' });
    }

    const members = normalizeBootstrapMembers(req.body?.members);
    const rotationStartDate = String(req.body?.rotation_start_date || defaultRotationStartDate()).trim();
    const installStarter = req.body?.install_starter_content !== false;

    if (!members.length) {
      return res.status(400).json({ error: 'At least one household member is required', code: 'members_required' });
    }
    if (!members.some(member => member.role === 'parent')) {
      return res.status(400).json({ error: 'At least one parent is required', code: 'parent_required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rotationStartDate)) {
      return res.status(400).json({ error: 'rotation_start_date must be YYYY-MM-DD', code: 'invalid_rotation_start_date' });
    }

    const result = await withPoolTransaction(async queryable => {
      const createdMembers = [];
      for (const member of members) {
        const { rows } = await queryable.query(`
          INSERT INTO family_members (name, role, is_picky, hates_leftovers, avatar_emoji)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, name, role, is_picky, hates_leftovers, avatar_emoji
        `, [
          member.name,
          member.role,
          member.is_picky,
          member.hates_leftovers,
          member.avatar_emoji,
        ]);
        createdMembers.push(rows[0]);
      }

      await installDefaultAppConfig(rotationStartDate, queryable);
      if (installStarter) {
        await installStarterContent(queryable);
      }

      return { members: createdMembers };
    });

    res.status(201).json({
      ok: true,
      created_members: result.members,
      bootstrap: (await bootstrapState()).bootstrap,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// /tonight — simple display page (Raspberry Pi / home screen shortcut)
app.get('/tonight', async (req, res) => {
  try {
    const now     = new Date();
    const week    = await weekDataForDate(now);
    const today   = week.days.find(day => day.is_today);
    const dateStr = localDateString(now);
    const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
    const orderIn = today ? today.order_in : null;
    const meal    = today ? today.meal : null;

    const isOrderIn = !!(orderIn || (meal && meal.is_protected));
    const canVoteMeal = !!(meal && !isOrderIn);
    const name      = meal ? meal.name : 'Nothing planned';
    const cook      = meal ? (meal.cook || '') : '';
    const rating    = meal ? (meal.kid_rating || '') : '';
    const mealId    = meal ? meal.id : null;
    const safeDayName = escapeHtml(dayName);
    const safeName = escapeHtml(name);
    const safeCook = escapeHtml(cook);
    const safeRating = escapeHtml(rating);
    const safeOgDescription = escapeHtml(isOrderIn ? 'Order in night — vote for where!' : name);

    const addonNote = today && today.addon_note ? String(today.addon_note) : '';
    const safeAddonNote = escapeHtml(addonNote);
    const ratingDesc = rating.includes('🟢') ? 'Whole family'
      : rating.includes('🟡') ? 'Adults + daughter'
      : rating.includes('🔵') ? 'Adults + son'
      : rating.includes('🔴') ? 'Adults only'
      : '';
    const notes = meal && meal.notes ? escapeHtml(meal.notes) : '';
    const timeChip = meal && meal.total_time_min
      ? (meal.total_time_min >= 60
          ? `${Math.floor(meal.total_time_min / 60)}h${meal.total_time_min % 60 ? ` ${meal.total_time_min % 60}m` : ''}`
          : `${meal.total_time_min}m`)
      : '';
    // Embed restaurants + current votes as JSON for the client script
    const votesJson = safeScriptJson(orderIn ? orderIn.votes : []);

    res.send(`<!DOCTYPE html>
<html lang="en">
	<head>
	  <meta charset="UTF-8">
	  <meta name="viewport" content="width=device-width, initial-scale=1">
	  <meta name="theme-color" content="#0f0f0f">
	  <title>Tonight's Dinner 🍽️</title>
	  <link rel="icon" href="favicon.svg" type="image/svg+xml">
	  <link rel="stylesheet" href="sovereign-fonts.css">
	  <link rel="stylesheet" href="sovereign-chassis.css">
	  <link rel="stylesheet" href="tokens.css">
	  <link rel="stylesheet" href="dinner-skin.css">
	  <link rel="stylesheet" href="style.css">
	  <meta property="og:title" content="Tonight's Dinner">
	  <meta property="og:description" content="${safeOgDescription}">
	  <meta property="og:image" content="og-image.svg">
  <meta property="og:type" content="website">
	  <style>
	    .tonight-route-shell {
	      margin: 0 auto;
	      max-width: 720px;
	      padding: 1.5rem 1rem 6rem;
	      text-align: center;
	      width: 100%;
	    }
	    .tn-card {
	      background: var(--surface);
	      border: 1px solid var(--border);
	      border-radius: var(--radius, 16px);
	      overflow: hidden;
	      padding: 2rem 1.25rem 1.75rem;
	      position: relative;
	    }
	    .tn-card::before {
	      background: linear-gradient(90deg, var(--accent), transparent 70%);
	      content: '';
	      height: 3px;
	      inset: 0 0 auto 0;
	      position: absolute;
	    }
	    .tn-day   { color: var(--muted); font-size: .95rem; letter-spacing: .15em; margin-bottom: 1rem; text-transform: uppercase; }
	    .tn-label { color: var(--accent); font-size: .8rem; font-weight: 700; letter-spacing: .22em; margin-bottom: .5rem; text-transform: uppercase; }
	    .tn-meal  { font-size: clamp(2rem, 7vw, 3.4rem); font-weight: 750; line-height: 1.12; margin-bottom: .9rem; overflow-wrap: anywhere; }
	    .tn-sub   { color: var(--muted); font-size: 1rem; line-height: 1.5; margin: 0 auto 1rem; max-width: 34rem; }
	    .tn-chips { display: flex; flex-wrap: wrap; gap: .4rem; justify-content: center; margin-bottom: 1rem; }
	    .tn-chip  {
	      background: var(--surface2, var(--elevated-bg));
	      border: 1px solid var(--border);
	      border-radius: 999px;
	      color: var(--muted);
	      font-size: .85rem;
	      font-weight: 600;
	      padding: .3rem .8rem;
	    }
	    .tn-chip.big { font-size: 1.05rem; }
	    .addon {
	      background: var(--surface2, var(--elevated-bg));
	      border: 1px dashed var(--border);
	      border-radius: 10px;
	      color: var(--muted);
	      font-size: .95rem;
	      line-height: 1.45;
	      margin: 0 auto 1rem;
	      max-width: 32rem;
	      padding: .75rem .9rem;
	    }
	    .addon.hidden { display: none; }
	    .tn-section { color: var(--muted); font-size: .85rem; font-weight: 700; letter-spacing: .12em; margin: 1.5rem 0 .75rem; text-transform: uppercase; }
	    /* Restaurant voting grid — the kids' arena */
	    .r-grid { display: grid; gap: .65rem; grid-template-columns: repeat(2, 1fr); margin: 1rem auto 0; max-width: 420px; width: 100%; }
	    .r-btn  {
	      align-items: center;
	      background: var(--surface2, var(--elevated-bg));
	      border: 2px solid var(--border);
	      border-radius: 16px;
	      color: var(--text);
	      cursor: pointer;
	      display: flex;
	      flex-direction: column;
	      font-family: inherit;
	      gap: .25rem;
	      min-height: 92px;
	      padding: .9rem .5rem;
	      position: relative;
	      transition: border-color .15s, background .15s, transform .1s;
	    }
	    .r-btn:hover  { border-color: var(--muted); }
	    .r-btn:active { transform: scale(.97); }
	    .r-btn.active { background: var(--accent-soft, rgba(249,115,22,.12)); border-color: var(--accent); }
	    .r-btn.leading { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft, rgba(249,115,22,.18)); }
	    .r-crown  { font-size: 1rem; position: absolute; right: .5rem; top: .4rem; }
	    .r-emoji  { font-size: 2.1rem; line-height: 1.15; }
	    .r-name   { font-size: .9rem; font-weight: 650; }
	    .r-count  {
	      background: var(--accent);
	      border-radius: 999px;
	      color: #fff;
	      font-size: .8rem;
	      font-weight: 800;
	      left: .5rem;
	      min-width: 1.5rem;
	      padding: .1rem .35rem;
	      position: absolute;
	      top: .4rem;
	    }
	    .r-voters { color: var(--muted); font-size: .72rem; line-height: 1.3; }
	    .tn-writein { display: flex; gap: .5rem; margin: .85rem auto 0; max-width: 420px; }
	    .tn-writein input {
	      background: var(--surface2, var(--elevated-bg));
	      border: 1px solid var(--border);
	      border-radius: 12px;
	      color: var(--text);
	      flex: 1;
	      font: inherit;
	      min-width: 0;
	      padding: .65rem .8rem;
	    }
	    .tn-writein button {
	      background: transparent;
	      border: 1px solid var(--border);
	      border-radius: 12px;
	      color: var(--text);
	      cursor: pointer;
	      font: inherit;
	      font-weight: 600;
	      padding: .65rem 1rem;
	    }
	    .tn-writein button:hover { border-color: var(--accent); color: var(--accent); }
	    /* Meal reactions */
	    .react-row { display: flex; flex-wrap: wrap; gap: .6rem; justify-content: center; margin-top: .5rem; }
	    .react-btn {
	      align-items: center;
	      background: var(--surface2, var(--elevated-bg));
	      border: 2px solid var(--border);
	      border-radius: 999px;
	      cursor: pointer;
	      display: flex;
	      font-size: 1.6rem;
	      height: 3.4rem;
	      justify-content: center;
	      transition: border-color .15s, background .15s, transform .1s;
	      width: 3.4rem;
	    }
	    .react-btn:hover  { border-color: var(--muted); }
	    .react-btn:active { transform: scale(1.15); }
	    .react-btn.active { background: var(--accent-soft, rgba(249,115,22,.12)); border-color: var(--accent); }
	    .react-display { color: var(--muted); font-size: 1.05rem; margin-top: .8rem; }
	    .recipe-link {
	      border: 1px solid var(--accent-border-soft, rgba(249,115,22,.35));
	      border-radius: 999px;
	      color: var(--accent);
	      display: inline-block;
	      font-weight: 600;
	      margin-top: .25rem;
	      padding: .45rem 1rem;
	      text-decoration: none;
	    }
	    /* Member picker */
	    .picker { align-items: center; background: rgba(0,0,0,.8); display: flex; inset: 0; justify-content: center; padding: 1rem; position: fixed; z-index: 60; }
	    .picker.hidden { display: none; }
	    .picker-box { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; max-width: 320px; padding: 1.5rem; width: 100%; }
	    .picker-box h2 { font-size: 1.1rem; margin-bottom: 1rem; }
	    .m-grid { display: grid; gap: .75rem; grid-template-columns: 1fr 1fr; }
	    .m-btn  { align-items: center; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; color: var(--text); cursor: pointer; display: flex; flex-direction: column; font-family: inherit; gap: .3rem; padding: .9rem .5rem; transition: border-color .15s; }
	    .m-btn:hover { border-color: var(--accent); }
	    .m-avatar { font-size: 1.6rem; }
	    .week-link { border-bottom: 1px solid var(--border); color: var(--dim); display: inline-block; font-size: .85rem; letter-spacing: .08em; margin-top: 1.25rem; padding-bottom: 1px; text-decoration: none; }
	    .week-link:hover { color: var(--muted); }
		  </style>
		</head>
		<body data-nav-page="tonight" data-nav-root=".">
	  <div id="app" class="tonight-route-shell">
	  <div class="tn-card">
	  <div class="tn-day">${safeDayName}</div>
	  <div class="tn-label">Tonight's Dinner</div>

	  ${isOrderIn ? `
    <div class="tn-meal">Order In 🛵</div>
    <div class="tn-sub">No cooking tonight — vote for where!</div>
    <div id="tonight-addon" class="addon${safeAddonNote ? '' : ' hidden'}">${safeAddonNote}</div>
    <div class="r-grid" id="r-grid"></div>
    <div class="tn-writein">
      <input id="write-in-name" type="text" placeholder="Write-in restaurant">
      <button type="button" onclick="castWriteInVote()">Add</button>
    </div>
	  ` : `
	    <div class="tn-meal">${safeName}</div>
	    ${notes ? `<div class="tn-sub">${notes}</div>` : ''}
	    <div class="tn-chips">
	      ${safeCook ? `<span class="tn-chip big">${safeCook}</span>` : ''}
	      ${ratingDesc ? `<span class="tn-chip">${safeRating} ${ratingDesc}</span>` : ''}
	      ${timeChip ? `<span class="tn-chip">⏱ ${timeChip}</span>` : ''}
	    </div>
	    <div id="tonight-addon" class="addon${safeAddonNote ? '' : ' hidden'}">${safeAddonNote}</div>
	    ${meal && meal.recipe_id ? `<a class="recipe-link" href="./recipes/${meal.recipe_id}">Open recipe →</a>` : ''}
	    ${canVoteMeal ? `
	      <div class="tn-section">How did this one land?</div>
      <div class="react-row" id="meal-votes"></div>
      <div class="react-display" id="meal-vote-display"></div>
    ` : ''}
  `}

  </div>

  ${(isOrderIn || canVoteMeal) ? `
  <!-- Member picker overlay -->
  <div class="picker hidden" id="picker">
    <div class="picker-box">
      <h2>Who are you?</h2>
      <div class="m-grid" id="m-grid"></div>
    </div>
  </div>
  ` : ''}

	  <a href="./" class="week-link">see the full week →</a>
	  </div>

	  <script src="theme.js"></script>
	  <script src="nav.js"></script>
	  ${(isOrderIn || canVoteMeal) ? `
	  <script>
    const DATE = '${dateStr}';
    const MEAL_ID = ${mealId || 'null'};
    const orderInVotes = ${votesJson};
    const MEAL_REACTIONS = ['❤️', '👍', '👎', '🤷'];
    let me = JSON.parse(localStorage.getItem('fd_member') || 'null');
    let members = [];

    async function init() {
      const res = await fetch('./api/members');
      members = await res.json();
      if (document.getElementById('r-grid')) renderOrderInGrid(orderInVotes);
      if (MEAL_ID && document.getElementById('meal-votes')) renderMealVotes();
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function renderOrderInGrid(v) {
      const grid = document.getElementById('r-grid');
      if (!grid) return;
      const mv = me ? v.find(r => r.voters && r.voters.includes(me.name)) : null;
      const topCount = Math.max(0, ...v.map(r => r.count || 0));
      grid.innerHTML = v.map(r => {
        const leading = topCount > 0 && r.count === topCount;
        const voters = Array.isArray(r.voters) ? r.voters.map(escapeHtml).join(', ') : '';
        return \`
        <button class="r-btn\${mv && mv.id === r.id ? ' active' : ''}\${leading ? ' leading' : ''}"
                onclick="castOrderInVote(\${r.id})">
          \${r.count > 0 ? \`<span class="r-count">\${r.count}</span>\` : ''}
          \${leading ? '<span class="r-crown">👑</span>' : ''}
          <span class="r-emoji">\${escapeHtml(r.emoji || '')}</span>
          <span class="r-name">\${escapeHtml(r.name)}</span>
          \${voters ? \`<span class="r-voters">\${voters}</span>\` : ''}
        </button>\`;
      }).join('');
    }

    async function castOrderInVote(restaurantId) {
      if (!me) { openPicker(() => castOrderInVote(restaurantId)); return; }
      const res = await fetch(\`./api/order-in/\${DATE}/vote\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: restaurantId, member_id: me.id }),
      });
      const data = await res.json();
      if (data.order_in) renderOrderInGrid(data.order_in.votes);
    }

    async function castWriteInVote() {
      const input = document.getElementById('write-in-name');
      if (!input) return;
      const name = input.value.trim();
      if (!name) return;
      if (!me) { openPicker(() => castWriteInVote()); return; }
      const res = await fetch(\`./api/order-in/\${DATE}/write-in\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: me.id, name }),
      });
      const data = await res.json();
      if (data.order_in) {
        renderOrderInGrid(data.order_in.votes);
        input.value = '';
      }
    }

    async function renderMealVotes() {
      const grid = document.getElementById('meal-votes');
      if (!grid) return;

      const res = await fetch(\`./api/votes/\${MEAL_ID}?date=\${encodeURIComponent(DATE)}\`);
      const votes = await res.json();
      const myVote = me ? votes.find(v => v.name === me.name) : null;

      grid.innerHTML = MEAL_REACTIONS.map(r => \`
        <button class="react-btn\${myVote && myVote.reaction === r ? ' active' : ''}"
                onclick="castMealVote('\${r}')" aria-label="React \${r}">\${r}</button>\`).join('');

      const display = document.getElementById('meal-vote-display');
      if (display) {
        display.textContent = votes.length
          ? votes.map(v => \`\${v.avatar_emoji} \${v.reaction}\`).join('  ')
          : 'No reactions yet';
      }
    }

    async function castMealVote(reaction) {
      if (!me) { openPicker(() => castMealVote(reaction)); return; }
      await fetch('./api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meal_id: MEAL_ID, member_id: me.id, reaction, meal_date: DATE }),
      });
      await renderMealVotes();
    }

    function openPicker(cb) {
      const picker = document.getElementById('picker');
      const grid = document.getElementById('m-grid');
      picker.classList.remove('hidden');
      grid.innerHTML = members.map(m => \`
        <button class="m-btn" onclick="pickMember(\${m.id})">
          <span class="m-avatar">\${escapeHtml(m.avatar_emoji || '')}</span>
          <span>\${escapeHtml(m.name)}</span>
        </button>\`).join('');
      picker._cb = cb;
    }

    function pickMember(id) {
      me = members.find(m => m.id === id);
      localStorage.setItem('fd_member', JSON.stringify(me));
      document.getElementById('picker').classList.add('hidden');
      const cb = document.getElementById('picker')._cb;
      if (cb) cb();
      if (MEAL_ID && document.getElementById('meal-votes')) renderMealVotes();
    }

    init();
  </script>
  ` : ''}
</body>
</html>`);
  } catch (err) {
    res.status(500).send('Error loading dinner');
  }
});

// GET /api/tonight — JSON (for home screen shortcuts / integrations)
app.get('/api/tonight', async (req, res) => {
  try {
    const now     = new Date();
    const week    = await weekDataForDate(now);
    const today   = week.days.find(day => day.is_today);
    const dateStr = localDateString(now);
    res.json({
      date: dateStr,
      day_name: now.toLocaleDateString('en-US', { weekday: 'long' }),
      meal: today ? today.meal : null,
      order_in: today ? today.order_in : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/week — full week view
app.get('/api/week', async (req, res) => {
  try {
    const requestedOffset = Number.parseInt(String(req.query?.offset_weeks || '0'), 10);
    const offsetWeeks = Number.isFinite(requestedOffset)
      ? Math.max(-12, Math.min(12, requestedOffset))
      : 0;
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + (offsetWeeks * 7));
    res.json(await weekDataForDate(targetDate));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/plan?week_start=YYYY-MM-DD — week plan + rotation suggestions
app.get('/api/plan', async (req, res) => {
  try {
    const weekStart = String(req.query?.week_start || '');
    const target = weekStart
      ? (isValidDateOnlyString(weekStart) ? parseDateOnly(weekStart) : null)
      : new Date();
    if (!target) return res.status(400).json({ error: 'week_start must be YYYY-MM-DD' });
    res.json(await planForDate(target));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/plan/day — set or clear the planned meal for one date
app.put('/api/plan/day', async (req, res) => {
  const date = String(req.body?.date || '');
  if (!isValidDateOnlyString(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  const rawMealId = req.body?.meal_id;
  const mealId = rawMealId === null || rawMealId === '' || rawMealId === undefined
    ? null
    : Number(rawMealId);
  if (mealId !== null && (!Number.isInteger(mealId) || mealId < 1)) {
    return res.status(400).json({ error: 'meal_id must be a valid meal id or null' });
  }

  try {
    if (mealId !== null) {
      const { rows } = await pool.query('SELECT 1 FROM meals WHERE id = $1', [mealId]);
      if (!rows.length) return res.status(404).json({ error: 'meal not found' });
    }
    await upsertPlanDay(
      date,
      mealId,
      req.body?.note ? String(req.body.note) : null,
      req.body?.created_by ? String(req.body.created_by) : null
    );
    res.json({ success: true, date, meal: await mealForDate(parseDateOnly(date)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/plan/autofill — fill a week from the rotation template or last week
app.post('/api/plan/autofill', async (req, res) => {
  const weekStart = String(req.body?.week_start || '');
  if (!isValidDateOnlyString(weekStart)) {
    return res.status(400).json({ error: 'week_start must be YYYY-MM-DD' });
  }

  const source = req.body?.source === 'previous_week' ? 'previous_week' : 'rotation';
  const overwrite = Boolean(req.body?.overwrite);
  const createdBy = req.body?.created_by ? String(req.body.created_by) : null;

  try {
    const monday = mondayOf(parseDateOnly(weekStart));
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      dates.push(localDateString(day));
    }

    let sourceByIsoDay;
    if (source === 'rotation') {
      sourceByIsoDay = await rotationWeekSlots(monday);
    } else {
      const prevMonday = new Date(monday);
      prevMonday.setDate(monday.getDate() - 7);
      const prevSunday = new Date(prevMonday);
      prevSunday.setDate(prevMonday.getDate() + 6);
      const { rows } = await pool.query(
        `SELECT p.plan_date, p.meal_id, EXTRACT(ISODOW FROM p.plan_date)::int AS day_of_week
         FROM plan_days p
         WHERE p.plan_date BETWEEN $1 AND $2 AND p.meal_id IS NOT NULL`,
        [localDateString(prevMonday), localDateString(prevSunday)]
      );
      sourceByIsoDay = new Map(rows.map(row => [row.day_of_week, { id: row.meal_id }]));
    }

    const { rows: existingRows } = await pool.query(
      `SELECT plan_date AS date_to_skip
       FROM plan_days
       WHERE plan_date BETWEEN $1 AND $2
       UNION
       SELECT order_date AS date_to_skip
       FROM order_in_nights
       WHERE order_date BETWEEN $1 AND $2`,
      [dates[0], dates[6]]
    );
    const planned = new Set(existingRows.map(row => localDateString(parseDateOnly(row.date_to_skip))));

    let filled = 0;
    for (let i = 0; i < 7; i++) {
      const dateStr = dates[i];
      if (!overwrite && planned.has(dateStr)) continue;
      const suggestion = sourceByIsoDay.get(i + 1);
      if (!suggestion) continue;
      await upsertPlanDay(dateStr, suggestion.id, null, createdBy);
      filled++;
    }

    res.json({ success: true, filled, plan: await planForDate(monday) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/recipe-import/settings', async (req, res) => {
  try {
    res.json(await getMagicRecipeSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/recipe-import/settings', async (req, res) => {
  const importPrompt = String(req.body.magic_recipe_import_prompt || '').trim();
  const detailPrompt = String(req.body.magic_recipe_detail_prompt || '').trim();
  if (!importPrompt || !detailPrompt) {
    return res.status(400).json({ error: 'Both recipe import prompts are required.' });
  }

  try {
    await Promise.all([
      setAppConfigValue('magic_recipe_import_prompt', importPrompt),
      setAppConfigValue('magic_recipe_detail_prompt', detailPrompt),
    ]);
    res.json({
      success: true,
      magic_recipe_import_prompt: importPrompt,
      magic_recipe_detail_prompt: detailPrompt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recipes/import', async (req, res) => {
  try {
    const sourceUrl = req.body && req.body.url ? String(req.body.url).trim() : '';
    if (!sourceUrl) return res.status(400).json({ error: 'url is required' });
    res.json(await generateRecipeImportDraft(sourceUrl));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/recipes', async (req, res) => {
  try {
    const q = String(req.query?.q || '').trim();
    const sort = String(req.query?.sort || 'title');
    const orderBy = {
      title: 'r.title',
      newest: 'r.created_at DESC, r.title',
      time: 'r.total_time_min NULLS LAST, r.title',
    }[sort] || 'r.title';

    const params = [];
    let where = '';
    if (q) {
      params.push(`%${q}%`);
      where = `WHERE r.title ILIKE $1
                  OR r.description ILIKE $1
                  OR EXISTS (SELECT 1 FROM unnest(r.tags) tag WHERE tag ILIKE $1)
                  OR EXISTS (
                    SELECT 1
                    FROM recipe_ingredients ri
                    WHERE ri.recipe_id = r.id
                      AND (
                        ri.display_text ILIKE $1
                        OR ri.ingredient_text ILIKE $1
                        OR ri.prep_note ILIKE $1
                      )
                  )`;
    }

    const { rows } = await pool.query(
      `SELECT r.id,
              r.title,
              r.description,
              r.source_url,
              r.source_domain,
              r.total_time_min,
              r.tags,
              r.created_at,
              linked.id AS linked_meal_id,
              linked.name AS linked_meal_name,
              COALESCE(ingredient_counts.count, 0)::int AS ingredient_count,
              COALESCE(step_counts.count, 0)::int AS step_count
       FROM recipes r
       LEFT JOIN LATERAL (
         SELECT id, name
         FROM meals
         WHERE recipe_id = r.id
         ORDER BY id
         LIMIT 1
       ) linked ON true
       LEFT JOIN (
         SELECT recipe_id, COUNT(*) AS count
         FROM recipe_ingredients
         GROUP BY recipe_id
       ) ingredient_counts ON ingredient_counts.recipe_id = r.id
       LEFT JOIN (
         SELECT recipe_id, COUNT(*) AS count
         FROM recipe_steps
         GROUP BY recipe_id
       ) step_counts ON step_counts.recipe_id = r.id
       ${where}
       ORDER BY ${orderBy}`,
      params
    );

    res.json(rows.map(row => ({
      ...row,
      linked_meal: row.linked_meal_id ? {
        id: row.linked_meal_id,
        name: row.linked_meal_name,
      } : null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recipes', async (req, res) => {
  const recipe = normalizeRecipePayload(req.body);
  const validationError = validateRecipePayload(recipe);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const recipeId = await saveRecipe(recipe);
    res.status(201).json(await getRecipeById(recipeId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/recipes/:id', async (req, res) => {
  const recipeId = Number(req.params.id);
  if (!Number.isInteger(recipeId) || recipeId < 1) {
    return res.status(400).json({ error: 'invalid recipe id' });
  }

  try {
    const recipe = await getRecipeById(recipeId);
    if (!recipe) return res.status(404).json({ error: 'Not found' });
    res.json(recipe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/recipes/:id', async (req, res) => {
  const recipeId = Number(req.params.id);
  if (!Number.isInteger(recipeId) || recipeId < 1) {
    return res.status(400).json({ error: 'invalid recipe id' });
  }

  const recipe = normalizeRecipePayload(req.body);
  const validationError = validateRecipePayload(recipe);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const savedRecipeId = await saveRecipe(recipe, recipeId);
    if (!savedRecipeId) return res.status(404).json({ error: 'Not found' });
    res.json(await getRecipeById(savedRecipeId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recipes/:id/create-meal', async (req, res) => {
  const recipeId = Number(req.params.id);
  if (!Number.isInteger(recipeId) || recipeId < 1) {
    return res.status(400).json({ error: 'invalid recipe id' });
  }

  try {
    const recipe = await getRecipeById(recipeId);
    if (!recipe) return res.status(404).json({ error: 'Not found' });

    const existingMealResult = await pool.query(
      'SELECT id, name, recipe_id FROM meals WHERE recipe_id = $1 ORDER BY id LIMIT 1',
      [recipeId]
    );

    if (existingMealResult.rows.length) {
      return res.json({
        created: false,
        meal: existingMealResult.rows[0],
      });
    }

    const mealDraft = recipeToMealDraft(recipe);
    const { rows } = await pool.query(
      `INSERT INTO meals (
         recipe_id, name, notes, recipe_tips, active_time_min, total_time_min,
         equipment, cook, kid_rating, is_new, is_protected, tags
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, recipe_id, name`,
      [
        recipeId,
        mealDraft.name,
        mealDraft.notes,
        mealDraft.recipe_tips,
        mealDraft.active_time_min,
        mealDraft.total_time_min,
        mealDraft.equipment,
        mealDraft.cook,
        mealDraft.kid_rating,
        mealDraft.is_new,
        mealDraft.is_protected,
        mealDraft.tags,
      ]
    );

    res.status(201).json({
      created: true,
      meal: rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/meals — all meals (for swap dropdown)
app.get('/api/meals', async (req, res) => {
  try {
    const q = String(req.query?.q || '').trim();
    const rawLimit = Number.parseInt(String(req.query?.limit || ''), 10);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : null;

    const params = [];
    let where = '';
    if (q) {
      params.push(`%${q}%`);
      where = `WHERE name ILIKE $1
                  OR notes ILIKE $1
                  OR EXISTS (SELECT 1 FROM unnest(tags) tag WHERE tag ILIKE $1)`;
    }
    if (limit) params.push(limit);

    const { rows } = await pool.query(
      `SELECT id, recipe_id, name, cook, kid_rating, is_protected, is_new,
              active_time_min, total_time_min, tags
       FROM meals
       ${where}
       ORDER BY name
       ${limit ? `LIMIT $${params.length}` : ''}`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/meals', async (req, res) => {
  const meal = normalizeMealPayload(req.body);
  const validationError = validateMealPayload(meal);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const { rows } = await pool.query(
      `INSERT INTO meals (
        recipe_id, name, notes, recipe_tips, active_time_min, total_time_min,
        equipment, cook, kid_rating, is_new, is_protected, tags
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        meal.recipe_id,
        meal.name,
        meal.notes,
        meal.recipe_tips,
        meal.active_time_min,
        meal.total_time_min,
        meal.equipment,
        meal.cook,
        meal.kid_rating,
        meal.is_new,
        meal.is_protected,
        meal.tags,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rotation — recurring 3-week plan plus meal catalog
app.get('/api/rotation', async (req, res) => {
  try {
    const [{ rows: slots }, { rows: meals }, { rows: config }, restaurants] = await Promise.all([
      pool.query(
        `SELECT r.week_number, r.day_of_week, r.meal_id,
                m.name, m.recipe_id, m.cook, m.kid_rating, m.is_protected, m.is_new
         FROM meal_rotation r
         LEFT JOIN meals m ON m.id = r.meal_id
         ORDER BY r.week_number, r.day_of_week`
      ),
      pool.query(
        `SELECT id, recipe_id, name, cook, kid_rating, is_protected, is_new, tags
         FROM meals
         ORDER BY name`
      ),
      pool.query(
        "SELECT value FROM app_config WHERE key = 'rotation_start_date'"
      ),
      getActiveRestaurants(),
    ]);

    const weeks = [1, 2, 3].map(weekNumber => ({
      week_number: weekNumber,
      days: DAY_NAMES.map((dayName, index) => {
        const slot = slots.find(row => row.week_number === weekNumber && row.day_of_week === index + 1);
        return {
          day_of_week: index + 1,
          day_name: dayName,
          meal_id: slot ? slot.meal_id : null,
          meal: slot && slot.meal_id ? {
            id: slot.meal_id,
            name: slot.name,
            recipe_id: slot.recipe_id,
            cook: slot.cook,
            kid_rating: slot.kid_rating,
            is_protected: slot.is_protected,
            is_new: slot.is_new,
          } : null,
        };
      }),
    }));

    res.json({
      rotation_start_date: config[0] ? config[0].value : null,
      weeks,
      meals,
      restaurants,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/magic-meal/settings', async (req, res) => {
  try {
    res.json(await getMagicMealSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/magic-meal/settings', async (req, res) => {
  const prompt = String(req.body.magic_meal_prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'magic_meal_prompt is required' });

  try {
    await setAppConfigValue('magic_meal_prompt', prompt);
    res.json({ success: true, magic_meal_prompt: prompt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/magic-meal', async (req, res) => {
  try {
    const requestNotes = req.body && req.body.request_notes
      ? String(req.body.request_notes).trim()
      : '';
    res.json(await generateMagicMeal(requestNotes));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/magic-grocery/settings', async (req, res) => {
  try {
    res.json(await getMagicGrocerySettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/magic-grocery/settings', async (req, res) => {
  const prompt = String(req.body.magic_grocery_prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'magic_grocery_prompt is required' });

  try {
    await setAppConfigValue('magic_grocery_prompt', prompt);
    res.json({ success: true, magic_grocery_prompt: prompt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/magic-grocery', async (req, res) => {
  try {
    const requestNotes = req.body && req.body.request_notes
      ? String(req.body.request_notes).trim()
      : '';
    const targetDate = req.body && req.body.week_start_date
      ? parseDateOnly(String(req.body.week_start_date))
      : new Date();

    res.json(await generateMagicGroceryList(targetDate, requestNotes));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/meals/:id — single meal with full details
app.get('/api/meals/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM meals WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/meals/:id', async (req, res) => {
  const mealId = Number(req.params.id);
  if (!Number.isInteger(mealId) || mealId < 1) {
    return res.status(400).json({ error: 'invalid meal id' });
  }

  const meal = normalizeMealPayload(req.body);
  const validationError = validateMealPayload(meal);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const { rows } = await pool.query(
      `UPDATE meals
       SET recipe_id = $2,
           name = $3,
           notes = $4,
           recipe_tips = $5,
           active_time_min = $6,
           total_time_min = $7,
           equipment = $8,
           cook = $9,
           kid_rating = $10,
           is_new = $11,
           is_protected = $12,
           tags = $13
       WHERE id = $1
       RETURNING *`,
      [
        mealId,
        meal.recipe_id,
        meal.name,
        meal.notes,
        meal.recipe_tips,
        meal.active_time_min,
        meal.total_time_min,
        meal.equipment,
        meal.cook,
        meal.kid_rating,
        meal.is_new,
        meal.is_protected,
        meal.tags,
      ]
    );

    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/meals/:id', async (req, res) => {
  const mealId = Number(req.params.id);
  if (!Number.isInteger(mealId) || mealId < 1) {
    return res.status(400).json({ error: 'invalid meal id' });
  }

  try {
    const usageChecks = await Promise.all([
      pool.query('SELECT 1 FROM meal_rotation WHERE meal_id = $1 LIMIT 1', [mealId]),
      pool.query('SELECT 1 FROM plan_days WHERE meal_id = $1 LIMIT 1', [mealId]),
      pool.query('SELECT 1 FROM daily_overrides WHERE override_meal_id = $1 LIMIT 1', [mealId]),
      pool.query('SELECT 1 FROM cook_log WHERE meal_id = $1 OR planned_meal_id = $1 LIMIT 1', [mealId]),
      pool.query('SELECT 1 FROM meal_votes WHERE meal_id = $1 LIMIT 1', [mealId]),
    ]);

    if (usageChecks.some(result => result.rows.length)) {
      return res.status(409).json({ error: 'Meal is already in use and cannot be deleted.' });
    }

    const { rowCount } = await pool.query('DELETE FROM meals WHERE id = $1', [mealId]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/rotation-slot — update a recurring slot in the 3-week plan
app.put('/api/rotation-slot', async (req, res) => {
  const weekNumber = Number(req.body.week_number);
  const dayOfWeek  = Number(req.body.day_of_week);
  const mealId     = req.body.meal_id === null || req.body.meal_id === '' ? null : Number(req.body.meal_id);

  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 3) {
    return res.status(400).json({ error: 'week_number must be 1, 2, or 3' });
  }
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
    return res.status(400).json({ error: 'day_of_week must be 1 through 7' });
  }
  if (mealId !== null && (!Number.isInteger(mealId) || mealId < 1)) {
    return res.status(400).json({ error: 'meal_id must be a valid meal id or null' });
  }

  try {
    await pool.query(
      `INSERT INTO meal_rotation (week_number, day_of_week, meal_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (week_number, day_of_week)
       DO UPDATE SET meal_id = EXCLUDED.meal_id`,
      [weekNumber, dayOfWeek, mealId]
    );

    const { rows } = await pool.query(
      `SELECT r.week_number, r.day_of_week, r.meal_id,
              m.name, m.recipe_id, m.cook, m.kid_rating, m.is_protected, m.is_new
       FROM meal_rotation r
       LEFT JOIN meals m ON m.id = r.meal_id
       WHERE r.week_number = $1 AND r.day_of_week = $2`,
      [weekNumber, dayOfWeek]
    );

    res.json({
      success: true,
      slot: rows[0] || { week_number: weekNumber, day_of_week: dayOfWeek, meal_id: mealId },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/swap — set the planned meal for a specific date
app.put('/api/swap', async (req, res) => {
  const { date, meal_id, note, created_by } = req.body;
  if (!isValidDateOnlyString(String(date || ''))) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  const mealId = Number(meal_id);
  if (!Number.isInteger(mealId) || mealId < 1) {
    return res.status(400).json({ error: 'meal_id must be a valid meal id' });
  }
  try {
    const { rows } = await pool.query('SELECT 1 FROM meals WHERE id = $1', [mealId]);
    if (!rows.length) return res.status(404).json({ error: 'meal not found' });
    await upsertPlanDay(date, mealId, note || null, created_by || null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/swap/:date — clear the planned meal for a date
app.delete('/api/swap/:date', async (req, res) => {
  if (!isValidDateOnlyString(String(req.params.date || ''))) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  try {
    await pool.query('DELETE FROM plan_days WHERE plan_date = $1', [req.params.date]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/members
app.get('/api/members', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM family_members ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vote — react to a meal
app.post('/api/vote', async (req, res) => {
  const { meal_id, member_id, reaction, meal_date } = req.body;
  if (!meal_id || !member_id || !reaction) {
    return res.status(400).json({ error: 'meal_id, member_id, and reaction required' });
  }

  try {
    const mealDate = resolveMealVoteDate(meal_date);
    const weekStart = mealVoteWeekContext(mealDate);
    await pool.query(
      `INSERT INTO meal_votes (meal_id, member_id, reaction, week_context, meal_date)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (meal_id, member_id, meal_date)
       DO UPDATE SET reaction = $3, week_context = $4, created_at = NOW()`,
      [meal_id, member_id, reaction, weekStart, mealDate]
    );

    const { rows } = await pool.query(
      `SELECT v.reaction, f.name, f.avatar_emoji
       FROM meal_votes v
       JOIN family_members f ON f.id = v.member_id
       WHERE v.meal_id = $1 AND v.meal_date = $2`,
      [meal_id, mealDate]
    );
    res.json({ success: true, votes: rows });
  } catch (err) {
    const statusCode = err.message && err.message.includes('meal_date must be a valid') ? 400 : 500;
    res.status(statusCode).json({ error: err.message });
  }
});

// GET /api/votes/:meal_id — votes for a meal on a given date
app.get('/api/votes/:meal_id', async (req, res) => {
  try {
    const mealDate = resolveMealVoteDate(req.query.date);
    const { rows } = await pool.query(
      `SELECT v.reaction, f.name, f.avatar_emoji
       FROM meal_votes v
       JOIN family_members f ON f.id = v.member_id
       WHERE v.meal_id = $1 AND v.meal_date = $2`,
      [req.params.meal_id, mealDate]
    );
    res.json(rows);
  } catch (err) {
    const statusCode = err.message && err.message.includes('meal_date must be a valid') ? 400 : 500;
    res.status(statusCode).json({ error: err.message });
  }
});

// POST /api/log — record what actually got cooked
app.post('/api/log', async (req, res) => {
  const { meal_id, planned_meal_id, notes, cooked_date } = req.body;
  if (!meal_id) return res.status(400).json({ error: 'meal_id required' });
  const date = cooked_date || localDateString(new Date());
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO cook_log (cooked_date, meal_id, planned_meal_id, was_planned, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cooked_date, meal_id) DO NOTHING`,
      [date, meal_id, planned_meal_id || null, meal_id === planned_meal_id, notes || null]
    );
    res.json({ success: true, already_logged: rowCount === 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cook-log', async (req, res) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 150);
    const rows = await getCookLogEntries(limit);
    res.json({
      entries: rows,
      count: rows.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cook-log/export.csv', async (req, res) => {
  try {
    const rows = await getCookLogEntries(1000);
    const csv = cookLogRowsToCsv(rows);
    const today = localDateString(new Date());
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cook-history-${today}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/energy — Mom's weekly energy flag
app.post('/api/energy', async (req, res) => {
  const { energy_level, note } = req.body;
  if (!energy_level || energy_level < 1 || energy_level > 5) {
    return res.status(400).json({ error: 'energy_level 1–5 required' });
  }
  const weekStart = localDateString(mondayOf(new Date()));
  try {
    await pool.query(
      `INSERT INTO val_energy (week_start, energy_level, note)
       VALUES ($1, $2, $3)
       ON CONFLICT (week_start) DO UPDATE SET energy_level = $2, note = $3`,
      [weekStart, energy_level, note || null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/energy — this week's energy level
app.get('/api/energy', async (req, res) => {
  const weekStart = localDateString(mondayOf(new Date()));
  try {
    const { rows } = await pool.query(
      'SELECT * FROM val_energy WHERE week_start = $1',
      [weekStart]
    );
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/restaurants
app.get('/api/restaurants', async (req, res) => {
  try {
    res.json(await getActiveRestaurants());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/restaurants', async (req, res) => {
  const restaurants = parseRestaurantOptionsInput(req.body.restaurant_options);
  if (!restaurants.length) {
    return res.status(400).json({ error: 'restaurant_options must include at least one option' });
  }

  try {
    await pool.query('BEGIN');
    await pool.query('UPDATE restaurants SET active = false WHERE active = true');

    for (const restaurant of restaurants) {
      const { rows: existingRows } = await pool.query(
        `SELECT id
         FROM restaurants
         WHERE lower(name) = lower($1)
         ORDER BY active DESC, id ASC
         LIMIT 1`,
        [restaurant.name]
      );

      if (existingRows.length) {
        await pool.query(
          `UPDATE restaurants
           SET name = $2,
               emoji = $3,
               active = true
           WHERE id = $1`,
          [existingRows[0].id, restaurant.name, restaurant.emoji]
        );
      } else {
        await pool.query(
          `INSERT INTO restaurants (name, emoji, active)
           VALUES ($1, $2, true)`,
          [restaurant.name, restaurant.emoji]
        );
      }
    }

    await pool.query('COMMIT');
    res.json({ success: true, restaurants: await getActiveRestaurants() });
  } catch (err) {
    try {
      await pool.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Failed to rollback restaurant update', rollbackErr);
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/order-in — declare a night as order-in
app.post('/api/order-in', async (req, res) => {
  const { date, created_by } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    await pool.query(
      `INSERT INTO order_in_nights (order_date, created_by)
       VALUES ($1, $2)
       ON CONFLICT (order_date) DO NOTHING`,
      [date, created_by || null]
    );
    res.json({ success: true, order_in: await orderInForDate(date) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/order-in/:date — cancel order-in night
app.delete('/api/order-in/:date', async (req, res) => {
  try {
    await pool.query('DELETE FROM restaurant_votes WHERE order_date = $1', [req.params.date]);
    await pool.query('DELETE FROM order_in_nights WHERE order_date = $1', [req.params.date]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/order-in/:date/vote — vote for a restaurant
app.post('/api/order-in/:date/vote', async (req, res) => {
  const { restaurant_id, member_id } = req.body;
  if (!restaurant_id || !member_id) {
    return res.status(400).json({ error: 'restaurant_id and member_id required' });
  }
  try {
    const dateStr = req.params.date;
    const [existingOrderIn, meal] = await Promise.all([
      orderInForDate(dateStr),
      mealForDate(parseDateOnly(dateStr)),
    ]);
    const canVoteForOrderIn = !!(existingOrderIn || (meal && meal.is_protected));
    if (!canVoteForOrderIn) {
      return res.status(400).json({ error: 'order-in voting is not enabled for this date' });
    }

    await pool.query(
      `INSERT INTO order_in_nights (order_date)
       VALUES ($1)
       ON CONFLICT (order_date) DO NOTHING`,
      [dateStr]
    );
    await pool.query(
      `INSERT INTO restaurant_votes (order_date, restaurant_id, member_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (order_date, member_id) DO UPDATE SET restaurant_id = $2, created_at = NOW()`,
      [dateStr, restaurant_id, member_id]
    );
    res.json({ success: true, order_in: await orderInForDate(dateStr) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/order-in/:date/write-in', async (req, res) => {
  const { member_id, name, emoji } = req.body || {};
  if (!member_id) return res.status(400).json({ error: 'member_id is required' });

  const writeIn = parseRestaurantWriteIn(name, emoji);
  if (!writeIn) return res.status(400).json({ error: 'name is required' });

  try {
    const dateStr = req.params.date;
    const [existingOrderIn, meal] = await Promise.all([
      orderInForDate(dateStr),
      mealForDate(parseDateOnly(dateStr)),
    ]);
    const canVoteForOrderIn = !!(existingOrderIn || (meal && meal.is_protected));
    if (!canVoteForOrderIn) {
      return res.status(400).json({ error: 'order-in voting is not enabled for this date' });
    }

    await pool.query(
      `INSERT INTO order_in_nights (order_date)
       VALUES ($1)
       ON CONFLICT (order_date) DO NOTHING`,
      [dateStr]
    );

    let restaurantId = null;
    const { rows: existingRows } = await pool.query(
      `SELECT id
       FROM restaurants
       WHERE lower(name) = lower($1)
       ORDER BY active DESC, id ASC
       LIMIT 1`,
      [writeIn.name]
    );

    if (existingRows.length) {
      restaurantId = existingRows[0].id;
      await pool.query(
        `UPDATE restaurants
         SET name = $2,
             emoji = COALESCE($3, emoji),
             active = true
         WHERE id = $1`,
        [restaurantId, writeIn.name, writeIn.emoji]
      );
    } else {
      const { rows: createdRows } = await pool.query(
        `INSERT INTO restaurants (name, emoji, active)
         VALUES ($1, $2, true)
         RETURNING id`,
        [writeIn.name, writeIn.emoji]
      );
      restaurantId = createdRows[0].id;
    }

    await pool.query(
      `INSERT INTO restaurant_votes (order_date, restaurant_id, member_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (order_date, member_id) DO UPDATE SET restaurant_id = $2, created_at = NOW()`,
      [dateStr, restaurantId, member_id]
    );

    res.json({
      success: true,
      restaurant_id: restaurantId,
      order_in: await orderInForDate(dateStr),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tonight-addon/:date', async (req, res) => {
  const dateStr = String(req.params.date || '').trim();
  const note = String(req.body?.note || '').trim();
  const updatedBy = req.body?.updated_by ? String(req.body.updated_by).trim() : null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return res.status(400).json({ error: 'invalid date format' });
  }
  if (note.length > 500) {
    return res.status(400).json({ error: 'note must be 500 characters or fewer' });
  }

  try {
    if (!note) {
      await pool.query('DELETE FROM tonight_addons WHERE addon_date = $1', [dateStr]);
      return res.json({ success: true, addon: null });
    }

    const { rows } = await pool.query(
      `INSERT INTO tonight_addons (addon_date, note, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (addon_date) DO UPDATE
       SET note = EXCLUDED.note,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
       RETURNING addon_date, note, updated_by, updated_at`,
      [dateStr, note, updatedBy]
    );
    res.json({ success: true, addon: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/plan', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'plan.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin/meals', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-meals.html'));
});

app.get('/admin/cook-history', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-cook-history.html'));
});

app.get('/admin/recipes', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-recipes.html'));
});

app.get('/recipes', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'recipes.html'));
});

app.get('/recipes/:id', (req, res) => {
  const recipeId = Number(req.params.id);
  if (!Number.isInteger(recipeId) || recipeId < 1) {
    return res.send(RECIPE_DETAIL_TEMPLATE);
  }

  getRecipeById(recipeId)
    .then(recipe => {
      if (!recipe) {
        res.send(RECIPE_DETAIL_TEMPLATE);
        return;
      }
      res.send(renderRecipeDetailPage(recipe));
    })
    .catch(() => {
      res.send(RECIPE_DETAIL_TEMPLATE);
    });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🍽️  Family Dinner running → http://0.0.0.0:${PORT}`);
    console.log(`   Tonight display → http://0.0.0.0:${PORT}/tonight`);
  });
}

module.exports = {
  app,
  pool,
  buildDefaultOrderIn,
  buildOrderInVotes,
  dedupeRestaurants,
  escapeHtml,
  localDateString,
  mealVoteWeekContext,
  mergeRestaurantVoteRows,
  mondayOf,
  normalizeRestaurantKey,
  parseDateOnly,
  parseRestaurantOptionsInput,
  reasoningParamsFor,
  renderRecipeDetailPage,
  resolveDayOrderIn,
  resolveMealVoteDate,
  safeScriptJson,
  serializeRestaurantOptions,
};
