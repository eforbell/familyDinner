const dns = require('node:dns').promises;
const net = require('node:net');

function inferDomainFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isLocalHostname(hostname) {
  const value = String(hostname || '').toLowerCase();
  return value === 'localhost'
    || value.endsWith('.localhost')
    || value.endsWith('.local')
    || value.endsWith('.localdomain');
}

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || ip === '0.0.0.0';
}

function isPrivateIpv6(ip) {
  const normalized = String(ip || '').toLowerCase();
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb');
}

function isPrivateAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return false;
}

async function assertSafeRecipeSourceUrl(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('A valid recipe URL is required.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only http and https recipe URLs are supported.');
  }

  if (isLocalHostname(parsedUrl.hostname) || isPrivateAddress(parsedUrl.hostname)) {
    throw new Error('Recipe import does not allow localhost or private-network addresses.');
  }

  try {
    const addresses = await dns.lookup(parsedUrl.hostname, { all: true, verbatim: true });
    if (addresses.some(entry => isPrivateAddress(entry.address))) {
      throw new Error('Recipe import does not allow localhost or private-network addresses.');
    }
  } catch (err) {
    if (err && /private-network addresses/i.test(err.message || '')) {
      throw err;
    }
  }

  return parsedUrl;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(html) {
  return decodeHtml(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function normalizeInstruction(step) {
  if (!step) return null;
  if (typeof step === 'string') return { title: null, instruction_text: step.trim() };
  if (typeof step.text === 'string') {
    return {
      title: step.name ? String(step.name).trim() : null,
      instruction_text: step.text.trim(),
    };
  }
  if (typeof step.name === 'string') return { title: null, instruction_text: step.name.trim() };
  return null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function coerceMinutes(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value !== 'string') return null;
  const match = value.match(/P(?:T(?:(\d+)H)?(?:(\d+)M)?)?/i);
  if (match) {
    const hours = Number(match[1] || 0);
    const mins = Number(match[2] || 0);
    return (hours * 60) + mins || null;
  }
  const int = Number.parseInt(value, 10);
  return Number.isFinite(int) ? Math.max(0, int) : null;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function findRecipeObject(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeObject(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;

  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some(entry => String(entry || '').toLowerCase() === 'recipe')) {
    return node;
  }

  if (node['@graph']) return findRecipeObject(node['@graph']);

  for (const value of Object.values(node)) {
    const found = findRecipeObject(value);
    if (found) return found;
  }
  return null;
}

function extractRecipeJsonLd(html) {
  const matches = [...String(html || '').matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of matches) {
    const raw = decodeHtml(match[1]).trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const recipe = findRecipeObject(parsed);
      if (recipe) return recipe;
    } catch {
      continue;
    }
  }
  return null;
}

function extractTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1]).trim() : null;
}

function buildDraftFromRecipeSchema(recipe, url, html) {
  const ingredientLines = asArray(recipe.recipeIngredient)
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .map(item => ({
      display_text: item,
      quantity_text: null,
      unit_text: null,
      ingredient_text: item,
      prep_note: null,
    }));

  const steps = asArray(recipe.recipeInstructions)
    .flatMap(item => {
      if (Array.isArray(item)) return item;
      return [item];
    })
    .map(normalizeInstruction)
    .filter(Boolean);

  const image = Array.isArray(recipe.image)
    ? firstString(recipe.image[0] && recipe.image[0].url, recipe.image[0], recipe.image[1])
    : (typeof recipe.image === 'object' ? firstString(recipe.image.url) : firstString(recipe.image));

  return {
    title: firstString(recipe.name),
    description: firstString(recipe.description),
    source_url: url,
    source_domain: inferDomainFromUrl(url),
    source_title: extractTitle(html) || firstString(recipe.headline, recipe.name),
    servings_text: firstString(recipe.recipeYield),
    prep_time_min: coerceMinutes(recipe.prepTime),
    cook_time_min: coerceMinutes(recipe.cookTime),
    total_time_min: coerceMinutes(recipe.totalTime),
    notes: null,
    tags: asArray(recipe.keywords)
      .flatMap(value => String(value || '').split(','))
      .map(value => value.trim().toLowerCase())
      .filter(Boolean),
    image_url: image,
    ingredients: ingredientLines,
    steps,
  };
}

function buildImportSource(html, url) {
  const recipeSchema = extractRecipeJsonLd(html);
  const baselineDraft = recipeSchema
    ? buildDraftFromRecipeSchema(recipeSchema, url, html)
    : {
        title: extractTitle(html),
        description: null,
        source_url: url,
        source_domain: inferDomainFromUrl(url),
        source_title: extractTitle(html),
        servings_text: null,
        prep_time_min: null,
        cook_time_min: null,
        total_time_min: null,
        notes: null,
        tags: [],
        image_url: null,
        ingredients: [],
        steps: [],
      };

  const excerpt = stripHtml(html).slice(0, 12000);

  return {
    baselineDraft,
    cleanedTextExcerpt: excerpt,
    usedJsonLd: Boolean(recipeSchema),
    sourceTitle: extractTitle(html),
  };
}

module.exports = {
  assertSafeRecipeSourceUrl,
  buildImportSource,
  extractRecipeJsonLd,
  findRecipeObject,
  inferDomainFromUrl,
  isPrivateAddress,
  stripHtml,
};
