function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeCsvValue(value) {
  if (value == null) return '';
  const stringValue = String(value);
  if (/["\n,]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function cookLogRowsToCsv(rows) {
  const headers = [
    'cooked_date',
    'meal_name',
    'planned_meal_name',
    'was_planned',
    'notes',
    'created_at',
  ];

  return [
    headers.join(','),
    ...rows.map(row => [
      row.cooked_date,
      row.meal_name,
      row.planned_meal_name,
      row.was_planned,
      row.notes,
      row.created_at,
    ].map(escapeCsvValue).join(',')),
  ].join('\n');
}

module.exports = {
  cookLogRowsToCsv,
  escapeCsvValue,
  parsePositiveInt,
};
