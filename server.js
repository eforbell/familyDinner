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

// ── Routes ───────────────────────────────────────────────────

// /tonight — simple display page (Raspberry Pi / home screen shortcut)
app.get('/tonight', async (req, res) => {
  try {
    const meal = await mealForDate(new Date());
    const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const name = meal ? meal.name : 'Nothing planned';
    const cook = meal ? (meal.cook || '') : '';
    const rating = meal ? (meal.kid_rating || '') : '';
    const isProtected = meal ? meal.is_protected : false;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tonight's Dinner</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0f0f0f;
      color: #fafaf9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 2rem;
    }
    .day { font-size: 1rem; color: #a8a29e; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 1rem; }
    .label { font-size: 0.85rem; color: #f97316; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 0.5rem; }
    .meal { font-size: clamp(1.8rem, 6vw, 3.5rem); font-weight: 700; line-height: 1.2; margin-bottom: 1.5rem; }
    .meta { font-size: 1.8rem; }
    .protected { color: #6b7280; font-size: 1.1rem; margin-top: 1rem; }
  </style>
  <meta http-equiv="refresh" content="1800">
</head>
<body>
  <div class="day">${dayName}</div>
  <div class="label">Tonight's Dinner</div>
  <div class="meal">${name}</div>
  ${!isProtected ? `<div class="meta">${cook} ${rating}</div>` : '<div class="protected">Order in tonight 🛵</div>'}
</body>
</html>`);
  } catch (err) {
    res.status(500).send('Error loading dinner');
  }
});

// GET /api/tonight — JSON (for home screen shortcuts / integrations)
app.get('/api/tonight', async (req, res) => {
  try {
    const now = new Date();
    const meal = await mealForDate(now);
    res.json({
      date: now.toISOString().split('T')[0],
      day_name: now.toLocaleDateString('en-US', { weekday: 'long' }),
      rotation_week: await rotationWeek(now),
      meal,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/week — full week view
app.get('/api/week', async (req, res) => {
  try {
    const now = new Date();
    const monday = mondayOf(now);
    const rw = await rotationWeek(now);
    const todayStr = now.toISOString().split('T')[0];

    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      const dateStr = day.toISOString().split('T')[0];
      const meal = await mealForDate(day);
      days.push({
        date: dateStr,
        day_name: day.toLocaleDateString('en-US', { weekday: 'long' }),
        day_of_week: i + 1,
        is_today: dateStr === todayStr,
        meal,
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🍽️  Family Dinner running → http://0.0.0.0:${PORT}`);
  console.log(`   Tonight display → http://0.0.0.0:${PORT}/tonight`);
});
