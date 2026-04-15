import { NextRequest, NextResponse } from "next/server";
import { fetchGitLabData } from "@/lib/gitlab";

export async function POST(req: NextRequest) {
  try {
    const { token, days, baseUrl, dateFrom } = await req.json();
    if (!token) return NextResponse.json({ error: "GitLab token is required" }, { status: 400 });
    const data = await fetchGitLabData(token, days ?? 14, baseUrl || "https://gitlab.com", dateFrom);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
