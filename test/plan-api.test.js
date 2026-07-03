const test = require('node:test');
const assert = require('node:assert/strict');
const { app, pool, localDateString, mondayOf } = require('../server');

const ORIGINAL_QUERY = pool.query.bind(pool);

function isoDates(monday) {
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    dates.push(localDateString(day));
  }
  return dates;
}

async function withServer(t, handler) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  t.after(async () => {
    pool.query = ORIGINAL_QUERY;
    await new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${port}`;
}

test('PUT /api/plan/day rejects invalid dates and meal ids without touching the db', async (t) => {
  const baseUrl = await withServer(t);
  pool.query = async () => { throw new Error('db should not be called'); };

  const badDate = await fetch(`${baseUrl}/api/plan/day`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: '2026-02-30', meal_id: 1 }),
  });
  assert.equal(badDate.status, 400);

  const badMeal = await fetch(`${baseUrl}/api/plan/day`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: '2026-07-06', meal_id: -4 }),
  });
  assert.equal(badMeal.status, 400);
});

test('PUT /api/plan/day upserts a plan day and clears it when meal_id is null', async (t) => {
  const baseUrl = await withServer(t);
  const calls = [];
  pool.query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT 1 FROM meals')) return { rows: [{ '?column?': 1 }] };
    if (sql.includes('INSERT INTO plan_days')) return { rows: [] };
    if (sql.includes('DELETE FROM plan_days')) return { rows: [] };
    if (sql.includes('FROM plan_days p')) {
      return { rows: [{ id: 7, name: 'Chicken Kiev', plan_note: null }] };
    }
    return { rows: [] };
  };

  const setRes = await fetch(`${baseUrl}/api/plan/day`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: '2026-07-06', meal_id: 7, created_by: 'Eric' }),
  });
  const setData = await setRes.json();
  assert.equal(setRes.status, 200);
  assert.equal(setData.success, true);
  assert.equal(setData.meal.name, 'Chicken Kiev');

  const upsert = calls.find(call => call.sql.includes('INSERT INTO plan_days'));
  assert.ok(upsert, 'expected plan_days upsert');
  assert.deepEqual(upsert.params.slice(0, 2), ['2026-07-06', 7]);
  assert.equal(upsert.params[3], 'Eric');

  const clearRes = await fetch(`${baseUrl}/api/plan/day`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: '2026-07-06', meal_id: null }),
  });
  assert.equal(clearRes.status, 200);
  const del = calls.find(call => call.sql.includes('DELETE FROM plan_days'));
  assert.ok(del, 'expected plan_days delete');
  assert.deepEqual(del.params, ['2026-07-06']);
});

test('POST /api/plan/autofill fills only the empty days from the rotation template', async (t) => {
  const baseUrl = await withServer(t);
  const monday = mondayOf(new Date());
  const dates = isoDates(monday);
  const inserted = [];

  pool.query = async (sql, params = []) => {
    if (sql.includes("key = 'rotation_start_date'")) {
      return { rows: [{ value: dates[0] }] };
    }
    if (sql.includes('FROM meal_rotation r')) {
      // Template has meals for Monday through Wednesday only.
      return { rows: [
        { day_of_week: 1, id: 11, name: 'Tacos' },
        { day_of_week: 2, id: 12, name: 'Adobo' },
        { day_of_week: 3, id: 13, name: 'Wings' },
      ] };
    }
    if (sql.includes('date_to_skip')) {
      // Monday is already planned by hand.
      return { rows: [{ date_to_skip: dates[0] }] };
    }
    if (sql.includes('INSERT INTO plan_days')) {
      inserted.push(params);
      return { rows: [] };
    }
    if (sql.includes('FROM plan_days p')) return { rows: [] };
    return { rows: [] };
  };

  const res = await fetch(`${baseUrl}/api/plan/autofill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ week_start: dates[0], source: 'rotation' }),
  });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.filled, 2, 'Tuesday and Wednesday get filled; Monday is kept');
  assert.deepEqual(inserted.map(params => params.slice(0, 2)), [
    [dates[1], 12],
    [dates[2], 13],
  ]);
});

test('POST /api/plan/autofill does not overwrite explicit order-in nights', async (t) => {
  const baseUrl = await withServer(t);
  const monday = mondayOf(new Date());
  const dates = isoDates(monday);
  const inserted = [];

  pool.query = async (sql, params = []) => {
    if (sql.includes("key = 'rotation_start_date'")) {
      return { rows: [{ value: dates[0] }] };
    }
    if (sql.includes('FROM meal_rotation r')) {
      return { rows: [
        { day_of_week: 1, id: 11, name: 'Tacos' },
        { day_of_week: 2, id: 12, name: 'Adobo' },
      ] };
    }
    if (sql.includes('date_to_skip')) {
      assert.match(sql, /order_in_nights/, 'autofill should consider order-in nights planned');
      return { rows: [{ date_to_skip: dates[1] }] };
    }
    if (sql.includes('INSERT INTO plan_days')) {
      inserted.push(params);
      return { rows: [] };
    }
    if (sql.includes('FROM plan_days p')) return { rows: [] };
    return { rows: [] };
  };

  const res = await fetch(`${baseUrl}/api/plan/autofill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ week_start: dates[0], source: 'rotation' }),
  });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.filled, 1, 'Monday fills; Tuesday order-in is left alone');
  assert.deepEqual(inserted.map(params => params.slice(0, 2)), [[dates[0], 11]]);
});

test('GET /api/plan returns rotation suggestions alongside planned days', async (t) => {
  const baseUrl = await withServer(t);
  const monday = mondayOf(new Date());
  const dates = isoDates(monday);

  pool.query = async (sql) => {
    if (sql.includes("key = 'rotation_start_date'")) {
      return { rows: [{ value: dates[0] }] };
    }
    if (sql.includes('FROM meal_rotation r')) {
      return { rows: [{ day_of_week: 4, id: 21, name: 'Ravioli' }] };
    }
    if (sql.includes('FROM plan_days p')) {
      return { rows: [{ plan_date: dates[0], id: 11, name: 'Tacos', is_protected: false }] };
    }
    return { rows: [] };
  };

  const res = await fetch(`${baseUrl}/api/plan?week_start=${dates[0]}`);
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.week_start, dates[0]);
  assert.equal(data.days.length, 7);
  assert.equal(data.days[0].meal.name, 'Tacos');
  assert.equal(data.days[3].rotation_suggestion.name, 'Ravioli');
  assert.equal(data.days[3].meal, null);
});

test('legacy /api/swap uses canonical plan validation', async (t) => {
  const baseUrl = await withServer(t);
  const calls = [];
  pool.query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT 1 FROM meals')) return { rows: [] };
    if (sql.includes('INSERT INTO plan_days')) throw new Error('should not write missing meal');
    return { rows: [] };
  };

  const badDate = await fetch(`${baseUrl}/api/swap`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: '2026-02-30', meal_id: 1 }),
  });
  assert.equal(badDate.status, 400);

  const badMeal = await fetch(`${baseUrl}/api/swap`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: '2026-07-06', meal_id: 'abc' }),
  });
  assert.equal(badMeal.status, 400);

  const missingMeal = await fetch(`${baseUrl}/api/swap`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: '2026-07-06', meal_id: 99 }),
  });
  assert.equal(missingMeal.status, 404);
  assert.ok(calls.some(call => call.sql.includes('SELECT 1 FROM meals')));
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO plan_days')), false);
});
