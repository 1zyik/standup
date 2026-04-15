import { NextRequest, NextResponse } from "next/server";
import { fetchTeamsData } from "@/lib/teams";

export async function POST(req: NextRequest) {
  try {
    const { token, days, dateFrom } = await req.json();
    if (!token) return NextResponse.json({ error: "MS Teams access token is required" }, { status: 400 });
    const data = await fetchTeamsData(token, days ?? 14, dateFrom);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
