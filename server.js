require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ──────────────────────────────────────────────────

/** Returns the Monday (00:00 local) of the week containing `date`. */
function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

/** ISO day-of-week: Mon=1 … Sun=7 */
function isoDay(date) {
  const d = date.getDay();
  return d === 0 ? 7 : d;
}

/** Rotation week (1–3) for the week that contains `date`. */
async function rotationWeek(date) {
  const monday = mondayOf(date);
  const { rows } = await pool.query(
    "SELECT value FROM app_config WHERE key = 'rotation_start_date'"
  );
  if (!rows.length) return 1;
  const start = mondayOf(new Date(rows[0].value));
  const weeks = Math.round((monday - start) / (7 * 86400 * 1000));
  return ((weeks % 3) + 3) % 3 + 1;
}

/** Fetch the meal for a given date, respecting daily overrides. */
async function mealForDate(date) {
  const dateStr = date.toISOString().split('T')[0];
  const rw = await rotationWeek(date);
  const dow = isoDay(date);

  // Override first
  const { rows: ov } = await pool.query(
    `SELECT m.*, true as is_override, o.note as override_note
     FROM daily_overrides o
     JOIN meals m ON m.id = o.override_meal_id
     WHERE o.override_date = $1`,
    [dateStr]
  );
  if (ov.length) return ov[0];

  // Rotation template
  const { rows } = await pool.query(
    `SELECT m.*, false as is_override
     FROM meal_rotation r
     JOIN meals m ON m.id = r.meal_id
     WHERE r.week_number = $1 AND r.day_of_week = $2`,
    [rw, dow]
  );
  return rows[0] || null;
}

/** Returns order-in status + restaurant vote tallies for a date, or null. */
async function orderInForDate(dateStr) {
  const { rows } = await pool.query(
    'SELECT * FROM order_in_nights WHERE order_date = $1', [dateStr]
  );
  if (!rows.length) return null;

  const { rows: votes } = await pool.query(
    `SELECT r.id, r.name, r.emoji,
            COUNT(rv.id)::int AS count,
            COALESCE(ARRAY_AGG(f.name) FILTER (WHERE f.name IS NOT NULL), '{}') AS voters
     FROM restaurants r
     LEFT JOIN restaurant_votes rv ON rv.restaurant_id = r.id AND rv.order_date = $1
     LEFT JOIN family_members f ON f.id = rv.member_id
     WHERE r.active = true
     GROUP BY r.id, r.name, r.emoji
     ORDER BY count DESC, r.name`,
    [dateStr]
  );
  return { ...rows[0], votes };
}

// ── Routes ───────────────────────────────────────────────────

