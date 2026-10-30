import { promises as fs } from "fs";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { emit } from "@/lib/events";
import { jsonError, loadProject, type Ctx } from "@/lib/http";
import { BusyError, startAssetRegen } from "@/lib/agents/pipeline";
import { patchAsset, projectDir, safeJoin, writeProjectFile } from "@/lib/store";

export const dynamic = "force-dynamic";

type P = Ctx<{ id: string; assetId: string }>;

function revFileFor(a: { id: string; file?: string; rev: number }, rev: number) {
  if (!a.file) return null;
  const m = /^(assets\/.+)\.r(\d+)\.([^.]+)$/.exec(a.file);
  if (!m) return null;
  if (rev < 1 || rev > Math.max(a.rev || 1, Number(m[2]))) return null;
  return `${m[1]}.r${rev}.${m[3]}`;
}

/** { action: "regenerate", prompt? } | { action: "like", value: -1|0|1 } | { action: "useRev", rev: number } */
export async function POST(req: Request, { params }: P) {
  const { id, assetId } = await params;
  const p = await loadProject(id);
  const a = p?.assets[assetId];
  if (!p || !a) return jsonError("Recurso no encontrado", 404);
  const body = (await req.json().catch(() => ({}))) as { action?: string; prompt?: string; value?: number; rev?: number };
  if (body.action === "like") {
    const v = body.value === 1 ? 1 : body.value === -1 ? -1 : 0;
    const out = await patchAsset(id, assetId, { liked: v });
    return NextResponse.json(out);
  }
  if (body.action === "useRev") {
    const rev = Number(body.rev);
    if (!Number.isInteger(rev) || rev < 1) return jsonError("Revisión inválida");
    const rel = revFileFor(a, rev);
    if (!rel) return jsonError("No hay archivo para esa revisión");
    try {
      await fs.access(safeJoin(projectDir(id), rel));
    } catch {
      return jsonError("Esa revisión ya no está en disco", 404);
    }
    if (a.file === rel) return NextResponse.json(a);
    const out = await patchAsset(id, assetId, { file: rel, status: "ready", error: undefined });
    // Client hot-swaps image/audio in the running game; models trigger a reload from the studio.
    emit(id, {
      type: "job",
      job: {
        kind: "asset",
        stages: [{ id: "assets", label: a.name, status: "ok", detail: `r${rev} activa` }],
        startedAt: Date.now(),
        finishedAt: Date.now(),
        reload: a.type === "model",
      },
    });
    return NextResponse.json(out);
  }
  if (body.action === "regenerate") {
    try {
      startAssetRegen(id, assetId, body.prompt ? String(body.prompt).slice(0, 800) : undefined);
    } catch (e) {
      if (e instanceof BusyError) return jsonError(e.message, 409);
      throw e;
    }
    return NextResponse.json({ ok: true }, { status: 202 });
  }
  return jsonError("Acción desconocida");
}

/** Multipart upload that replaces the asset with the user's own file. */
export async function PUT(req: Request, { params }: P) {
  const { id, assetId } = await params;
  const p = await loadProject(id);
  const a = p?.assets[assetId];
  if (!p || !a) return jsonError("Recurso no encontrado", 404);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError("Falta el archivo");
  if (file.size > 25 * 1024 * 1024) return jsonError("El archivo pesa más de 25 MB");
  const buf = Buffer.from(await file.arrayBuffer());
  let data = buf;
  let ext: string;
  let mime: string;
  if (a.type === "image") {
    if (!file.type.startsWith("image/")) return jsonError("Sube una imagen PNG, JPG, WebP o GIF");
    try {
      data = await sharp(buf).resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    } catch {
      return jsonError("No pude leer esa imagen");
    }
    ext = "png";
    mime = "image/png";
  } else if (a.type === "audio") {
    const m = /\.(mp3|wav|ogg|m4a)$/i.exec(file.name);
    if (!file.type.startsWith("audio/") && !m) return jsonError("Sube un audio MP3, WAV u OGG");
    ext = (m?.[1] || "mp3").toLowerCase();
    mime = file.type || "audio/mpeg";
  } else {
    if (!/\.glb$/i.test(file.name)) return jsonError("Sube un modelo .glb");
    ext = "glb";
    mime = "model/gltf-binary";
  }
  const rev = (a.rev || 0) + 1;
  const rel = `assets/${a.id}.r${rev}.${ext}`;
  await writeProjectFile(id, rel, data);
  const out = await patchAsset(id, assetId, { status: "ready", file: rel, mime, rev, custom: true, provider: "Tú", error: undefined, name: a.name });
  emit(id, { type: "job", job: { kind: "asset", stages: [{ id: "assets", label: a.name, status: "ok", detail: "Subido" }], startedAt: Date.now(), finishedAt: Date.now(), reload: true } });
  return NextResponse.json(out);
}
