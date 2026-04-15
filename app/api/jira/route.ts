import { NextRequest, NextResponse } from "next/server";
import { fetchJiraData } from "@/lib/jira";

export async function POST(req: NextRequest) {
  try {
    const { baseUrl, email, token, days, dateFrom } = await req.json();
    if (!baseUrl || !email || !token)
      return NextResponse.json({ error: "Jira base URL, email, and token are required" }, { status: 400 });
    const data = await fetchJiraData(baseUrl, email, token, days ?? 14, dateFrom);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