// /tonight — simple display page (Raspberry Pi / home screen shortcut)
app.get('/tonight', async (req, res) => {
  try {
    const now     = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
    const orderIn = await orderInForDate(dateStr);
    const meal    = await mealForDate(now);

    const isOrderIn = !!(orderIn || (meal && meal.is_protected));
    const name      = meal ? meal.name : 'Nothing planned';
    const cook      = meal ? (meal.cook || '') : '';
    const rating    = meal ? (meal.kid_rating || '') : '';

    // Embed restaurants + current votes as JSON for the client script
    const votesJson = JSON.stringify(orderIn ? orderIn.votes : []);

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tonight's Dinner</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0f0f0f; color: #fafaf9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100dvh; display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      text-align: center; padding: 2rem 1.5rem;
    }
    .day   { font-size: 1rem; color: #a8a29e; letter-spacing: .15em; text-transform: uppercase; margin-bottom: 1rem; }
    .label { font-size: .85rem; color: #f97316; letter-spacing: .2em; text-transform: uppercase; margin-bottom: .5rem; }
    .meal  { font-size: clamp(1.8rem, 6vw, 3.5rem); font-weight: 700; line-height: 1.2; margin-bottom: 1rem; }
    .meta  { font-size: 1.8rem; }
    .sub   { color: #6b7280; font-size: 1rem; margin-bottom: 1.5rem; }
    /* Restaurant voting grid */
    .r-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; width: 100%; max-width: 360px; margin: 1rem auto 0; }
    .r-btn  {
      background: #1c1917; border: 1px solid #3a3330; border-radius: 12px;
      color: #fafaf9; cursor: pointer; font-family: inherit;
      display: flex; flex-direction: column; align-items: center; gap: .2rem;
      padding: .9rem .5rem; transition: border-color .15s, background .15s;
    }
    .r-btn:hover  { background: #292524; border-color: #57534e; }
    .r-btn.active { border-color: #f97316; background: rgba(249,115,22,.12); }
    .r-emoji  { font-size: 1.8rem; line-height: 1; }
    .r-name   { font-size: .85rem; font-weight: 600; }
    .r-count  { font-size: 1.1rem; font-weight: 700; color: #f97316; }
    .r-voters { font-size: .7rem; color: #a8a29e; }
    /* Member picker */
    .picker { position: fixed; inset: 0; background: rgba(0,0,0,.8); display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .picker.hidden { display: none; }
    .picker-box { background: #1c1917; border: 1px solid #3a3330; border-radius: 14px; padding: 1.5rem; width: 100%; max-width: 320px; }
    .picker-box h2 { margin-bottom: 1rem; font-size: 1.1rem; }
    .m-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
    .m-btn  { background: #0f0f0f; border: 1px solid #3a3330; border-radius: 10px; color: #fafaf9; cursor: pointer; font-family: inherit; padding: .9rem .5rem; display: flex; flex-direction: column; align-items: center; gap: .3rem; transition: border-color .15s; }
    .m-btn:hover { border-color: #f97316; }
    .m-avatar { font-size: 1.6rem; }
    .week-link { position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%); color: #57534e; font-size: .8rem; text-decoration: none; letter-spacing: .08em; border-bottom: 1px solid #3a3330; padding-bottom: 1px; }
    .week-link:hover { color: #a8a29e; }
  </style>
</head>
<body>
  <div class="day">${dayName}</div>
  <div class="label">Tonight's Dinner</div>

  ${isOrderIn ? `
    <div class="meal">Order In Night 🛵</div>
    <div class="sub">No cooking tonight — pick your spot</div>
    <div class="r-grid" id="r-grid"></div>
  ` : `
    <div class="meal">${name}</div>
    <div class="meta">${cook} ${rating}</div>
  `}

  ${isOrderIn ? `
  <!-- Member picker overlay -->
  <div class="picker hidden" id="picker">
    <div class="picker-box">
      <h2>Who are you?</h2>
      <div class="m-grid" id="m-grid"></div>
    </div>
  </div>
  ` : ''}

  <a href="/" class="week-link">see the full week →</a>

  ${isOrderIn ? `
  <script>
    const DATE      = '${dateStr}';
    const votes     = ${votesJson};
    let me = JSON.parse(localStorage.getItem('fd_member') || 'null');
    let members     = [];

    async function init() {
      const res = await fetch('/api/members');
      members   = await res.json();
      renderGrid(votes);
    }

    function myVote() {
      return me ? votes.find(r => r.voters && r.voters.includes(me.name)) : null;
    }

    function renderGrid(v) {
      const grid = document.getElementById('r-grid');
      if (!grid) return;
      const mv = me ? v.find(r => r.voters && r.voters.includes(me.name)) : null;
      grid.innerHTML = v.map(r => \`
        <button class="r-btn\${mv && mv.id === r.id ? ' active' : ''}"
                onclick="castVote(\${r.id})">
          <span class="r-emoji">\${r.emoji}</span>
          <span class="r-name">\${r.name}</span>
          \${r.count > 0 ? \`<span class="r-count">\${r.count}</span>\` : ''}
          \${r.voters && r.voters.length ? \`<span class="r-voters">\${r.voters.join(', ')}</span>\` : ''}
        </button>\`).join('');
    }

    async function castVote(restaurantId) {
      if (!me) { openPicker(() => castVote(restaurantId)); return; }
      const res  = await fetch(\`/api/order-in/\${DATE}/vote\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: restaurantId, member_id: me.id }),
      });
      const data = await res.json();
      if (data.order_in) renderGrid(data.order_in.votes);
    }

    function openPicker(cb) {
      const picker = document.getElementById('picker');
      const grid   = document.getElementById('m-grid');
      picker.classList.remove('hidden');
      grid.innerHTML = members.map(m => \`
        <button class="m-btn" onclick="pickMember(\${m.id})">
          <span class="m-avatar">\${m.avatar_emoji}</span>
          <span>\${m.name}</span>
        </button>\`).join('');
      picker._cb = cb;
    }

    function pickMember(id) {
      me = members.find(m => m.id === id);
      localStorage.setItem('fd_member', JSON.stringify(me));
      document.getElementById('picker').classList.add('hidden');
      const cb = document.getElementById('picker')._cb;
      if (cb) cb();
    }

    init();
  </script>
  ` : ''}
</body>
</html>`);
  } catch (err) {
    res.status(500).send('Error loading dinner');
  }
});

// GET /api/tonight — JSON (for home screen shortcuts / integrations)
app.get('/api/tonight', async (req, res) => {
  try {
    const now     = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const meal    = await mealForDate(now);
    const orderIn = await orderInForDate(dateStr);
    res.json({
      date: dateStr,
      day_name: now.toLocaleDateString('en-US', { weekday: 'long' }),
      rotation_week: await rotationWeek(now),
      meal,
      order_in: orderIn,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/week — full week view
app.get('/api/week', async (req, res) => {
  try {
    const now      = new Date();
    const monday   = mondayOf(now);
    const rw       = await rotationWeek(now);
    const todayStr = now.toISOString().split('T')[0];

    const days = [];
    for (let i = 0; i < 7; i++) {
      const day     = new Date(monday);
      day.setDate(monday.getDate() + i);
      const dateStr = day.toISOString().split('T')[0];
      const [meal, orderIn] = await Promise.all([
        mealForDate(day),
        orderInForDate(dateStr),
      ]);
      days.push({
        date: dateStr,
        day_name: day.toLocaleDateString('en-US', { weekday: 'long' }),
        day_of_week: i + 1,
        is_today: dateStr === todayStr,
        meal,
        order_in: orderIn,
      });
    }

    res.json({
      rotation_week: rw,
      week_start: monday.toISOString().split('T')[0],
      days,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/meals — all meals (for swap dropdown)
app.get('/api/meals', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, cook, kid_rating, is_protected FROM meals ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/meals/:id — single meal with full details
app.get('/api/meals/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM meals WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/swap — swap a meal for a specific date
app.put('/api/swap', async (req, res) => {
  const { date, meal_id, note, created_by } = req.body;
  if (!date || !meal_id) return res.status(400).json({ error: 'date and meal_id required' });
  try {
    await pool.query(
      `INSERT INTO daily_overrides (override_date, override_meal_id, note, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (override_date)
       DO UPDATE SET override_meal_id = $2, note = $3, updated_at = NOW()`,
      [date, meal_id, note || null, created_by || null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/swap/:date — restore to rotation default
app.delete('/api/swap/:date', async (req, res) => {
  try {
    await pool.query('DELETE FROM daily_overrides WHERE override_date = $1', [req.params.date]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/members
app.get('/api/members', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM family_members ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vote — react to a meal
app.post('/api/vote', async (req, res) => {
  const { meal_id, member_id, reaction } = req.body;
  if (!meal_id || !member_id || !reaction) {
    return res.status(400).json({ error: 'meal_id, member_id, and reaction required' });
  }
  const weekStart = mondayOf(new Date()).toISOString().split('T')[0];
  try {
    await pool.query(
      `INSERT INTO meal_votes (meal_id, member_id, reaction, week_context)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (meal_id, member_id, week_context)
       DO UPDATE SET reaction = $3, created_at = NOW()`,
      [meal_id, member_id, reaction, weekStart]
    );
    // Return updated vote counts for this meal
    const { rows } = await pool.query(
      `SELECT v.reaction, f.name, f.avatar_emoji
       FROM meal_votes v
       JOIN family_members f ON f.id = v.member_id
       WHERE v.meal_id = $1 AND v.week_context = $2`,
      [meal_id, weekStart]
    );
    res.json({ success: true, votes: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/votes/:meal_id — votes for a meal this week
app.get('/api/votes/:meal_id', async (req, res) => {
  const weekStart = mondayOf(new Date()).toISOString().split('T')[0];
  try {
    const { rows } = await pool.query(
      `SELECT v.reaction, f.name, f.avatar_emoji
       FROM meal_votes v
       JOIN family_members f ON f.id = v.member_id
       WHERE v.meal_id = $1 AND v.week_context = $2`,
      [req.params.meal_id, weekStart]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/log — record what actually got cooked
app.post('/api/log', async (req, res) => {
  const { meal_id, planned_meal_id, notes, cooked_date } = req.body;
  if (!meal_id) return res.status(400).json({ error: 'meal_id required' });
  const date = cooked_date || new Date().toISOString().split('T')[0];
  try {
    await pool.query(
      `INSERT INTO cook_log (cooked_date, meal_id, planned_meal_id, was_planned, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [date, meal_id, planned_meal_id || null, meal_id === planned_meal_id, notes || null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/energy — Alex's weekly energy flag
app.post('/api/energy', async (req, res) => {
  const { energy_level, note } = req.body;
  if (!energy_level || energy_level < 1 || energy_level > 5) {
    return res.status(400).json({ error: 'energy_level 1–5 required' });
  }
  const weekStart = mondayOf(new Date()).toISOString().split('T')[0];
  try {
    await pool.query(
      `INSERT INTO val_energy (week_start, energy_level, note)
       VALUES ($1, $2, $3)
       ON CONFLICT (week_start) DO UPDATE SET energy_level = $2, note = $3`,
      [weekStart, energy_level, note || null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/energy — this week's energy level
app.get('/api/energy', async (req, res) => {
  const weekStart = mondayOf(new Date()).toISOString().split('T')[0];
  try {
    const { rows } = await pool.query(
      'SELECT * FROM val_energy WHERE week_start = $1',
      [weekStart]
    );
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/restaurants
app.get('/api/restaurants', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM restaurants WHERE active = true ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/order-in — declare a night as order-in
app.post('/api/order-in', async (req, res) => {
  const { date, created_by } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    await pool.query(
      `INSERT INTO order_in_nights (order_date, created_by)
       VALUES ($1, $2)
       ON CONFLICT (order_date) DO NOTHING`,
      [date, created_by || null]
    );
    res.json({ success: true, order_in: await orderInForDate(date) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/order-in/:date — cancel order-in night
app.delete('/api/order-in/:date', async (req, res) => {
  try {
    await pool.query('DELETE FROM restaurant_votes WHERE order_date = $1', [req.params.date]);
    await pool.query('DELETE FROM order_in_nights WHERE order_date = $1', [req.params.date]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/order-in/:date/vote — vote for a restaurant
app.post('/api/order-in/:date/vote', async (req, res) => {
  const { restaurant_id, member_id } = req.body;
  if (!restaurant_id || !member_id) {
    return res.status(400).json({ error: 'restaurant_id and member_id required' });
  }
  try {
    await pool.query(
      `INSERT INTO restaurant_votes (order_date, restaurant_id, member_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (order_date, member_id) DO UPDATE SET restaurant_id = $2, created_at = NOW()`,
      [req.params.date, restaurant_id, member_id]
    );
    res.json({ success: true, order_in: await orderInForDate(req.params.date) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🍽️  Family Dinner running → http://0.0.0.0:${PORT}`);
  console.log(`   Tonight display → http://0.0.0.0:${PORT}/tonight`);
});
