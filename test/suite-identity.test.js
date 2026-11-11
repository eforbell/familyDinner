'use strict';

// Suite identity (Home Base Feature-10): the gate in front of every route in tailnet mode. Local mode is the rest of
// the suite, unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createSuiteIdentity, homeBaseUid, publicPath } = require('../lib/suite-identity');
const { app, pool, setSuiteIdentityForTests } = require('../server');

const SOCKET = 'unix:/run/sovereign-apps/family-dinner/app.sock';
const ORIGIN = 'https://smith-home.example-tailnet.ts.net';
const TAILNET = { SOVEREIGN_AUTH_MODE: 'tailnet', SOVEREIGN_LISTEN: SOCKET, SOVEREIGN_HOMEBASE_UID: '998', APP_PUBLIC_URL: `${ORIGIN}/dinner/` };
const noSnapshot = { current: () => ({ ok: false, reason: 'missing', message: 'no snapshot' }) };
const unlinked = { findLinked: async () => null };

// A directory snapshot as the library hands it over: members by stable user ID.
function snapshotOf(members) {
  const list = members.map((member) => ({ status: 'active', epoch: 1, apps: ['family-dinner'], role: 'parent', ...member }));
  return { current: () => ({ ok: true, snapshot: { members: list, byUserId: new Map(list.map((member) => [member.userId, member])) } }) };
}
const as = (userId, login) => ({ 'x-sovereign-user-id': userId, 'x-sovereign-login': login });
const PARENT = { userId: 'u-parent', memberId: 'm_parent', login: 'parent@example.com', name: 'Parent' };
const KID = { userId: 'u-kid', memberId: 'm_kid', login: 'kid@example.com', name: '<b>Kid</b>', role: 'kid' };
const PARENT_HEADERS = as('u-parent', 'parent@example.com');
const KID_HEADERS = as('u-kid', 'kid@example.com');

