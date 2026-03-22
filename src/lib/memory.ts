import Anthropic from "@anthropic-ai/sdk";
import { getState, setState } from "./db";
import { AgentId, AGENTS } from "./agents";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AgentMemory {
  agentId:         AgentId;
  keyInsights:     string[]; // max 10 — things learned across all sessions
  researchHistory: string[]; // max 5  — summaries of past problems worked on
  preferences:     string[]; // max 5  — patterns noticed about own reasoning
  lastUpdated:     string;   // ISO timestamp
}

// Memory-injected messages for context (what gets shown to the agent)
export interface MemoryContext {
  agentId:         AgentId;
  keyInsights:     string[];
  researchHistory: string[];
  preferences:     string[];
}

// ── Limits ─────────────────────────────────────────────────────────────────

const MAX_INSIGHTS = 10;
const MAX_HISTORY  = 5;
const MAX_PREFS    = 5;

// ── Storage helpers ────────────────────────────────────────────────────────

function memoryKey(agentId: AgentId): string {
  return `memory_${agentId}`;
}

export async function getAgentMemory(agentId: AgentId): Promise<AgentMemory> {
  const raw = await getState(memoryKey(agentId));
  if (raw) {
    try {
      return JSON.parse(raw) as AgentMemory;
    } catch {
      // Corrupted — start fresh
    }
  }
  return {
    agentId,
    keyInsights:     [],
    researchHistory: [],
    preferences:     [],
    lastUpdated:     new Date().toISOString(),
  };
}

export async function setAgentMemory(memory: AgentMemory): Promise<void> {
  await setState(memoryKey(memory.agentId), JSON.stringify(memory));
}

export async function getAllAgentMemories(): Promise<AgentMemory[]> {
  return Promise.all(
    (["quinn", "eva", "sol", "vera"] as AgentId[]).map(getAgentMemory)
  );
}

// ── Context formatter ──────────────────────────────────────────────────────
// Injects an agent's memory into their context block at session start.

export function formatMemoryForContext(memory: AgentMemory): string {
  const hasAny =
    memory.keyInsights.length > 0 ||
    memory.researchHistory.length > 0 ||
    memory.preferences.length > 0;

  if (!hasAny) return "";

  const sections: string[] = [];

  if (memory.keyInsights.length > 0) {
    const lines = memory.keyInsights.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
    sections.push(`Key insights you have accumulated:\n${lines}`);
  }

  if (memory.researchHistory.length > 0) {
    const lines = memory.researchHistory.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
    sections.push(`Problems you have worked on before:\n${lines}`);
  }

  if (memory.preferences.length > 0) {
    const lines = memory.preferences.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
    sections.push(`Patterns you have noticed about your own reasoning:\n${lines}`);
  }

  return `YOUR MEMORY FROM PAST SESSIONS:\n${sections.join("\n\n")}`;
}

// ── Post-session memory update ─────────────────────────────────────────────
// Called after each research session for every agent.
// Uses a lightweight LLM call to extract insights from that agent's messages.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface MemoryExtraction {
  keyInsights:  string[]; // 1–2 items
  historyEntry: string;   // one sentence summary of this session
  preference:   string | null; // one pattern noticed, or null
}

