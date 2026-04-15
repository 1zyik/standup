import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export async function POST(req: NextRequest) {
  const { filename, dataUrl } = await req.json();

  // Strip data URL prefix
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");

  const dir = join(process.cwd(), "docs", "screenshots");
  mkdirSync(dir, { recursive: true });

  const filePath = join(dir, filename);
  writeFileSync(filePath, buffer);

  return NextResponse.json({ ok: true, path: filePath });
}
