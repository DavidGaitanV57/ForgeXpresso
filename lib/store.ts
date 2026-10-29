import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { emit } from "./events";
import type { AssetRecord, Dimension, ImageProvider, Project } from "./types";

const ID_RE = /^[a-z0-9-]{8,64}$/;

export function projectDir(id: string) {
  if (!ID_RE.test(id)) throw new Error("Invalid project id");
  return path.join(config.dataDir(), id);
}

const locks = new Map<string, Promise<unknown>>();
function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(id, next.catch(() => {}));
  return next;
}

async function writeJsonAtomic(file: string, data: unknown) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

export async function createProject(idea: string, dimension: Dimension, imageProvider: ImageProvider): Promise<Project> {
  const id = randomUUID();
  const dir = projectDir(id);
  await fs.mkdir(path.join(dir, "assets"), { recursive: true });
  await fs.mkdir(path.join(dir, "versions"), { recursive: true });
  const now = Date.now();
  const p: Project = {
    id,
    createdAt: now,
    updatedAt: now,
    idea,
    dimension,
    imageProvider,
    status: "generating",
    assets: {},
    versions: [],
    currentVersion: 0,
    chat: [],
    repairs: 0,
  };
  await writeJsonAtomic(path.join(dir, "project.json"), p);
  return p;
}

export async function getProject(id: string): Promise<Project | null> {
  try {
    const raw = await fs.readFile(path.join(projectDir(id), "project.json"), "utf8");
    return JSON.parse(raw) as Project;
  } catch {
    return null;
  }
}

export async function updateProject(id: string, fn: (p: Project) => void | Promise<void>): Promise<Project> {
  return withLock(id, async () => {
    const p = await getProject(id);
    if (!p) throw new Error("Project not found");
    await fn(p);
    p.updatedAt = Date.now();
    await writeJsonAtomic(path.join(projectDir(id), "project.json"), p);
    return p;
  });
}

export async function setAsset(id: string, asset: AssetRecord) {
  asset.updatedAt = Date.now();
  await updateProject(id, (p) => {
    p.assets[asset.id] = asset;
  });
  emit(id, { type: "asset", asset });
}

export async function patchAsset(id: string, assetId: string, patch: Partial<AssetRecord>) {
  let out: AssetRecord | undefined;
  await updateProject(id, (p) => {
    const a = p.assets[assetId];
    if (!a) return;
    Object.assign(a, patch, { updatedAt: Date.now() });
    out = a;
  });
  if (out) emit(id, { type: "asset", asset: out });
  return out;
}

export async function listProjects(): Promise<Project[]> {
  const root = config.dataDir();
  let names: string[] = [];
  try {
    names = await fs.readdir(root);
  } catch {
    return [];
  }
  const out: Project[] = [];
  for (const n of names) {
    if (!ID_RE.test(n)) continue;
    const p = await getProject(n);
    if (p) out.push(p);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string) {
  await fs.rm(projectDir(id), { recursive: true, force: true });
}

export async function writeProjectFile(id: string, rel: string, data: Buffer | string) {
  const file = safeJoin(projectDir(id), rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
  return rel;
}

export async function readProjectFile(id: string, rel: string) {
  return fs.readFile(safeJoin(projectDir(id), rel));
}

export function safeJoin(base: string, rel: string) {
  const full = path.resolve(base, rel);
  if (!full.startsWith(path.resolve(base) + path.sep)) throw new Error("Invalid path");
  return full;
}

export async function saveVersion(id: string, code: string, note: string) {
  let n = 0;
  await updateProject(id, async (p) => {
    n = (p.versions.at(-1)?.n ?? 0) + 1;
    const file = `versions/v${n}/game.js`;
    await writeProjectFile(id, file, code);
    p.versions.push({ n, createdAt: Date.now(), note, file });
    p.currentVersion = n;
  });
  emit(id, { type: "version", n });
  return n;
}

export async function readCurrentCode(p: Project): Promise<string | null> {
  const v = p.versions.find((x) => x.n === p.currentVersion);
  if (!v) return null;
  return (await readProjectFile(p.id, v.file)).toString("utf8");
}
