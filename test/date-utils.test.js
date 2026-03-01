const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isValidDateOnlyString,
  localDateString,
  mealVoteWeekContext,
  mondayOf,
  parseDateOnly,
  resolveMealVoteDate,
} = require('../lib/date-utils');

test('mondayOf normalizes Sunday to the Monday of the same planning week', () => {
  const sunday = new Date(2026, 2, 1, 18);
  assert.equal(localDateString(mondayOf(sunday)), '2026-02-23');
});

test('resolveMealVoteDate preserves distinct planned dates within the same week', () => {
  assert.equal(resolveMealVoteDate('2026-03-02'), '2026-03-02');
  assert.equal(resolveMealVoteDate('2026-03-05'), '2026-03-05');
  assert.equal(mealVoteWeekContext('2026-03-02'), '2026-03-02');
  assert.equal(mealVoteWeekContext('2026-03-05'), '2026-03-02');
});

test('resolveMealVoteDate falls back to the provided date when input is empty', () => {
  const fallback = new Date(2026, 2, 6, 9);
  assert.equal(resolveMealVoteDate('', fallback), '2026-03-06');
  assert.equal(resolveMealVoteDate(undefined, fallback), '2026-03-06');
});

test('isValidDateOnlyString rejects impossible calendar dates', () => {
  assert.equal(isValidDateOnlyString('2026-02-29'), false);
  assert.equal(isValidDateOnlyString('2026-02-30'), false);
  assert.equal(isValidDateOnlyString('2026-03-01'), true);
});

test('resolveMealVoteDate rejects invalid date strings', () => {
  assert.throws(
    () => resolveMealVoteDate('2026-02-30'),
    /meal_date must be a valid YYYY-MM-DD date/
  );
});

test('parseDateOnly keeps YYYY-MM-DD strings anchored to the same local date', () => {
  assert.equal(localDateString(parseDateOnly('2026-03-01')), '2026-03-01');
});
