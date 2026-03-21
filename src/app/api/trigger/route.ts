import { NextResponse } from "next/server";
import { runConversation } from "@/lib/conversation";
import { manualRunsRemaining, incrementManualRuns, MANUAL_RUN_LIMIT } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET — returns remaining manual runs for today.
export async function GET() {
  const remaining = await manualRunsRemaining();
  return NextResponse.json({ remaining, limit: MANUAL_RUN_LIMIT });
}

// POST — fires a research session immediately (if under daily limit).
export async function POST() {
  const remaining = await manualRunsRemaining();

  if (remaining <= 0) {
    return NextResponse.json(
      { ok: false, reason: "limit_reached", message: "No manual runs remaining today" },
      { status: 429 }
    );
  }

  await incrementManualRuns();

  runConversation().catch((err) => {
    console.error("[AGORA] Manual trigger failed:", err);
  });

  return NextResponse.json({
    ok: true,
    message: "Research session started",
    remaining: await manualRunsRemaining(),
  });
}
