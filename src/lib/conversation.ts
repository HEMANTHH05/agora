import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AGENTS, Agent, AgentId, RESEARCH_ORDER } from "./agents";
import { getResearchSeed } from "./topics";
import {
  sql,
  getActiveProblem, setActiveProblem, clearActiveProblem, ActiveProblem,
  insertHumanMessage, getUnansweredHumanMessages, getRecentResponses,
  HumanMessage,
} from "./db";
import { emitSessionStart, emitMessage, emitSessionEnd } from "./emitter";
import { getAgentMemory, getAllAgentMemories, formatMemoryForContext, updateAllAgentMemories } from "./memory";
import { searchWeb } from "./search";
import { format, differenceInDays, parseISO } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Message {
  agentId:          AgentId;
  agentName:        string;
  agentRole:        string;
  content:          string;
  timestamp:        string;
  elapsedSeconds:   number;
  remainingSeconds: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const SESSION_DURATION        = 600;
const TURN_GAP_MS             = 3500;
const HUMAN_POLL_INTERVAL_MS  = 30_000;
const MIN_SESSIONS_TO_RESOLVE = 3;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function toneHint(hour: number): string {
  if (hour < 5)  return "It is the middle of the night. The session is unguarded and direct.";
  if (hour < 9)  return "It is early morning. Thoughts are still forming.";
  if (hour < 12) return "It is mid-morning. Alert and precise.";
  if (hour < 15) return "It is midday.";
  if (hour < 19) return "It is afternoon.";
  if (hour < 22) return "It is evening.";
  return "It is late night.";
}

// ── HUMAN_REQUEST parser ───────────────────────────────────────────────────

interface ParsedRequest {
  text:        string;
  requestType: string;
}

function parseHumanRequests(raw: string): { cleaned: string; requests: ParsedRequest[] } {
  const lines    = raw.split("\n");
  const requests: ParsedRequest[] = [];
  const kept:     string[] = [];

  for (const line of lines) {
    const match = line.match(/^HUMAN_REQUEST:\s*(.+)/i);
    if (match) {
      const content   = match[1].trim();
      const typeMatch = content.match(/\[(DATA_REQUEST|CLARIFICATION|VALIDATION)\]/i);
      const requestType = typeMatch ? typeMatch[1].toUpperCase() : "CLARIFICATION";
      const text = content.replace(/\[(DATA_REQUEST|CLARIFICATION|VALIDATION)\]/gi, "").trim();
      requests.push({ text, requestType });
    } else {
      kept.push(line);
    }
  }

  return { cleaned: kept.join("\n").trim(), requests };
}

// ── RESEARCH_RESOLVED detector ─────────────────────────────────────────────

function parseResolution(content: string): string | null {
  const match = content.match(/RESEARCH_RESOLVED:\s*([\s\S]+)/i);
  return match ? match[1].trim() : null;
}

// ── SESSION_CLOSURE detector ───────────────────────────────────────────────

function parseClosure(content: string): boolean {
  return /SESSION_CLOSURE:/i.test(content);
}

// ── Turn instruction builder ───────────────────────────────────────────────

function buildTurnInstruction(
  agent: Agent,
  history: Message[],
  turnIndex: number,
  sessionNumber: number,
  closureRequested: boolean,
): string {
  const isFirstCycle = turnIndex < RESEARCH_ORDER.length;
  const lastQuinn = [...history].reverse().find((m) => m.agentId === "quinn");
  const lastEva   = [...history].reverse().find((m) => m.agentId === "eva");
  const lastSol   = [...history].reverse().find((m) => m.agentId === "sol");
  const lastVera  = [...history].reverse().find((m) => m.agentId === "vera");

  // ── Closure turns — one final shot each for Sol and Vera ─────────────────
  if (closureRequested) {
    if (agent.id === "sol") {
      return `YOUR TURN — FINAL SYNTHESIS (Quinn has closed the session)
Synthesize what has been established this session. State clearly:
1. Which approach is strongest and why it survived Vera's scrutiny.
2. What the key remaining open question is for the next session.
3. What evidence Eva should prioritize finding next time.
Be concrete and brief — this is the final message of the session.`;
    }
    if (agent.id === "vera") {
      const canResolve = sessionNumber >= MIN_SESSIONS_TO_RESOLVE;
      return `YOUR TURN — FINAL EVALUATION (Quinn has closed the session)
Evaluate Sol's final synthesis. State: (1) what holds from this session, (2) what the single most important unresolved question is, (3) what the next session must not skip.
${canResolve
  ? "If the full research question is genuinely answered across all sessions — declare RESEARCH_RESOLVED: [summary]. Otherwise, do not."
  : `Do NOT declare RESEARCH_RESOLVED. Session ${sessionNumber} of ${MIN_SESSIONS_TO_RESOLVE} required.`}`;
    }
  }

  switch (agent.id) {
    case "quinn": {
      if (isFirstCycle) {
        if (sessionNumber === 1) {
          return `YOUR TURN — FRAME THE QUESTION
This is the first research session. Define the exact research question:
1. Objective: what would constitute a complete answer?
2. Constraints: what is in and out of scope?
3. Assumptions: what are we taking as given?
4. Success criteria: how will we know if we've succeeded?
5. Sub-questions: what smaller questions must be answered first?`;
        }
        return `YOUR TURN — REOPEN THE SESSION
This is session ${sessionNumber}. You have the continuity block above. Do NOT re-introduce the problem from scratch.
State: (1) where we left off, (2) which sub-questions remain open, (3) what this session must accomplish.
Be specific about what changed or was learned last session.`;
      }
      // Build a last-cycle summary to force Quinn to address what actually happened
      const lastCycleSummary = (lastQuinn && lastEva && lastSol && lastVera)
        ? `\nLast cycle summary:\n  Quinn: "${lastQuinn.content.slice(0, 80).replace(/\n/g, " ")}…"\n  Eva: "${lastEva.content.slice(0, 80).replace(/\n/g, " ")}…"\n  Sol: "${lastSol.content.slice(0, 80).replace(/\n/g, " ")}…"\n  Vera: "${lastVera.content.slice(0, 80).replace(/\n/g, " ")}…"\nAddress what actually changed this cycle — do not repeat prior framing verbatim.`
        : "";
      return `YOUR TURN — REVIEW FRAMING${lastCycleSummary}
Does the framing need updating based on what just happened? If the group is drifting, redirect. If Vera's critique revealed the question was malformed, restate it correctly. If this cycle fully addressed the current sub-question, advance to the next one or close the session with SESSION_CLOSURE:.`;
    }

    case "eva": {
      // Eva's instruction anchors her to Quinn's framing + her own prior gap
      const quinnAnchor = lastQuinn
        ? `Quinn's current framing: "${lastQuinn.content.slice(0, 200).replace(/\n/g, " ")}…"`
        : "";
      const priorGapNote = lastEva
        ? `\nYour prior turn identified gaps — your search this turn was targeted at those gaps. Report what the new results say about them specifically. Do not re-cite sources from your previous turn.`
        : "";
      return `YOUR TURN — REPORT EVIDENCE
The LIVE SEARCH RESULTS above were retrieved moments ago, targeted at the current research gap.
${quinnAnchor}${priorGapNote}
Extract the most relevant findings. Cite sources by title or URL. Note contradictions. Flag what is still missing.
${sessionNumber > 1 ? "Cross-reference against what was established in previous sessions — flag any contradictions with prior conclusions." : ""}`;
    }

    case "sol": {
      // Force Sol to directly respond to Vera's last critique
      const veraCritiqueNote = lastVera
        ? `\nVera's last critique was: "${lastVera.content.slice(0, 200).replace(/\n/g, " ")}…"\nYour proposals this turn must directly address this critique. Do NOT re-propose approaches Vera has already eliminated. If an approach was eliminated, build a genuinely modified version or replace it entirely.`
        : "";
      return `YOUR TURN — PROPOSE SOLUTIONS
Build on Quinn's framing and Eva's evidence. Propose at least 2–3 meaningfully distinct approaches — label them Approach A, Approach B, Approach C. Write actual math, algorithms, or pseudocode where required — not descriptions of them.${veraCritiqueNote}
${sessionNumber > 1 ? "Do not re-propose approaches already eliminated in prior sessions. Build forward from what survived." : ""}`;
    }

    case "vera": {
      const canResolve = sessionNumber >= MIN_SESSIONS_TO_RESOLVE;
      // Force Vera to evaluate Sol's actual current output, not prior cycles
      const solAnchorNote = lastSol
        ? `\nSol just said: "${lastSol.content.slice(0, 200).replace(/\n/g, " ")}…"\nEvaluate specifically what Sol said THIS turn. Do NOT re-evaluate proposals from previous turns that Sol did not revisit.`
        : "Review all hypotheses so far.";

      const resolutionBlock = canResolve
        ? `\nIf and ONLY if Quinn's question is fully answered, Sol's best approach has survived at least 2 full rounds of scrutiny across multiple sessions, and all sub-questions are addressed with evidence — declare RESEARCH_RESOLVED: [one-paragraph summary].
Do NOT declare RESEARCH_RESOLVED unless all three conditions hold. Premature resolution is worse than none.`
        : `\nDo NOT declare RESEARCH_RESOLVED. Session ${sessionNumber} of ${MIN_SESSIONS_TO_RESOLVE} required minimum. ${MIN_SESSIONS_TO_RESOLVE - sessionNumber} more session(s) needed. Your job is to identify what is STILL MISSING.`;

      return `YOUR TURN — ATTACK AND VERIFY
${solAnchorNote}
When something genuinely survives scrutiny, say "This holds." explicitly.
${resolutionBlock}`;
    }

    default:
      return "YOUR TURN — Stay in character. 3–6 sentences.";
  }
}

// ── Tavily search — targeted at Quinn's framing + Eva's last gap ───────────

async function runEvaSearch(topic: string, history: Message[]): Promise<string> {
  const lastQuinn = [...history].reverse().find((m) => m.agentId === "quinn");
  const lastEva   = [...history].reverse().find((m) => m.agentId === "eva");

  // Base query: Quinn's latest framing (most specific description of what we need)
  const quinnBase = lastQuinn
    ? lastQuinn.content.replace(/\n+/g, " ").trim().slice(0, 200)
    : topic;

  // Gap hint: extract what Eva said she still needs to find
  let gapHint = "";
  if (lastEva) {
    const gapMatch = lastEva.content.match(
      /(?:gap|missing|still (?:unknown|unclear|needed)|need(?:s?) (?:to )?(?:find|search|investigate|determine)|not (?:addressed|found|available|established)|lack(?:ing)?|no (?:data|evidence|research|studies))[^.!?\n]{0,120}[.!?]/i
    );
    if (gapMatch) gapHint = " " + gapMatch[0].slice(0, 120);
  }

  const query = (quinnBase + gapHint).slice(0, 300);

  const results = await searchWeb(query);
  console.log(`[AGORA] Tavily search for Eva: "${query.slice(0, 80)}" → ${results.length} results`);

  if (results.length === 0) {
    return `\nLIVE SEARCH — No results returned for query: "${query.slice(0, 80)}"\nDraw on your training knowledge but flag ALL claims as unverified. Do not present anything as established fact.\n`;
  }

  const lines = results.map((r, i) =>
    `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.content.slice(0, 300).replace(/\n/g, " ")}`
  );

  return `\nLIVE SEARCH RESULTS (just retrieved — ${results.length} sources, relevance-ranked):\n\n${lines.join("\n\n")}\n`;
}

// ── Context builder ────────────────────────────────────────────────────────

async function buildContext(
  agent: Agent,
  topic: string,
  activeProblem: ActiveProblem | null,
  sessionNumber: number,
  history: Message[],
  sessionStartResponses: HumanMessage[],
  midSessionResponses: HumanMessage[],
  pendingRequests: HumanMessage[],
  elapsedSeconds: number,
  remainingSeconds: number,
  now: Date,
  turnIndex: number,
  closureRequested: boolean,
): Promise<string> {
  const timeStr = format(now, "h:mm a");
  const dateStr = format(now, "EEEE, MMMM d");
  const tone    = toneHint(now.getHours());

  // ── Per-agent memory ──────────────────────────────────────────────────────
  const memory      = await getAgentMemory(agent.id);
  const memoryBlock = formatMemoryForContext(memory);

  // ── Continuity / problem context ──────────────────────────────────────────
  let problemBlock: string;

  if (activeProblem) {
    const startDate   = parseISO(activeProblem.startedDate);
    const daysElapsed = differenceInDays(now, startDate);
    const daysStr     = daysElapsed === 0 ? "today"
                      : daysElapsed === 1 ? "1 day ago"
                      : `${daysElapsed} days ago`;

    const allMemories = await getAllAgentMemories();
    const crossMemoryLines = allMemories
      .filter((m) => m.keyInsights.length > 0)
      .map((m) => {
        const a = AGENTS.find((ag) => ag.id === m.agentId);
        return `  ${a?.name ?? m.agentId}: ${m.keyInsights[m.keyInsights.length - 1]}`;
      });
    const crossMemoryBlock = crossMemoryLines.length > 0
      ? `\nTeam knowledge from previous sessions:\n${crossMemoryLines.join("\n")}`
      : "";

    problemBlock =
`=== CONTINUING FROM PREVIOUS SESSION ===
Research started: ${activeProblem.startedDate} (${daysStr})
This is session ${sessionNumber} on this problem.
Problem: ${activeProblem.problem}

Last session summary:
${activeProblem.progress}
${crossMemoryBlock}

Pick up EXACTLY where we left off. Do NOT re-introduce the problem. Do NOT restart from scratch.
=== END CONTINUITY CONTEXT ===`;
  } else {
    problemBlock = `NEW RESEARCH SESSION
Topic: ${topic}`;
  }

  // ── Tavily search for Eva only ────────────────────────────────────────────
  let searchBlock = "";
  if (agent.id === "eva") {
    searchBlock = await runEvaSearch(topic, history);
  }

  // ── Human responses at session start ─────────────────────────────────────
  let humanBlock = "";
  if (sessionStartResponses.length > 0) {
    const lines = sessionStartResponses.map(
      (r) => `  • ${r.agent_name} asked: "${r.request}"\n    → Human answered: "${r.response}"`
    );
    humanBlock = `\nHUMAN RESPONSES RECEIVED BEFORE THIS SESSION:\n${lines.join("\n")}\n`;
  }

  // ── Mid-session human responses ───────────────────────────────────────────
  let midSessionBlock = "";
  if (midSessionResponses.length > 0) {
    const lines = midSessionResponses.map(
      (r) => `  • ${r.agent_name} asked: "${r.request}"\n    ⚡ Human just answered: "${r.response}"`
    );
    midSessionBlock = `\n⚡ HUMAN RESPONDED MID-SESSION:\n${lines.join("\n")}\nRecall why you asked this — check your memory above for the context behind this request. Incorporate the human's answer directly into the research direction. Do not just acknowledge the response; act on it substantively.\n`;
  }

  // ── Pending requests ──────────────────────────────────────────────────────
  let pendingBlock = "";
  if (pendingRequests.length > 0) {
    const lines = pendingRequests.map(
      (r) => `  • ${r.agent_name} [${r.request_type ?? "CLARIFICATION"}]: "${r.request}" — awaiting human`
    );
    pendingBlock = `\nPENDING HUMAN REQUESTS (do not re-ask these):\n${lines.join("\n")}\n`;
  }

  // ── Conversation history ──────────────────────────────────────────────────
  const historyBlock =
    history.length === 0
      ? "(Session just started. You speak first.)"
      : history
          .map(
            (m) =>
              `[${m.agentName} · ${m.agentRole} · ${formatDuration(m.elapsedSeconds)}]\n${m.content}`
          )
          .join("\n\n");

  // ── Turn instruction ──────────────────────────────────────────────────────
  const turnInstruction = buildTurnInstruction(
    agent, history, turnIndex, sessionNumber, closureRequested
  );

  // ── Assemble ──────────────────────────────────────────────────────────────
  return `=== AGORA RESEARCH — ${formatDuration(elapsedSeconds)} elapsed · ${formatDuration(remainingSeconds)} remaining / 10m ===
${dateStr} · ${timeStr}
${tone}

${memoryBlock ? memoryBlock + "\n\n" : ""}${problemBlock}
${searchBlock}${humanBlock}${midSessionBlock}${pendingBlock}
=== CONVERSATION SO FAR ===
${historyBlock}

=== ${turnInstruction} ===`.trim();
}

// ── Per-agent reply ────────────────────────────────────────────────────────

async function getReply(agent: Agent, ctx: string): Promise<string> {
  if (agent.provider === "anthropic") {
    const response = await anthropic.messages.create({
      model:      agent.model,
      max_tokens: 700,
      system:     agent.systemPrompt,
      messages:   [{ role: "user", content: ctx }],
    });
    return (response.content[0] as { text: string }).text.trim();
  } else {
    const response = await openai.chat.completions.create({
      model:      agent.model,
      max_tokens: 700,
      messages: [
        { role: "system", content: agent.systemPrompt },
        { role: "user",   content: ctx },
      ],
    });
    return (response.choices[0].message.content ?? "").trim();
  }
}

// ── Main session runner ────────────────────────────────────────────────────

export async function runConversation(): Promise<void> {
  const sessionStart = Date.now();
  const now          = new Date(sessionStart);
  const date         = format(now, "yyyy-MM-dd");

  const activeProblem = await getActiveProblem();
  const topic         = activeProblem?.problem ?? getResearchSeed();
  const sessionNumber = (activeProblem?.sessions ?? 0) + 1;

  if (activeProblem) {
    console.log(
      `[AGORA] Continuing research on: "${activeProblem.problem.slice(0, 80)}" — ` +
      `Session ${sessionNumber} — started ${activeProblem.startedDate}`
    );
  } else {
    console.log(`[AGORA] Starting new problem: "${topic.slice(0, 80)}"`);
  }

  const lookback              = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const sessionStartResponses = await getRecentResponses(lookback);

  const [{ id: conversationId }] = await sql`
    INSERT INTO conversations (date, session_type, session_number, topic, started_at, messages)
    VALUES (${date}, ${1}, ${sessionNumber}, ${topic}, ${now.toISOString()}, ${'[]'})
    RETURNING id
  `;

  emitSessionStart({
    conversationId,
    topic,
    startedAt:       now.toISOString(),
    durationSeconds: SESSION_DURATION,
  });

  const messages:           Message[]      = [];
  let   researchResolved                   = false;
  let   turn                               = 0;
  let   lastHumanPollMs                    = Date.now();
  let   midSessionResponses: HumanMessage[] = [];
  const seenResponseIds = new Set(sessionStartResponses.map((r) => r.id));

  // ── Session closure state ─────────────────────────────────────────────────
  let closureRequested = false;
  let closureSolDone   = false;
  let closureVeraDone  = false;

  const saveMessages = async () => {
    await sql`UPDATE conversations SET messages = ${JSON.stringify(messages)} WHERE id = ${conversationId}`;
  };

  // ── Conversation loop ─────────────────────────────────────────────────────

  while (true) {
    const elapsed   = Math.floor((Date.now() - sessionStart) / 1000);
    const remaining = SESSION_DURATION - elapsed;

    if (remaining < 10 || researchResolved) break;

    // ── Mid-session human poll ─────────────────────────────────────────────
    if (Date.now() - lastHumanPollMs >= HUMAN_POLL_INTERVAL_MS) {
      const since      = new Date(lastHumanPollMs).toISOString();
      const freshBatch = await getRecentResponses(since);
      const newOnes    = freshBatch.filter((r) => !seenResponseIds.has(r.id));
      if (newOnes.length > 0) {
        midSessionResponses = newOnes;
        newOnes.forEach((r) => seenResponseIds.add(r.id));
        console.log(`[AGORA] ${newOnes.length} mid-session human response(s) received`);
      }
      lastHumanPollMs = Date.now();
    }

    const agentId = RESEARCH_ORDER[turn % RESEARCH_ORDER.length];
    const agent   = AGENTS.find((a) => a.id === agentId)!;

    // ── Closure routing ───────────────────────────────────────────────────
    if (closureRequested) {
      if (!closureSolDone) {
        if (agentId !== "sol") { turn++; continue; }
      } else if (!closureVeraDone) {
        if (agentId !== "vera") { turn++; continue; }
      } else {
        break; // both closure turns complete
      }
    }

    const turnNow        = new Date();
    const pendingRequests = await getUnansweredHumanMessages();

    const ctx = await buildContext(
      agent, topic, activeProblem, sessionNumber, messages,
      sessionStartResponses, midSessionResponses, pendingRequests,
      Math.floor((Date.now() - sessionStart) / 1000),
      Math.max(0, SESSION_DURATION - Math.floor((Date.now() - sessionStart) / 1000)),
      turnNow,
      turn,
      closureRequested,
    );

    midSessionResponses = [];

    let rawContent: string;
    try {
      rawContent = await getReply(agent, ctx);
    } catch (err) {
      console.error(`[AGORA] ${agent.name} failed:`, err);
      turn++;
      continue;
    }

    const { cleaned, requests } = parseHumanRequests(rawContent);

    for (const req of requests) {
      await insertHumanMessage({
        conversation_id: conversationId,
        date,
        agent_id:        agentId,
        agent_name:      agent.name,
        request:         req.text,
        request_type:    req.requestType,
        created_at:      new Date().toISOString(),
      });
      console.log(`[AGORA] ${agent.name} [${req.requestType}]: "${req.text.slice(0, 80)}"`);
    }

    // ── SESSION_CLOSURE check (Quinn only) ────────────────────────────────
    if (agentId === "quinn" && !closureRequested && parseClosure(cleaned)) {
      closureRequested = true;
      console.log(`[AGORA] Quinn declared SESSION_CLOSURE — running final Sol + Vera turns`);
    }

    // ── Mark closure turns complete ───────────────────────────────────────
    if (closureRequested) {
      if (agentId === "sol")  closureSolDone  = true;
      if (agentId === "vera") closureVeraDone = true;
    }

    // ── RESEARCH_RESOLVED check (Vera only, session >= 3) ─────────────────
    if (agentId === "vera") {
      const resolution = parseResolution(cleaned);
      if (resolution) {
        if (sessionNumber >= MIN_SESSIONS_TO_RESOLVE) {
          researchResolved = true;
          console.log(`[AGORA] RESEARCH_RESOLVED by Vera at session ${sessionNumber}`);
        } else {
          console.log(
            `[AGORA] Vera attempted RESEARCH_RESOLVED in session ${sessionNumber} — ` +
            `blocked (minimum ${MIN_SESSIONS_TO_RESOLVE} required)`
          );
        }
      }
    }

    // ── Record message ────────────────────────────────────────────────────
    const elapsedAfter   = Math.floor((Date.now() - sessionStart) / 1000);
    const remainingAfter = Math.max(0, SESSION_DURATION - elapsedAfter);

    const msg: Message = {
      agentId,
      agentName:        agent.name,
      agentRole:        agent.role,
      content:          cleaned,
      timestamp:        turnNow.toISOString(),
      elapsedSeconds:   elapsedAfter,
      remainingSeconds: remainingAfter,
    };

    messages.push(msg);
    await saveMessages();

    emitMessage({
      conversationId,
      agentId,
      agentName:        agent.name,
      content:          cleaned,
      timestamp:        msg.timestamp,
      elapsedSeconds:   elapsedAfter,
      remainingSeconds: remainingAfter,
    });

    console.log(
      `[AGORA] [${formatDuration(elapsedAfter)}] ${agent.name} (${agent.role}): ` +
      `${cleaned.slice(0, 80).replace(/\n/g, " ")}…`
    );

    turn++;
    if (remainingAfter < 10) break;
    await new Promise((r) => setTimeout(r, TURN_GAP_MS));
  }

  // ── Post-session ──────────────────────────────────────────────────────────

  const endedAt = new Date().toISOString();

  if (researchResolved) {
    await sql`UPDATE conversations SET session_status = 'ACHIEVEMENT', ended_at = ${endedAt} WHERE id = ${conversationId}`;
    await clearActiveProblem();
    console.log(`[AGORA] Research complete — ACHIEVEMENT (session ${sessionNumber})`);
  } else {
    const quinnsLast = [...messages].reverse().find((m) => m.agentId === "quinn");
    const progress   =
      quinnsLast?.content ??
      "Session ended before Quinn could update the framing.";

    const updated: ActiveProblem = {
      problem:     activeProblem?.problem ?? topic,
      startedDate: activeProblem?.startedDate ?? date,
      sessions:    (activeProblem?.sessions ?? 0) + 1,
      progress,
    };
    await setActiveProblem(updated);

    await sql`UPDATE conversations SET ended_at = ${endedAt} WHERE id = ${conversationId} AND session_status IS NULL`;

    console.log(`[AGORA] Session ${sessionNumber} ended — problem continues`);
  }

  emitSessionEnd({ conversationId, endedAt });

  updateAllAgentMemories(messages, topic).catch((err) =>
    console.error("[AGORA] Memory update failed:", err)
  );

  console.log(
    `[AGORA] Session ${sessionNumber} complete — ${messages.length} messages — ` +
    `${researchResolved ? "RESOLVED" : closureRequested ? "CLOSURE" : "ONGOING"}`
  );
}
