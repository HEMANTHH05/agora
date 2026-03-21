import postgres from "postgres";

// ── Client singleton ────────────────────────────────────────────────────────
// Uses a global to survive Next.js hot-reload in dev without opening a new
// connection pool on every module re-evaluation.

declare global {
  // eslint-disable-next-line no-var
  var _pgSql: ReturnType<typeof postgres> | undefined;
}

function createSql() {
  return postgres(process.env.DATABASE_URL!, {
    ssl:             "require",
    max:             10,
    idle_timeout:    20,
    connect_timeout: 10,
  });
}

export const sql = global._pgSql ?? (global._pgSql = createSql());

// ── Schema init ─────────────────────────────────────────────────────────────
// Auto-runs when this module is first imported (module-level promise).
// All public functions await _ready before touching the DB, so no query
// can execute before the tables exist — regardless of instrumentation timing.

declare global {
  // eslint-disable-next-line no-var
  var _pgSchemaReady: Promise<void> | undefined;
}

async function initSchema(): Promise<void> {

  await sql`
    CREATE TABLE IF NOT EXISTS conversations (
      id             SERIAL PRIMARY KEY,
      date           TEXT    NOT NULL,
      session_type   INTEGER NOT NULL DEFAULT 1,
      session_status TEXT,
      session_number INTEGER NOT NULL DEFAULT 1,
      topic          TEXT    NOT NULL,
      started_at     TEXT    NOT NULL,
      ended_at       TEXT,
      messages       TEXT    NOT NULL DEFAULT '[]'
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_conversations_date ON conversations(date)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS human_messages (
      id              SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id),
      date            TEXT    NOT NULL,
      agent_id        TEXT    NOT NULL,
      agent_name      TEXT    NOT NULL,
      request         TEXT    NOT NULL,
      request_type    TEXT,
      response        TEXT,
      created_at      TEXT    NOT NULL,
      responded_at    TEXT
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_human_messages_conversation
      ON human_messages(conversation_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_human_messages_unanswered
      ON human_messages(responded_at)
      WHERE responded_at IS NULL
  `;

  console.log("[AGORA] Schema initialized");
}

// Module-level: start schema init immediately on first import, cache the promise.
// Exported so callers using `sql` directly can await it before querying.
export const dbReady: Promise<void> =
  global._pgSchemaReady ??
  (global._pgSchemaReady = initSchema().catch((err) => {
    console.error("[AGORA] Schema initialization failed:", err);
    throw err;
  }));

const _ready = dbReady;

// ── State helpers ──────────────────────────────────────────────────────────

export async function getState(key: string): Promise<string | null> {
  await _ready;
  const rows = await sql`SELECT value FROM state WHERE key = ${key}`;
  return (rows[0] as { value: string } | undefined)?.value ?? null;
}

export async function setState(key: string, value: string): Promise<void> {
  await _ready;
  await sql`
    INSERT INTO state (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

export async function deleteState(key: string): Promise<void> {
  await _ready;
  await sql`DELETE FROM state WHERE key = ${key}`;
}

// ── Manual run counter ─────────────────────────────────────────────────────
// Tracks how many manual /api/trigger calls have been made today.
// Key format: "manual_runs_YYYY-MM-DD" — naturally resets each new day.

export const MANUAL_RUN_LIMIT = 5;

function todayRunKey(): string {
  return `manual_runs_${new Date().toISOString().slice(0, 10)}`;
}

export async function getManualRunsToday(): Promise<number> {
  const raw = await getState(todayRunKey());
  return raw ? parseInt(raw, 10) : 0;
}

export async function incrementManualRuns(): Promise<number> {
  const next = (await getManualRunsToday()) + 1;
  await setState(todayRunKey(), String(next));
  return next;
}

export async function manualRunsRemaining(): Promise<number> {
  return Math.max(0, MANUAL_RUN_LIMIT - (await getManualRunsToday()));
}

// ── Active problem helpers ─────────────────────────────────────────────────

export interface ActiveProblem {
  problem:     string;  // The original problem statement
  startedDate: string;  // yyyy-MM-dd of the session that introduced it
  sessions:    number;  // How many sessions have worked on it
  progress:    string;  // Accumulated notes and partial results across sessions
}

export async function getActiveProblem(): Promise<ActiveProblem | null> {
  const raw = await getState("active_problem");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveProblem;
  } catch {
    return null;
  }
}

export async function setActiveProblem(problem: ActiveProblem): Promise<void> {
  await setState("active_problem", JSON.stringify(problem));
}

export async function clearActiveProblem(): Promise<void> {
  await deleteState("active_problem");
}

// ── Human message helpers ──────────────────────────────────────────────────

export interface HumanMessage {
  id:              number;
  conversation_id: number;
  date:            string;
  agent_id:        string;
  agent_name:      string;
  request:         string;
  request_type:    string | null;
  response:        string | null;
  created_at:      string;
  responded_at:    string | null;
}

export async function insertHumanMessage(
  msg: Omit<HumanMessage, "id" | "response" | "responded_at">
): Promise<number> {
  await _ready;
  const rows = await sql`
    INSERT INTO human_messages
      (conversation_id, date, agent_id, agent_name, request, request_type, created_at)
    VALUES
      (${msg.conversation_id}, ${msg.date}, ${msg.agent_id}, ${msg.agent_name},
       ${msg.request}, ${msg.request_type ?? null}, ${msg.created_at})
    RETURNING id
  `;
  return (rows[0] as { id: number }).id;
}

export async function getAllHumanMessages(): Promise<HumanMessage[]> {
  await _ready;
  const rows = await sql`SELECT * FROM human_messages ORDER BY created_at DESC`;
  return rows as unknown as HumanMessage[];
}

export async function getUnansweredHumanMessages(): Promise<HumanMessage[]> {
  await _ready;
  const rows = await sql`
    SELECT * FROM human_messages
    WHERE responded_at IS NULL
    ORDER BY created_at ASC
  `;
  return rows as unknown as HumanMessage[];
}

export async function answerHumanMessage(
  id: number,
  response: string,
  respondedAt: string
): Promise<void> {
  await _ready;
  await sql`
    UPDATE human_messages
    SET response = ${response}, responded_at = ${respondedAt}
    WHERE id = ${id}
  `;
}

// Returns answers submitted since the given ISO timestamp — injected as context
export async function getRecentResponses(since: string): Promise<HumanMessage[]> {
  await _ready;
  const rows = await sql`
    SELECT * FROM human_messages
    WHERE responded_at IS NOT NULL
      AND responded_at >= ${since}
    ORDER BY responded_at ASC
  `;
  return rows as unknown as HumanMessage[];
}
