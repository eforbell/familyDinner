const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cookLogRowsToCsv,
  escapeCsvValue,
  parsePositiveInt,
} = require('../lib/cook-log');

test('escapeCsvValue quotes commas, newlines, and double quotes', () => {
  assert.equal(escapeCsvValue('simple'), 'simple');
  assert.equal(escapeCsvValue('mac, cheese'), '"mac, cheese"');
  assert.equal(escapeCsvValue('line 1\nline 2'), '"line 1\nline 2"');
  assert.equal(escapeCsvValue('He said "hi"'), '"He said ""hi"""');
});

test('cookLogRowsToCsv builds a header row and escaped values', () => {
  const csv = cookLogRowsToCsv([
    {
      cooked_date: '2026-03-02',
      meal_name: 'Tacos',
      planned_meal_name: 'Tacos',
      was_planned: true,
      notes: 'kid favorite',
      created_at: '2026-03-02T18:00:00.000Z',
    },
    {
      cooked_date: '2026-03-01',
      meal_name: 'Soup, grilled cheese',
      planned_meal_name: 'Pasta',
      was_planned: false,
      notes: 'Pivoted after a long day',
      created_at: '2026-03-01T18:00:00.000Z',
    },
  ]);

  const lines = csv.split('\n');
  assert.equal(lines[0], 'cooked_date,meal_name,planned_meal_name,was_planned,notes,created_at');
  assert.equal(lines[1], '2026-03-02,Tacos,Tacos,true,kid favorite,2026-03-02T18:00:00.000Z');
  assert.equal(lines[2], '2026-03-01,"Soup, grilled cheese",Pasta,false,Pivoted after a long day,2026-03-01T18:00:00.000Z');
});

test('parsePositiveInt uses the fallback for invalid limits', () => {
  assert.equal(parsePositiveInt('250', 150), 250);
  assert.equal(parsePositiveInt('0', 150), 150);
  assert.equal(parsePositiveInt('-4', 150), 150);
  assert.equal(parsePositiveInt('not-a-number', 150), 150);
});
