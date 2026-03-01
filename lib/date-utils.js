function parseDateOnly(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day, 12);
  }

  return new Date(value);
}

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Returns the Monday (00:00 local) of the week containing `date`. */
function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

function isValidDateOnlyString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return localDateString(parseDateOnly(value)) === value;
}

function resolveMealVoteDate(value, fallbackDate = new Date()) {
  if (value == null || value === '') {
    return localDateString(parseDateOnly(fallbackDate));
  }
  if (!isValidDateOnlyString(value)) {
    throw new Error('meal_date must be a valid YYYY-MM-DD date');
  }
  return value;
}

function mealVoteWeekContext(mealDate) {
  return localDateString(mondayOf(parseDateOnly(mealDate)));
}

module.exports = {
  isValidDateOnlyString,
  localDateString,
  mealVoteWeekContext,
  mondayOf,
  parseDateOnly,
  resolveMealVoteDate,
};
