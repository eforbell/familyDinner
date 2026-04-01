#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

async function bootstrapSchemaIfNeeded(pool, files, applied) {
  const { rows } = await pool.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'family_members'
    ) AS has_family_members
  `);

  if (rows[0] && rows[0].has_family_members) {
    return false;
  }

  if (applied.size > 0) {
    return false;
  }

  const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  console.log('  bootstrap: db/schema.sql');
  await pool.query(schemaSql);
  for (const file of files) {
    await pool.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
      [file]
    );
    applied.add(file);
  }
  console.log(`  bootstrap: marked ${files.length} migration(s) as applied`);
  return true;
}

async function migrate() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await pool.query('SELECT filename FROM schema_migrations ORDER BY filename');
    const applied = new Set(rows.map(row => row.filename));

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(file => file.endsWith('.sql'))
      .sort();

    const bootstrapped = await bootstrapSchemaIfNeeded(pool, files, applied);
    if (bootstrapped) {
      console.log('Database bootstrapped from db/schema.sql.');
      return;
    }

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip: ${file} (already applied)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`  apply: ${file}`);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.add(file);
        count++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      } finally {
        client.release();
      }
    }

    console.log(count === 0 ? 'All migrations already applied.' : `Applied ${count} migration(s).`);
  } finally {
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err.stack || err.message || String(err));
  process.exit(1);
});