async function extractMemory(
  agentId: AgentId,
  agentMessages: string[],
  topic: string,
  existingMemory: AgentMemory
): Promise<MemoryExtraction | null> {
  if (agentMessages.length === 0) return null;

  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) return null;

  const transcript = agentMessages.map((m, i) => `Turn ${i + 1}: ${m}`).join("\n\n");

  const prompt = `You are extracting memory for ${agent.name} (${agent.role}) from a research session.

RESEARCH TOPIC: ${topic}

${agent.name.toUpperCase()}'S MESSAGES THIS SESSION:
${transcript}

${existingMemory.keyInsights.length > 0 ? `EXISTING INSIGHTS (do not duplicate):\n${existingMemory.keyInsights.join("\n")}` : ""}

Extract the following. Respond in valid JSON only, no markdown:
{
  "keyInsights": ["insight 1", "insight 2"],
  "historyEntry": "one sentence describing what was worked on and what was found",
  "preference": "one pattern about how this agent reasons best, or null if nothing notable"
}

Rules:
- keyInsights: 1–2 items maximum. Only include genuinely novel insights not already in the existing list. Focus specifically on:
  * For Quinn: what framing issue was most important this session? What sub-question remains open?
  * For Eva: what is the single most important piece of evidence found? What does Eva still need to search for next session?
  * For Sol: which hypothesis was most promising at session end? What made it survive Vera's scrutiny (or not)?
  * For Vera: what did Vera find most defensible? What is the single most important unresolved question that blocks resolution?
  Each insight is a single concrete sentence — not generic, not vague.
- historyEntry: One sentence. Past tense. Specific about the problem and what was concretely found or eliminated.
- preference: One sentence about a reasoning pattern specific to this agent's behavior this session, or null.`;

  const tryParse = (raw: string): MemoryExtraction | null => {
    let s = raw.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
    // Salvage truncated JSON: if it doesn't end with }, try appending }
    if (!s.endsWith("}")) s = s + "}";
    try {
      return JSON.parse(s) as MemoryExtraction;
    } catch {
      return null;
    }
  };

  const call = () => anthropic.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 600,
    messages:   [{ role: "user", content: prompt }],
  });

  try {
    const response = await call();
    const text = (response.content[0] as { text: string }).text.trim();
    const result = tryParse(text);
    if (result) return result;

    // Retry once if parsing failed
    console.warn(`[AGORA] Memory parse failed for ${agentId}, retrying…`);
    const retry = await call();
    const retryText = (retry.content[0] as { text: string }).text.trim();
    return tryParse(retryText);
  } catch (err) {
    console.error(`[AGORA] Memory extraction failed for ${agentId}:`, err);
    return null;
  }
}

// Adds new items to a capped array, dropping oldest when over the limit.
function cappedPush(arr: string[], items: string[], max: number): string[] {
  const next = [...arr, ...items];
  return next.length > max ? next.slice(next.length - max) : next;
}

// ── Main update function ───────────────────────────────────────────────────
// Called once per agent after a session ends.

export async function updateAgentMemory(
  agentId: AgentId,
  sessionMessages: Array<{ agentId: string; content: string }>,
  topic: string
): Promise<void> {
  const agentMessages = sessionMessages
    .filter((m) => m.agentId === agentId)
    .map((m) => m.content);

  if (agentMessages.length === 0) return;

  const existing   = await getAgentMemory(agentId);
  const extraction = await extractMemory(agentId, agentMessages, topic, existing);

  if (!extraction) return;

  const updated: AgentMemory = {
    agentId,
    keyInsights: cappedPush(
      existing.keyInsights,
      extraction.keyInsights.filter(Boolean),
      MAX_INSIGHTS
    ),
    researchHistory: cappedPush(
      existing.researchHistory,
      [extraction.historyEntry].filter(Boolean),
      MAX_HISTORY
    ),
    preferences: extraction.preference
      ? cappedPush(existing.preferences, [extraction.preference], MAX_PREFS)
      : existing.preferences,
    lastUpdated: new Date().toISOString(),
  };

  await setAgentMemory(updated);
  console.log(`[AGORA] Memory updated for ${agentId} — ${updated.keyInsights.length} insights`);
}

// ── Batch update ───────────────────────────────────────────────────────────
// Updates all four agents' memories after a session. Runs in parallel.

export async function updateAllAgentMemories(
  sessionMessages: Array<{ agentId: string; content: string }>,
  topic: string
): Promise<void> {
  await Promise.all(
    (["quinn", "eva", "sol", "vera"] as AgentId[]).map((id) =>
      updateAgentMemory(id, sessionMessages, topic)
    )
  );
}
