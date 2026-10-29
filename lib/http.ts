import { NextResponse } from "next/server";
import { getProject } from "./store";

export const jsonError = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function loadProject(id: string) {
  try {
    return await getProject(id);
  } catch {
    return null;
  }
}

export type Ctx<P extends Record<string, string | string[]> = { id: string }> = { params: Promise<P> };