// family_members as Postgres would answer what the gate, the member list, setup's status and the cook log ask.
class MembersDb {
  constructor(rows) { this.rows = rows; }
  async query(sql, params = []) {
    if (sql.includes('FROM family_members WHERE suite_member_id = $1')) return { rows: this.rows.filter((row) => row.suite_member_id === params[0]) };
    if (sql.includes('FROM family_members ORDER BY id')) return { rows: this.rows.map((row) => ({ ...row })) };
    if (sql.includes('COUNT(*)::int AS count FROM family_members')) return { rows: [{ count: this.rows.length }] };
    if (/COUNT\(\*\)::int AS count FROM (meals|meal_rotation|restaurants)/.test(sql)) return { rows: [{ count: 3 }] };
    if (sql.includes('FROM cook_log')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

const ORIGINAL_QUERY = pool.query;
async function withServer(env, db, fn) {
  setSuiteIdentityForTests(env.env, env.options);
  pool.query = db.query.bind(db);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    pool.query = ORIGINAL_QUERY;
    setSuiteIdentityForTests({});
  }
}
const tailnet = (members) => ({ env: TAILNET, options: { reader: snapshotOf(members) } });
const household = () => new MembersDb([
  { id: 1, name: 'Parent', role: 'parent', avatar_emoji: '👤', suite_member_id: 'm_parent' },
  { id: 2, name: 'Kid', role: 'kid', avatar_emoji: '👤', suite_member_id: 'm_kid' },
]);

test('no SOVEREIGN_AUTH_MODE means local: installs from before Home Base set one keep the picker', () => {
  assert.equal(createSuiteIdentity({}).mode, 'local');
  assert.equal(createSuiteIdentity({ SOVEREIGN_AUTH_MODE: 'local' }).mode, 'local');
  assert.equal(createSuiteIdentity({}).tailnet, false);
});

test('a configuration the app cannot trust refuses to start', () => {
  for (const mode of ['', ' ', 'Tailnet', 'off', 'true']) {
    assert.throws(() => createSuiteIdentity({ ...TAILNET, SOVEREIGN_AUTH_MODE: mode }, unlinked), /SOVEREIGN_AUTH_MODE/, `mode '${mode}'`);
  }
  // Identity headers are trusted only on the app's socket, which only nginx can reach.
  for (const listen of [undefined, '', '127.0.0.1:3000']) {
    assert.throws(() => createSuiteIdentity({ ...TAILNET, SOVEREIGN_LISTEN: listen }, unlinked), /SOVEREIGN_LISTEN/);
  }
  for (const uid of [undefined, '', '0', '-1', '01', '1e3', '4294967295', '99999999999', 'homebase']) {
    assert.throws(() => createSuiteIdentity({ ...TAILNET, SOVEREIGN_HOMEBASE_UID: uid }, unlinked), /SOVEREIGN_HOMEBASE_UID/, `uid '${uid}'`);
  }
  for (const url of [undefined, '', 'dinner', 'http://smith-home.example-tailnet.ts.net/dinner/']) {
    assert.throws(() => createSuiteIdentity({ ...TAILNET, APP_PUBLIC_URL: url }, unlinked), /APP_PUBLIC_URL/, `url '${url}'`);
  }
  // The link page redirect is built on the path, so it must stay on this host.
  for (const url of [`${ORIGIN}//evil.example/`, `${ORIGIN}/dinner//x/`, `${ORIGIN}/din%2Fner/`]) {
    assert.throws(() => createSuiteIdentity({ ...TAILNET, APP_PUBLIC_URL: url }, unlinked), /APP_PUBLIC_URL/, `url '${url}'`);
  }
  for (const [url, path] of [[`${ORIGIN}/dinner/`, '/dinner/'], [`${ORIGIN}/dinner`, '/dinner/'], [`${ORIGIN}/`, '/']]) {
    assert.equal(publicPath(url), path);
  }
  assert.equal(homeBaseUid('998'), 998);
  assert.throws(() => createSuiteIdentity(TAILNET), /find linked members/);
  assert.equal(createSuiteIdentity(TAILNET, unlinked).mode, 'tailnet');
});

test('tailnet mode takes writes only as JSON from the app\'s own origin', async () => {
  await withServer(tailnet([PARENT]), new MembersDb([{ id: 1, name: 'Parent', role: 'parent', suite_member_id: null }]), async (base) => {
    // Setup is a write an unlinked parent may reach; once a household exists it refuses, after the guard.
    const setup = (headers) => fetch(`${base}/api/bootstrap/household`, { method: 'POST', headers: { ...PARENT_HEADERS, ...headers }, body: '{}' });
    const refusals = [
      [{}, 'origin_missing'],
      [{ origin: 'https://smith-pulse.example-tailnet.ts.net', 'content-type': 'application/json' }, 'origin_mismatch'],
      [{ origin: ORIGIN, 'sec-fetch-site': 'same-site', 'content-type': 'application/json' }, 'fetch_site'],
      [{ origin: ORIGIN }, 'content_type'],
      [{ origin: ORIGIN, 'content-type': 'text/plain' }, 'content_type'],
      [{ origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, 'content_type'],
    ];
    for (const [headers, reason] of refusals) {
      const res = await setup(headers);
      assert.equal(res.status, 403, reason);
      assert.equal((await res.json()).reason, reason);
    }
    const res = await setup({ origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' });
    assert.equal(res.status, 409, 'through the guard and the gate to the handler');
    assert.equal((await res.json()).code, 'household_already_initialized');
  });
});

test('tailnet mode lets in only a household member with access whom a parent has linked', async () => {
  const members = [
    PARENT,
    KID,
    { userId: 'u-away', memberId: 'm_away', login: 'away@example.com', name: 'Away', status: 'disabled' },
    { userId: 'u-other', memberId: 'm_other', login: 'other@example.com', name: 'Other', apps: ['family-plan'] },
    { userId: 'u-new', memberId: 'm_new', login: 'new@example.com', name: 'New kid', role: 'kid' },
  ];
  await withServer(tailnet(members), household(), async (base) => {
    const get = (route, headers = {}) => fetch(`${base}${route}`, { headers, redirect: 'manual' });
    // Linked: through to the app, parent and kid alike.
    assert.equal((await get('/api/members', PARENT_HEADERS)).status, 200);
    assert.equal((await get('/api/members', KID_HEADERS)).status, 200);
    assert.equal((await get('/plan', PARENT_HEADERS)).status, 200);

    const refused = [
      [{}, 'not_member'],                                                     // no identity: tagged device, lookup failed
      [as('u-parent', 'someone@example.com'), 'not_member'],                  // the login must match the user ID
      [as('u-nobody', 'nobody@example.com'), 'not_member'],                   // not in the household
      [as('u-away', 'away@example.com'), 'not_member'],                       // disabled
      [as('u-other', 'other@example.com'), 'not_member'],                     // no access to Family Dinner
      [{ 'x-sovereign-user-id': 'u-parent', 'x-sovereign-login': 'tagged-devices' }, 'not_member'],
      [as('u-new', 'new@example.com'), 'not_linked'],                         // a kid nobody has linked yet
    ];
    for (const [headers, code] of refused) {
      for (const route of ['/api/members', '/API/members', '/api/members/']) {
        const api = await get(route, headers);
        assert.equal(api.status, 403, `${code} ${route}`);
        assert.equal((await api.json()).code, code, route);
        assert.equal(api.headers.get('cache-control'), 'no-store');
      }
      for (const route of ['/', '/tonight', '/plan', '/index.html', '/link']) {
        const page = await get(route, headers);
        assert.equal(page.status, 403, `${code} ${route}`);
        assert.match(page.headers.get('content-type'), /text\/html/);
      }
    }
    // The page names who is asking, as text.
    const kidPage = await (await get('/tonight', as('u-new', 'new@example.com'))).text();
    assert.match(kidPage, /Ask a parent to link you/);
    assert.match(kidPage, /New kid/);
    // Health, readiness and page assets are open; data and pages are not.
    assert.equal((await get('/api/health')).status, 200);
    assert.equal((await get('/style.css')).status, 200);
    assert.equal((await get('/favicon.svg')).status, 200);
    assert.equal((await get('/sovereign-fonts.css')).status, 200);
    assert.equal((await get('/api/tonight')).status, 403);
    assert.equal((await get('/api/bootstrap')).status, 403);
    assert.equal((await fetch(`${base}/style.css`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' } })).status, 403);
  });

  // Without a snapshot nobody is a member: say so, and that it's not the asker's doing.
  await withServer({ env: TAILNET, options: { reader: noSnapshot } }, household(), async (base) => {
    const res = await fetch(`${base}/api/members`, { headers: PARENT_HEADERS });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'directory');
  });

  // Local mode ignores identity headers entirely.
  await withServer({ env: {} }, household(), async (base) => {
    assert.equal((await fetch(`${base}/api/members`)).status, 200);
  });
});

test('a kid\'s account opens only a kid\'s row, checked on every request', async () => {
  // Linked as a parent row; the directory has since made them a kid.
  const db = new MembersDb([{ id: 1, name: 'Parent', role: 'parent', suite_member_id: 'm_kid' }]);
  await withServer(tailnet([KID]), db, async (base) => {
    for (const route of ['/api/members', '/api/week']) {
      const res = await fetch(`${base}${route}`, { headers: KID_HEADERS });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).code, 'stale_link');
    }
    const page = await fetch(`${base}/tonight`, { headers: KID_HEADERS });
    assert.equal(page.status, 403);
    const text = await page.text();
    assert.match(text, /Ask a parent to link you again/);
    // The page names who is asking, as text: a name is never markup.
    assert.match(text, /&lt;b&gt;Kid&lt;\/b&gt;/);
    assert.doesNotMatch(text, /<b>Kid/);
  });
});

test('a parent nobody has linked reaches the link page and setup, and nothing about the household', async () => {
  const db = new MembersDb([{ id: 1, name: 'Parent', role: 'parent', suite_member_id: null }]);
  await withServer(tailnet([PARENT]), db, async (base) => {
    const get = (route) => fetch(`${base}${route}`, { headers: PARENT_HEADERS, redirect: 'manual' });
    for (const route of ['/', '/tonight', '/plan', '/admin', '/recipes/1', '/index.html', '/LINK', '/setup/']) {
      const res = await get(route);
      assert.equal(res.status, 303, route);
      assert.equal(res.headers.get('location'), '/dinner/link', route);
    }
    for (const route of ['/api/members', '/api/week', '/api/suite/links/01', '/api/cook-log/export.csv']) {
      const res = await get(route);
      assert.equal(res.status, 403, route);
      assert.equal((await res.json()).code, 'not_linked', route);
    }
    // Admitted (no link routes yet, so 404 means the gate let it through).
    assert.equal((await get('/link')).status, 404);
    assert.equal((await get('/api/suite/links')).status, 404);
    assert.equal((await get('/api/suite/links/1')).status, 404);
    // Setup redirects home once a household exists; the gate then sends them to the link page.
    assert.equal((await get('/setup')).headers.get('location'), './');
    // Setup's status says only whether a household is still needed: no counts.
    const status = await get('/api/bootstrap');
    assert.equal(status.status, 200);
    assert.equal(status.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await status.json(), { app: 'family-dinner', bootstrap: { needs_household: false } });
  });
  // Linked, the full status as before.
  await withServer(tailnet([PARENT]), household(), async (base) => {
    const body = await (await fetch(`${base}/api/bootstrap`, { headers: PARENT_HEADERS })).json();
    assert.equal(body.counts.family_members, 2);
  });
});

test('the API is for Dinner\'s own pages: a navigation to it is refused, in any spelling, except the CSV download', async () => {
  await withServer(tailnet([PARENT]), household(), async (base) => {
    // fetch() sets Sec-Fetch-Mode itself (a forbidden header), so a browser's navigation is sent by hand.
    const navigate = (route) => new Promise((resolve, reject) => {
      http.get(`${base}${route}`, { headers: { ...PARENT_HEADERS, 'sec-fetch-mode': 'navigate' } }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: { get: (name) => res.headers[name] }, json: async () => JSON.parse(body) }));
      }).on('error', reject);
    });
    for (const route of ['/api/members', '/API/Members', '/api/members/', '/api/week', '/Api/cook-log/export.csv']) {
      const res = await navigate(route);
      assert.equal(res.status, 403, route);
      assert.equal((await res.json()).code, 'not_a_page', route);
    }
    const csv = await navigate('/api/cook-log/export.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    // The pages' own fetches are not navigations.
    assert.equal((await fetch(`${base}/api/members`, { headers: { ...PARENT_HEADERS, 'sec-fetch-mode': 'cors' } })).status, 200);
    assert.equal((await navigate('/plan')).status, 200);
  });
});
