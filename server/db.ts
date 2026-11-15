import { DatabaseSync } from 'node:sqlite';

// Each entry upgrades the schema by one version. PRAGMA user_version records how many ran.
// Append new migrations; never edit a released one.
const migrations: string[] = [
  `
  CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    catalog_id TEXT,
    runtime_label TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    status TEXT NOT NULL,
    status_detail TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    chat_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    avatar TEXT,
    lead_id TEXT,
    project_id TEXT,
    hop_limit INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE conversation_members (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (conversation_id, agent_id)
  );
  CREATE TABLE messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    parts TEXT NOT NULL,
    mentions TEXT NOT NULL,
    run_id TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX messages_by_conversation ON messages(conversation_id, seq);
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    parent_run_id TEXT,
    trigger_message_id TEXT NOT NULL,
    depth INTEGER NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    prompt TEXT,
    started_at TEXT,
    ended_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX runs_by_conversation ON runs(conversation_id, status);
  CREATE TABLE acp_sessions (
    agent_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    cwd TEXT NOT NULL,
    PRIMARY KEY (agent_id, conversation_id)
  );
  CREATE TABLE cursors (
    agent_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    seen_seq INTEGER NOT NULL,
    skipped TEXT NOT NULL,
    PRIMARY KEY (agent_id, conversation_id)
  );
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE routines (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    schedule TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    next_run_at TEXT,
    last_run_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE browser_sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
  CREATE TABLE agent_tokens (
    token_hash TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
  `,
  `
  -- Last session settings each agent reported, shown at once while a new session starts.
  CREATE TABLE agent_session_cache (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    config_options TEXT NOT NULL,
    modes TEXT,
    commands TEXT NOT NULL
  );
  -- Option values chosen per conversation, reapplied to every new or restored session.
  CREATE TABLE session_choices (
    agent_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    option_id TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (agent_id, conversation_id, option_id)
  );
  -- Context window use of the stored session.
  ALTER TABLE acp_sessions ADD COLUMN usage TEXT;
  -- A code thread started with agentry_start_code_task reports each finished run to the conversation that asked for it.
  ALTER TABLE conversations ADD COLUMN requested_from TEXT REFERENCES conversations(id) ON DELETE SET NULL;
  `,
  `
  -- Copied invitations. The agent appears only when it first calls the hub with the token.
  CREATE TABLE invitations (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
  `,
];

export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let version = user_version; version < migrations.length; version++) {
    db.exec('BEGIN');
    db.exec(migrations[version]);
    db.exec(`PRAGMA user_version = ${version + 1}`);
    db.exec('COMMIT');
  }
  return db;
}
