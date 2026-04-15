import { NextRequest, NextResponse } from "next/server";
import { fetchSlackData } from "@/lib/slack";

export async function POST(req: NextRequest) {
  try {
    const { token, days, dateFrom, dateTo } = await req.json();
    if (!token) {
      return NextResponse.json({ error: "Slack token is required" }, { status: 400 });
    }
    const data = await fetchSlackData(token, days ?? 14, dateFrom, dateTo);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
