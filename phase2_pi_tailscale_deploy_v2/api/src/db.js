import Database from "better-sqlite3";
const DB_PATH = process.env.DB_PATH || "/data/hdt.sqlite";

export function openDb() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS hevy_workouts (
      id TEXT PRIMARY KEY,
      updated_at TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hevy_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      workout_id TEXT,
      occurred_at TEXT,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS health_ingest (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at TEXT NOT NULL,
      source TEXT,
      raw_json TEXT NOT NULL
    );
  `);
  return db;
}

export function getMeta(db, key, fallback=null){
  const row=db.prepare("SELECT value FROM meta WHERE key=?").get(key);
  return row?row.value:fallback;
}

export function setMeta(db, key, value){
  db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, String(value));
}
