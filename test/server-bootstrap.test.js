const test = require('node:test');
const assert = require('node:assert/strict');
const { app, pool } = require('../server');

const ORIGINAL_QUERY = pool.query.bind(pool);
const ORIGINAL_CONNECT = pool.connect.bind(pool);

class FakePool {
  constructor(initial = {}) {
    this.members = Array.isArray(initial.members) ? initial.members.map(member => ({ ...member })) : [];
    this.restaurants = Array.isArray(initial.restaurants) ? initial.restaurants.map(restaurant => ({ ...restaurant })) : [];
    this.meals = Array.isArray(initial.meals) ? initial.meals.map(meal => ({ ...meal })) : [];
    this.rotation = Array.isArray(initial.rotation) ? initial.rotation.map(slot => ({ ...slot })) : [];
    this.config = new Map(Object.entries(initial.config || {}));
    this._nextMemberId = this.members.reduce((max, member) => Math.max(max, member.id || 0), 0) + 1;
    this._nextRestaurantId = this.restaurants.reduce((max, restaurant) => Math.max(max, restaurant.id || 0), 0) + 1;
  }

  async query(sql, params = []) {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }

    if (sql.trim() === 'SELECT 1') {
      return { rows: [{ '?column?': 1 }], rowCount: 1 };
    }

    if (sql.includes('SELECT COUNT(*)::int AS count FROM family_members')) {
      return { rows: [{ count: this.members.length }], rowCount: 1 };
    }
    if (sql.includes('SELECT COUNT(*)::int AS count FROM meals')) {
      return { rows: [{ count: this.meals.length }], rowCount: 1 };
    }
    if (sql.includes('SELECT COUNT(*)::int AS count FROM meal_rotation')) {
      return { rows: [{ count: this.rotation.length }], rowCount: 1 };
    }
    if (sql.includes('SELECT COUNT(*)::int AS count FROM restaurants')) {
      return { rows: [{ count: this.restaurants.length }], rowCount: 1 };
    }

    if (sql.includes('INSERT INTO family_members')) {
      const [name, role, is_picky, hates_leftovers, avatar_emoji] = params;
      const row = { id: this._nextMemberId++, name, role, is_picky, hates_leftovers, avatar_emoji };
      this.members.push(row);
      return { rows: [row], rowCount: 1 };
    }

    if (sql.includes('INSERT INTO restaurants')) {
      const [name, emoji] = params;
      const row = { id: this._nextRestaurantId++, name, emoji, active: true };
      this.restaurants.push(row);
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('INSERT INTO app_config')) {
      const [key, value] = params;
      if (!this.config.has(key)) this.config.set(key, value);
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unexpected SQL in fake pool: ${sql}`);
  }

  async connect() {
    return {
      query: this.query.bind(this),
      release() {},
    };
  }
}

function setFakePool(fake) {
  pool.query = fake.query.bind(fake);
  pool.connect = fake.connect.bind(fake);
  return () => {
    pool.query = ORIGINAL_QUERY;
    pool.connect = ORIGINAL_CONNECT;
  };
}

async function withServer(fn) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    await fn(base);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('bootstrap endpoint reports fresh install needs household setup', async () => {
  const restore = setFakePool(new FakePool());
  try {
    await withServer(async base => {
      const res = await fetch(`${base}/api/bootstrap`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.bootstrap.needs_household, true);
      assert.equal(data.bootstrap.needs_auth, false);
      assert.equal(data.bootstrap.needs_starter_content, true);
      assert.equal(data.bootstrap.ready, false);
    });
  } finally {
    restore();
  }
});

test('root redirects to setup when household is missing', async () => {
  const restore = setFakePool(new FakePool());
  try {
    await withServer(async base => {
      const res = await fetch(`${base}/`, { redirect: 'manual' });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), 'setup');
    });
  } finally {
    restore();
  }
});

test('bootstrap household creates members, starter restaurants, and app config', async () => {
  const fake = new FakePool();
  const restore = setFakePool(fake);
  try {
    await withServer(async base => {
      const res = await fetch(`${base}/api/bootstrap/household`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          members: [
            { name: 'Eric', role: 'parent' },
            { name: 'Alex', role: 'parent' },
            { name: 'Casey', role: 'kid' },
          ],
          rotation_start_date: '2026-04-13',
          install_starter_content: true,
        }),
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.created_members.length, 3);
      assert.equal(data.bootstrap.needs_household, false);
      assert.equal(data.bootstrap.needs_starter_content, false);
      assert.ok(fake.config.has('rotation_start_date'));
      assert.equal(fake.config.get('rotation_start_date'), '2026-04-13');
      assert.ok(fake.restaurants.length >= 4);
    });
  } finally {
    restore();
  }
});

test('root stays on normal app when household already exists', async () => {
  const restore = setFakePool(new FakePool({
    members: [{ id: 1, name: 'Eric', role: 'parent', avatar_emoji: '👨‍🍳' }],
    restaurants: [{ id: 1, name: 'Chipotle', emoji: '🌯', active: true }],
  }));
  try {
    await withServer(async base => {
      const res = await fetch(`${base}/`, { redirect: 'manual' });
      assert.equal(res.status, 200);
    });
  } finally {
    restore();
  }
});
