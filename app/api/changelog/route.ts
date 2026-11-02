import { NextResponse } from "next/server";
import log from "@/lib/changelog.generated.json";

export const dynamic = "force-static";

/** Written by scripts/write-changelog.mjs during `npm run build`, so each deploy carries its own commits. */
export function GET() {
  return NextResponse.json(log);
}
