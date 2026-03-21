import { NextRequest, NextResponse } from "next/server";
import { getAllHumanMessages, answerHumanMessage, sql } from "@/lib/db";
import { scheduleFollowUp } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

// GET — returns all human messages enriched with `reaction` (the agent's
// first response after the human answered, if any).

export async function GET() {
  const messages = await getAllHumanMessages();

  // Cache conversation message arrays by id to avoid repeat JSON parses
  const convCache = new Map<number, Array<{ agentId: string; content: string; timestamp: string }>>();

  async function getConvMessages(conversationId: number) {
    if (convCache.has(conversationId)) return convCache.get(conversationId)!;
    const rows = await sql`SELECT messages FROM conversations WHERE id = ${conversationId}`;
    if (!rows[0]) { convCache.set(conversationId, []); return []; }
    try {
      const parsed = JSON.parse((rows[0] as { messages: string }).messages);
      convCache.set(conversationId, parsed);
      return parsed as Array<{ agentId: string; content: string; timestamp: string }>;
    } catch {
      convCache.set(conversationId, []);
      return [];
    }
  }

  const enriched = await Promise.all(
    messages.map(async (m) => {
      if (!m.responded_at) return { ...m, reaction: null };
      const convMsgs = await getConvMessages(m.conversation_id);
      const reaction = convMsgs.find(
        (msg) => msg.agentId === m.agent_id && msg.timestamp > m.responded_at!
      );
      return { ...m, reaction: reaction?.content ?? null };
    })
  );

  return NextResponse.json(enriched);
}

// POST — submit a human response to a pending request.
// Body: { id: number, response: string }

export async function POST(req: NextRequest) {
  let body: { id?: number; response?: string };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { id, response } = body;

  if (typeof id !== "number" || typeof response !== "string" || !response.trim()) {
    return NextResponse.json(
      { ok: false, error: "Required: id (number) and response (non-empty string)" },
      { status: 400 }
    );
  }

  const respondedAt = new Date().toISOString();
  await answerHumanMessage(id, response.trim(), respondedAt);

  scheduleFollowUp();

  return NextResponse.json({ ok: true, id, respondedAt });
}
