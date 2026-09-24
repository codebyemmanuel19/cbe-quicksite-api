const { Pool } = require("pg");
require("dotenv").config();

// One shared pool. Render needs SSL, and a small pool keeps us under its connection limit.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};