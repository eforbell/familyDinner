'use strict';

// Suite identity, slice 5: in tailnet mode the directory's role decides what each member may do, and what they do is
// done as their own linked member. Local mode keeps the picker and lets everyone do everything, as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, pool, setSuiteIdentityForTests, localDateString } = require('../server');

const ORIGIN = 'https://smith-home.example-tailnet.ts.net';
const TAILNET = {
  SOVEREIGN_AUTH_MODE: 'tailnet',
  SOVEREIGN_LISTEN: 'unix:/run/sovereign-apps/family-dinner/app.sock',
  SOVEREIGN_HOMEBASE_UID: '998',
  APP_PUBLIC_URL: `${ORIGIN}/dinner/`,
};
function snapshotOf(members) {
  const list = members.map((member) => ({ status: 'active', epoch: 1, apps: ['family-dinner'], role: 'parent', ...member }));
  return { current: () => ({ ok: true, snapshot: { members: list, byUserId: new Map(list.map((member) => [member.userId, member])) } }) };
}
const as = (userId, login) => ({ 'x-sovereign-user-id': userId, 'x-sovereign-login': login });
const PARENT_HEADERS = as('u-parent', 'parent@example.com');
const KID_HEADERS = as('u-kid', 'kid@example.com');
const MEMBERS = [
  { userId: 'u-parent', memberId: 'm_parent', login: 'parent@example.com', name: 'Parent' },
  { userId: 'u-kid', memberId: 'm_kid', login: 'kid@example.com', name: 'Kid', role: 'kid' },
];
const TODAY = localDateString(new Date());

// Postgres as the gate, /api/me, Tonight, votes and the scratchpad ask it; every write's parameters are recorded.
class Db {
  constructor() {
    this.rows = [
      { id: 1, name: 'Parent', role: 'parent', avatar_emoji: '🧑‍🍳', suite_member_id: 'm_parent' },
      { id: 2, name: '</script><b>Kid</b>', role: 'kid', avatar_emoji: '🧒', suite_member_id: 'm_kid' },
    ];
    this.writes = [];
  }
  async query(sql, params = []) {
    if (sql.includes('FROM family_members WHERE suite_member_id = $1')) return { rows: this.rows.filter((row) => row.suite_member_id === params[0]) };
    if (sql.includes('FROM family_members ORDER BY id')) return { rows: this.rows };
    if (/COUNT\(\*\)::int AS count FROM/.test(sql)) return { rows: [{ count: 2 }] };
    // Autofill from the previous week: Monday had meal 5; nothing planned yet this week.
    if (sql.includes('p.meal_id IS NOT NULL')) return { rows: [{ plan_date: TODAY, meal_id: 5, day_of_week: 1 }] };
    if (sql.includes('AS date_to_skip')) return { rows: [] };
    if (sql.includes('FROM plan_days p') && sql.includes('BETWEEN')) {
      return { rows: [{ plan_date: TODAY, plan_note: null, id: 5, name: 'Tacos', is_protected: false, notes: '', equipment: [] }] };
    }
    if (sql.includes('FROM plan_days p') && sql.includes('p.plan_date = $1')) return { rows: [{ id: 5, name: 'Tacos', is_protected: true }] };
    if (sql.includes('SELECT * FROM order_in_nights WHERE order_date = $1')) return { rows: [{ id: 9, order_date: params[0] }] };
    if (sql.includes('SELECT 1 FROM meals WHERE id = $1')) return { rows: [{ '?column?': 1 }] };
    if (sql.includes('FROM restaurants') && sql.includes('WHERE lower(name) = lower($1)')) {
      return { rows: (this.restaurants || []).filter((r) => r.name.toLowerCase() === String(params[0]).toLowerCase()) };
    }
    if (sql.includes('SELECT created_by_member_id FROM recipes WHERE id = $1')) return { rows: params[0] === 7 ? [{ created_by_member_id: 1 }] : [] };
    if (/^\s*(INSERT|UPDATE|DELETE)/.test(sql)) {
      this.writes.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      sql = sql.trim();
      if (sql.includes('INSERT INTO tonight_addons')) return { rows: [{ addon_date: params[0], note: params[1], updated_by: params[2] }] };
      if (sql.includes('INSERT INTO restaurants')) return { rows: [{ id: 77 }] };
      if (sql.includes('INSERT INTO recipes')) return { rows: [{ id: 11 }], rowCount: 1 };
      if (sql.startsWith('UPDATE recipes')) return { rows: [], rowCount: 1 };
      return { rows: [] };
    }
    return { rows: [] };
  }
  written(table) { return this.writes.filter((write) => write.sql.includes(`INTO ${table}`)); }
}

