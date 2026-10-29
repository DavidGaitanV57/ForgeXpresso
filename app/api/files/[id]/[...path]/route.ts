import { jsonError, type Ctx } from "@/lib/http";
import { readProjectFile } from "@/lib/store";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  glb: "model/gltf-binary",
  js: "text/javascript; charset=utf-8",
  json: "application/json",
};

export async function GET(_req: Request, { params }: Ctx<{ id: string; path: string[] }>) {
  const { id, path } = await params;
  const rel = path.join("/");
  if (!/^(assets|versions)\//.test(rel)) return jsonError("No encontrado", 404);
  try {
    const data = await readProjectFile(id, rel);
    const ext = rel.split(".").pop()!.toLowerCase();
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": TYPES[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  } catch {
    return jsonError("No encontrado", 404);
  }
}
