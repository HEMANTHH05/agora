import { NextRequest, NextResponse } from "next/server";
import { sql, dbReady } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await dbReady;
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");

  if (date) {
    const rows = await sql`
      SELECT id, date, topic, session_type, session_status, session_number, started_at, ended_at, messages
      FROM conversations
      WHERE date = ${date}
      ORDER BY started_at ASC
    `;
    return NextResponse.json(
      rows.map((r: any) => ({ ...r, messages: JSON.parse(r.messages) }))
    );
  }

  const dates = await sql`
    SELECT date, COUNT(*) as count
    FROM conversations
    GROUP BY date
    ORDER BY date DESC
  `;

  return NextResponse.json(dates);
}
