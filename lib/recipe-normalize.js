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

function parseNullableInt(value) {
  if (value === '' || value == null) return null;
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 ? num : null;
}

function buildIngredientDisplayText(ingredient) {
  const bits = [ingredient.quantity_text, ingredient.unit_text, ingredient.ingredient_text]
    .filter(Boolean)
    .map(value => String(value).trim())
    .filter(Boolean);
  const base = bits.join(' ').trim();
  if (ingredient.prep_note) {
    return base ? `${base}, ${String(ingredient.prep_note).trim()}` : String(ingredient.prep_note).trim();
  }
  return base;
}

function normalizeRecipeIngredient(input, index) {
  if (typeof input === 'string') {
    const displayText = input.trim();
    return {
      position: index + 1,
      display_text: displayText,
      quantity_text: null,
      unit_text: null,
      ingredient_text: displayText || null,
      prep_note: null,
    };
  }

  const ingredient = input && typeof input === 'object' ? input : {};
  const normalized = {
    position: index + 1,
    display_text: ingredient.display_text ? String(ingredient.display_text).trim() : '',
    quantity_text: ingredient.quantity_text ? String(ingredient.quantity_text).trim() : null,
    unit_text: ingredient.unit_text ? String(ingredient.unit_text).trim() : null,
    ingredient_text: ingredient.ingredient_text ? String(ingredient.ingredient_text).trim() : null,
    prep_note: ingredient.prep_note ? String(ingredient.prep_note).trim() : null,
  };

  if (!normalized.display_text) {
    normalized.display_text = buildIngredientDisplayText(normalized);
  }

  if (!normalized.ingredient_text && normalized.display_text) {
    normalized.ingredient_text = normalized.display_text;
  }

  return normalized;
}

function normalizeRecipeStep(input, index) {
  if (typeof input === 'string') {
    return {
      position: index + 1,
      title: null,
      instruction_text: input.trim(),
    };
  }

  const step = input && typeof input === 'object' ? input : {};
  return {
    position: index + 1,
    title: step.title ? String(step.title).trim() : null,
    instruction_text: step.instruction_text ? String(step.instruction_text).trim() : '',
  };
}

function normalizeRecipePayload(body = {}) {
  const recipe = {
    title: String(body.title || '').trim(),
    description: body.description ? String(body.description).trim() : null,
    source_url: body.source_url ? String(body.source_url).trim() : null,
    source_domain: body.source_domain ? String(body.source_domain).trim() : null,
    source_title: body.source_title ? String(body.source_title).trim() : null,
    servings_text: body.servings_text ? String(body.servings_text).trim() : null,
    prep_time_min: parseNullableInt(body.prep_time_min),
    cook_time_min: parseNullableInt(body.cook_time_min),
    total_time_min: parseNullableInt(body.total_time_min),
    notes: body.notes ? String(body.notes).trim() : null,
    tags: parseTextList(body.tags),
    image_url: body.image_url ? String(body.image_url).trim() : null,
    created_by_member_id: body.created_by_member_id === '' || body.created_by_member_id == null
      ? null
      : Number(body.created_by_member_id),
    import_id: body.import_id === '' || body.import_id == null ? null : Number(body.import_id),
    ingredients: Array.isArray(body.ingredients)
      ? body.ingredients.map(normalizeRecipeIngredient).filter(item => item.display_text)
      : [],
    steps: Array.isArray(body.steps)
      ? body.steps.map(normalizeRecipeStep).filter(item => item.instruction_text)
      : [],
  };

  if (recipe.source_url && !recipe.source_domain) {
    try {
      recipe.source_domain = new URL(recipe.source_url).hostname.replace(/^www\./, '');
    } catch {
      // Keep the original value if the URL is not valid.
    }
  }

  return recipe;
}

function validateRecipePayload(recipe) {
  if (!recipe.title) return 'title is required';
  if (!recipe.ingredients.length) return 'at least one ingredient is required';
  if (!recipe.steps.length) return 'at least one step is required';
  if (recipe.prep_time_min !== null && recipe.prep_time_min < 0) return 'prep_time_min must be a non-negative integer';
  if (recipe.cook_time_min !== null && recipe.cook_time_min < 0) return 'cook_time_min must be a non-negative integer';
  if (recipe.total_time_min !== null && recipe.total_time_min < 0) return 'total_time_min must be a non-negative integer';
  if (recipe.created_by_member_id !== null && (!Number.isInteger(recipe.created_by_member_id) || recipe.created_by_member_id < 1)) {
    return 'created_by_member_id must be a valid member id';
  }
  if (recipe.import_id !== null && (!Number.isInteger(recipe.import_id) || recipe.import_id < 1)) {
    return 'import_id must be a valid import id';
  }
  return null;
}

function recipeToMealDraft(recipe) {
  return {
    name: recipe.title,
    notes: recipe.description || null,
    recipe_tips: recipe.notes || recipe.steps.map(step => step.instruction_text).slice(0, 3).join(' '),
    active_time_min: recipe.prep_time_min,
    total_time_min: recipe.total_time_min,
    equipment: [],
    cook: '👩‍🍳 or 👨‍🍳',
    kid_rating: '',
    is_new: false,
    is_protected: false,
    tags: recipe.tags,
  };
}

module.exports = {
  normalizeRecipePayload,
  normalizeRecipeIngredient,
  normalizeRecipeStep,
  parseNullableInt,
  parseTextList,
  recipeToMealDraft,
  validateRecipePayload,
};