const ORIGINAL_QUERY = pool.query;
const ORIGINAL_CONNECT = pool.connect;
async function withServer(env, db, fn) {
  setSuiteIdentityForTests(env, env.SOVEREIGN_AUTH_MODE ? { reader: snapshotOf(MEMBERS) } : {});
  pool.query = db.query.bind(db);
  // Transactions (saving a recipe) use a client: the same stand-in.
  pool.connect = async () => ({ query: async (sql, params) => (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) ? { rows: [] } : db.query(sql, params)), release() {} });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = (method, route, headers, body) => fetch(`${base}${route}`, {
      method,
      redirect: 'manual',
      headers: { ...headers, ...(method === 'GET' || method === 'HEAD' ? {} : { origin: ORIGIN, 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    await fn(call);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    pool.query = ORIGINAL_QUERY;
    pool.connect = ORIGINAL_CONNECT;
    setSuiteIdentityForTests({});
  }
}

test('a kid lands on Tonight and may use only the week, Tonight, a recipe and their own votes', async () => {
  await withServer(TAILNET, new Db(), async (call) => {
    const kid = (method, route, body) => call(method, route, KID_HEADERS, body);
    // Where a kid lands, and every other page, is Tonight.
    for (const route of ['/', '/index.html', '/plan', '/admin', '/admin/meals', '/recipes', '/link', '/setup', '/Tonight', '/week/', '/recipes/01']) {
      const res = await kid('GET', route);
      assert.equal(res.status, 303, route);
      assert.equal(res.headers.get('location'), '/dinner/tonight', route);
    }
    // Allowed: through the gate to the handler (which may still answer 404 or 500 from the stand-in database).
    const allowed = [
      ['GET', '/tonight'], ['GET', '/week'], ['HEAD', '/week'], ['GET', '/recipes/3'],
      ['GET', '/api/week'], ['GET', '/api/members'], ['GET', '/api/me'], ['GET', '/api/tonight'],
      ['GET', '/api/votes/5'], ['GET', '/api/recipes/3'],
      ['POST', '/api/vote', { meal_id: 5, reaction: '👍' }],
      ['POST', `/api/order-in/${TODAY}/vote`, { restaurant_id: 3 }],
      ['POST', `/api/order-in/${TODAY}/write-in`, { name: 'Noodle place' }],
    ];
    for (const [method, route, body] of allowed) {
      const res = await kid(method, route, body);
      assert.notEqual(res.status, 303, `${method} ${route}`);
      assert.notEqual(res.status, 403, `${method} ${route}`);
    }
    // Everything else in the API is a parent's, in any spelling.
    const refused = [
      ['GET', '/api/plan'], ['GET', '/api/cook-log'], ['GET', '/api/recipes'], ['GET', '/api/meals'], ['GET', '/api/energy'],
      ['GET', '/api/votes/05'], ['GET', '/API/week'], ['GET', '/api/week/'],
      ['PUT', '/api/plan/day', {}], ['POST', '/api/plan/autofill', {}], ['PUT', '/api/swap', {}], ['DELETE', `/api/swap/${TODAY}`],
      ['POST', '/api/log', {}], ['POST', '/api/energy', {}], ['PUT', `/api/tonight-addon/${TODAY}`, { note: 'x' }],
      ['POST', '/api/order-in', {}], ['DELETE', `/api/order-in/${TODAY}`], ['PUT', '/api/restaurants', {}],
      ['POST', '/api/recipes', {}], ['POST', '/api/meals', {}], ['PUT', '/api/vote', {}], ['POST', '/API/vote', {}],
      ['POST', '/api/vote/', {}], ['POST', `/api/order-in/${TODAY}/vote/`, {}], ['POST', '/api/order-in/today/vote', {}],
      ['POST', '/api/bootstrap/household', {}], ['PUT', '/api/suite/links/2', { suite_member_id: null }],
      // A kid's reads are reads only: any other method on them is refused.
      ['PUT', '/api/members', {}], ['DELETE', '/api/votes/5'], ['PATCH', '/api/week', {}], ['POST', '/api/me', {}],
    ];
    for (const [method, route, body] of refused) {
      const res = await kid(method, route, body);
      assert.equal(res.status, 403, `${method} ${route}`);
      assert.equal((await res.json()).code, 'parent_only', `${method} ${route}`);
    }
  });
});

test('a parent lands on the week and may use everything', async () => {
  await withServer(TAILNET, new Db(), async (call) => {
    for (const route of ['/', '/week', '/tonight', '/plan', '/admin']) {
      assert.equal((await call('GET', route, PARENT_HEADERS)).status, 200, route);
    }
    assert.equal((await call('GET', '/api/cook-log', PARENT_HEADERS)).status, 200);
  });
  // The directory's role decides, not the row's: a parent linked to a row Dinner calls a kid is still a parent.
  const db = new Db();
  db.rows[0].role = 'kid';
  await withServer(TAILNET, db, async (call) => {
    assert.equal((await call('GET', '/plan', PARENT_HEADERS)).status, 200);
    assert.equal((await (await call('GET', '/api/me', PARENT_HEADERS)).json()).member.role, 'parent');
  });
});

test('/api/me says who the pages show: the linked member with the directory\'s role, or nobody in local mode', async () => {
  await withServer(TAILNET, new Db(), async (call) => {
    const parent = await call('GET', '/api/me', PARENT_HEADERS);
    assert.equal(parent.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await parent.json(), { mode: 'tailnet', member: { id: 1, name: 'Parent', avatar_emoji: '🧑‍🍳', role: 'parent' } });
    const kid = await (await call('GET', '/api/me', KID_HEADERS)).json();
    assert.equal(kid.member.id, 2);
    assert.equal(kid.member.role, 'kid');
  });
  await withServer({}, new Db(), async (call) => {
    assert.deepEqual(await (await call('GET', '/api/me', {})).json(), { mode: 'local', member: null });
  });
});

test('in tailnet mode a vote or note is the requester\'s own, whatever the request names', async () => {
  const db = new Db();
  await withServer(TAILNET, db, async (call) => {
    // The kid names the parent's row (1); the vote is recorded as the kid's (2).
    assert.equal((await call('POST', '/api/vote', KID_HEADERS, { meal_id: 5, member_id: 1, reaction: '👎', meal_date: TODAY })).status, 200);
    assert.deepEqual(db.written('meal_votes').map((write) => write.params[1]), [2]);
    // Without naming anyone, it's still theirs.
    assert.equal((await call('POST', '/api/vote', KID_HEADERS, { meal_id: 5, reaction: '👍', meal_date: TODAY })).status, 200);
    assert.deepEqual(db.written('meal_votes').map((write) => write.params[1]), [2, 2]);

    assert.equal((await call('POST', `/api/order-in/${TODAY}/vote`, KID_HEADERS, { restaurant_id: 3, member_id: 1 })).status, 200);
    assert.equal((await call('POST', `/api/order-in/${TODAY}/write-in`, KID_HEADERS, { name: 'Noodle place', member_id: 1 })).status, 200);
    assert.deepEqual(db.written('restaurant_votes').map((write) => write.params[2]), [2, 2]);

    // A parent's scratchpad note is signed with their linked name, not the one the page sent.
    assert.equal((await call('PUT', `/api/tonight-addon/${TODAY}`, PARENT_HEADERS, { note: 'Garlic bread', updated_by: 'Someone else' })).status, 200);
    assert.equal(db.written('tonight_addons')[0].params[2], 'Parent');
  });

  // Local mode: the picker's choice, from the request, as before.
  const local = new Db();
  await withServer({}, local, async (call) => {
    assert.equal((await call('POST', '/api/vote', {}, { meal_id: 5, member_id: 1, reaction: '👍', meal_date: TODAY })).status, 200);
    assert.deepEqual(local.written('meal_votes').map((write) => write.params[1]), [1]);
    assert.equal((await call('POST', '/api/vote', {}, { meal_id: 5, reaction: '👍' })).status, 400);
    assert.equal((await call('PUT', `/api/tonight-addon/${TODAY}`, {}, { note: 'x', updated_by: 'Picked' })).status, 200);
    assert.equal(local.written('tonight_addons')[0].params[2], 'Picked');
  });
});

test('Tonight knows who is looking in tailnet mode, safely, and links to the week', async () => {
  await withServer(TAILNET, new Db(), async (call) => {
    const html = await (await call('GET', '/tonight', KID_HEADERS)).text();
    assert.match(html, /href="\.\/week" class="week-link"/);
    const [, json] = html.match(/const SUITE_ME = (.*);/);
    assert.deepEqual(JSON.parse(json), { id: 2, name: '</script><b>Kid</b>', avatar_emoji: '🧒', role: 'kid' });
    // The name can't close the script or add markup.
    assert.doesNotMatch(json, /<\/script>|<b>/);
  });
  await withServer({}, new Db(), async (call) => {
    const html = await (await call('GET', '/tonight', {})).text();
    assert.match(html, /const SUITE_ME = null;/);
  });
});

test('a reaction is one of the four the pages offer: it is shown to everyone who opens the week', async () => {
  for (const env of [TAILNET, {}]) {
    const db = new Db();
    await withServer(env, db, async (call) => {
      const headers = env.SOVEREIGN_AUTH_MODE ? KID_HEADERS : {};
      for (const reaction of ['<img src=x onerror=alert(1)>', '👍👍', 'x', '❤']) {
        const res = await call('POST', '/api/vote', headers, { meal_id: 5, member_id: 2, reaction, meal_date: TODAY });
        assert.equal(res.status, 400, reaction);
      }
      assert.equal(db.written('meal_votes').length, 0);
      for (const reaction of ['❤️', '👍', '👎', '🤷']) {
        assert.equal((await call('POST', '/api/vote', headers, { meal_id: 5, member_id: 2, reaction, meal_date: TODAY })).status, 200, reaction);
      }
    });
  }
});

test('a kid\'s write-in is a vote: it may add a place, but not bring back or rename one a parent took off the list', async () => {
  const db = new Db();
  db.restaurants = [{ id: 3, name: 'Taco Spot', active: true }, { id: 4, name: 'Old Diner', active: false }];
  await withServer(TAILNET, db, async (call) => {
    const writeIn = (headers, body) => call('POST', `/api/order-in/${TODAY}/write-in`, headers, body);
    const retired = await writeIn(KID_HEADERS, { name: 'old diner', emoji: '🍔' });
    assert.equal(retired.status, 409);
    assert.equal((await retired.json()).code, 'restaurant_retired');
    // A listed place, as it is: the vote, and no change to the place.
    assert.equal((await writeIn(KID_HEADERS, { name: 'TACO SPOT', emoji: '💥' })).status, 200);
    assert.equal(db.writes.filter((write) => write.sql.startsWith('UPDATE restaurants')).length, 0);
    assert.deepEqual(db.written('restaurant_votes').map((write) => write.params.slice(1)), [[3, 2]]);
    // A new place: added, and voted for.
    assert.equal((await writeIn(KID_HEADERS, { name: 'Noodle place' })).status, 200);
    assert.equal(db.written('restaurants').length, 1);
    // A parent's write-in may still bring one back, as before.
    assert.equal((await writeIn(PARENT_HEADERS, { name: 'Old Diner' })).status, 200);
    assert.equal(db.writes.filter((write) => write.sql.startsWith('UPDATE restaurants')).length, 1);
  });
});

test('in tailnet mode what a parent plans or creates is signed with their own linked member', async () => {
  const db = new Db();
  await withServer(TAILNET, db, async (call) => {
    const forged = 'Someone else';
    assert.equal((await call('PUT', '/api/plan/day', PARENT_HEADERS, { date: TODAY, meal_id: 5, created_by: forged })).status, 200);
    assert.equal((await call('PUT', '/api/swap', PARENT_HEADERS, { date: TODAY, meal_id: 5, created_by: forged })).status, 200);
    assert.equal((await call('POST', '/api/order-in', PARENT_HEADERS, { date: TODAY, created_by: forged })).status, 200);
    const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const autofill = await call('POST', '/api/plan/autofill', PARENT_HEADERS, { week_start: localDateString(monday), source: 'previous_week', created_by: forged });
    assert.equal(autofill.status, 200);
    const signed = db.writes.filter((write) => /INTO (plan_days|order_in_nights)/.test(write.sql)).map((write) => write.params.at(-1));
    assert.deepEqual(signed, ['Parent', 'Parent', 'Parent', 'Parent']);

    const recipe = { title: 'Soup', ingredients: ['water'], steps: ['Boil'], created_by_member_id: 2 };
    // Both reach the save (the stand-in database then can't read the recipe back, so the answer itself isn't checked).
    assert.notEqual((await call('POST', '/api/recipes', PARENT_HEADERS, recipe)).status, 400);
    assert.notEqual((await call('PUT', '/api/recipes/7', PARENT_HEADERS, recipe)).status, 404);
    // created_by_member_id is $13 of the INSERT and $14 of the UPDATE.
    const creators = db.writes.filter((write) => /^(INSERT INTO|UPDATE) recipes/.test(write.sql))
      .map((write) => (write.sql.startsWith('INSERT') ? write.params[12] : write.params[13]));
    assert.deepEqual(creators, [1, 1], 'new: the requester; edited: who created it, not who the request names');
    assert.equal((await call('PUT', '/api/recipes/8', PARENT_HEADERS, recipe)).status, 404);
  });
});
