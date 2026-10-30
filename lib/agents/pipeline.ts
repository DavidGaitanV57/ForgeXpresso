import { config } from "../config";
import { emit } from "../events";
import type { AnthropicUsage } from "../providers/anthropic";
import { pool } from "../providers/http";
import { runCinematicDirector } from "./cinematic";
import { getProject, readCurrentCode, saveVersion, updateProject } from "../store";
import type { ApiProvider, AssetRecord, AudioAssetSpec, ChatMsg, GameDesign, Job, JobStage, Project, StageStatus, UsageEvent, UsageReport } from "../types";
import { addUsageEvent, emptyUsage, finishUsage } from "../usage";
import { generateAsset, newRecord, recordsFromDesign } from "./assets";
import { planChange } from "./chat";
import { codeAgent } from "./code";
import { runDirector } from "./director";
import { sanitizeVoicePrompt, voicePromptFromLines } from "./voice-prompt";

const g = globalThis as unknown as { __forgeRunning?: Set<string> };
const running = g.__forgeRunning ?? (g.__forgeRunning = new Set<string>());

export function isBusy(id: string) {
  return running.has(id);
}

class JobCtl {
  usage: UsageReport;
  constructor(
    private projectId: string,
    public job: Job,
  ) {
    this.usage = emptyUsage(job.startedAt);
  }
  async stage(id: string, status: StageStatus, detail?: string) {
    const s = this.job.stages.find((x) => x.id === id);
    if (!s) return;
    s.status = status;
    if (detail !== undefined) s.detail = detail;
    await this.flush();
  }
  async flush() {
    const job = this.job;
    const usage = this.usage;
    await updateProject(this.projectId, (p) => {
      p.job = job;
      p.jobUsage = usage;
    });
    emit(this.projectId, { type: "job", job });
    emit(this.projectId, { type: "usage", usage, cumulative: (await getProject(this.projectId))?.usage ?? usage });
  }
  async track(ev: Omit<UsageEvent, "at">) {
    this.usage = addUsageEvent(this.usage, ev);
    await updateProject(this.projectId, (p) => {
      p.jobUsage = this.usage;
      p.usage = addUsageEvent(p.usage ?? emptyUsage(this.job.startedAt), ev);
    });
    const p = await getProject(this.projectId);
    emit(this.projectId, { type: "usage", usage: this.usage, cumulative: p?.usage ?? this.usage });
  }
  trackAnthropic(u: AnthropicUsage, label: string) {
    return this.track({
      provider: "anthropic",
      label,
      calls: 1,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      estimatedUsd: u.estimatedUsd,
      ms: u.ms,
      model: u.model,
    });
  }
  async finishUsage() {
    this.usage = finishUsage(this.usage, this.job.finishedAt ?? Date.now());
    await updateProject(this.projectId, (p) => {
      p.jobUsage = this.usage;
      if (p.usage) p.usage = finishUsage(p.usage, this.job.finishedAt ?? Date.now());
    });
    const p = await getProject(this.projectId);
    emit(this.projectId, { type: "usage", usage: this.usage, cumulative: p?.usage ?? this.usage });
  }
}

async function startJob(projectId: string, kind: Job["kind"], stages: Omit<JobStage, "status">[]) {
  const ctl = new JobCtl(projectId, { kind, startedAt: Date.now(), stages: stages.map((s) => ({ ...s, status: "wait" as StageStatus })) });
  await updateProject(projectId, (p) => {
    p.jobUsage = ctl.usage;
    if (!p.usage) p.usage = emptyUsage(ctl.job.startedAt);
  });
  await ctl.flush();
  return ctl;
}

function background(projectId: string, fn: () => Promise<void>) {
  if (running.has(projectId)) throw new BusyError();
  running.add(projectId);
  fn()
    .catch((e) => console.error(`[forge] job failed for ${projectId}`, e))
    .finally(() => running.delete(projectId));
}

export class BusyError extends Error {
  constructor() {
    super("Forge ya está trabajando en este juego. Espera a que termine.");
  }
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

async function addChat(projectId: string, msg: Omit<ChatMsg, "at">) {
  const full: ChatMsg = { ...msg, at: Date.now() };
  await updateProject(projectId, (p) => {
    p.chat.push(full);
  });
  emit(projectId, { type: "chat", msg: full });
}

async function generateMany(projectId: string, recs: AssetRecord[], design: GameDesign, provider: Project["imageProvider"], ctl: JobCtl, stageId: string) {
  if (!recs.length) return;
  let done = 0;
  await ctl.stage(stageId, "run", `0/${recs.length}`);
  await pool(recs, recs[0].type === "model" ? 2 : 3, async (r) => {
    const u = await generateAsset(projectId, r, design, provider);
    if (u) {
      await ctl.track({
        provider: u.provider as ApiProvider,
        label: u.label,
        calls: 1,
        estimatedUsd: u.estimatedUsd,
        ms: u.ms,
        images: u.images,
        audioSec: u.audioSec,
        models: u.models,
      });
    }
    done++;
    await ctl.stage(stageId, "run", `${done}/${recs.length}`);
  });
  const p = await getProject(projectId);
  const failed = recs.filter((r) => p?.assets[r.id]?.status === "error").length;
  const skipped = recs.filter((r) => p?.assets[r.id]?.status === "skipped").length;
  const detail = skipped === recs.length ? "Sin clave: se usan marcadores" : failed ? `${recs.length - failed}/${recs.length} · ${failed} con error` : `${recs.length}/${recs.length}`;
  await ctl.stage(stageId, skipped === recs.length ? "skip" : failed === recs.length ? "error" : "ok", detail);
}

/* ---------------- Create ---------------- */

export function startCreate(projectId: string) {
  background(projectId, () => createFlow(projectId));
}

async function createFlow(projectId: string) {
  const p0 = await getProject(projectId);
  if (!p0) return;
  const models3d = !!config.tripo.key() && p0.dimension !== "2d";
  const ctl = await startJob(projectId, "create", [
    { id: "director", label: "Director de juego" },
    { id: "art", label: "Artista de imágenes" },
    { id: "audio", label: "Músico y sonidista" },
    ...(models3d ? [{ id: "models", label: "Escultor 3D" }] : []),
    { id: "code", label: "Programador" },
    { id: "qa", label: "Control de calidad" },
  ]);
  try {
    let design: GameDesign;
    let records: Record<string, AssetRecord>;
    if (p0.design) {
      // Retry after a failure: keep the design and every asset that already succeeded.
      design = p0.design;
      records = p0.assets;
      await ctl.stage("director", "ok", design.title);
    } else {
      await ctl.stage("director", "run", "Leyendo tu idea");
      const dir = await runDirector(p0.idea, p0.dimension, { models3d });
      design = dir.design;
      await ctl.trackAnthropic(dir.usage, "director");
      records = recordsFromDesign(design);
      await updateProject(projectId, (p) => {
        p.design = design;
        p.assets = records;
      });
      emit(projectId, { type: "design", design });
      await ctl.stage("director", "ok", design.title);
    }

    const all = Object.values(records);
    const todo = all.filter((a) => a.status !== "ready" && a.status !== "skipped");
    const images = todo.filter((a) => a.type === "image");
    const audio = todo.filter((a) => a.type === "audio");
    const models = todo.filter((a) => a.type === "model");
    if (!images.length) await ctl.stage("art", "ok", "Sin cambios");
    if (!audio.length) await ctl.stage("audio", "ok", "Sin cambios");
    if (models3d && !models.length) await ctl.stage("models", "ok", "Sin cambios");

    const assetsJob = Promise.all([
      generateMany(projectId, images, design, p0.imageProvider, ctl, "art"),
      generateMany(projectId, audio, design, p0.imageProvider, ctl, "audio"),
      models3d ? generateMany(projectId, models, design, p0.imageProvider, ctl, "models") : Promise.resolve(),
    ]);
    // Silent cinematic expert (no loader stage): plan unique in-engine intro for this design.
    const cineJob = (async () => {
      if (design.cinematic?.direction?.shots?.length) return;
      try {
        const { direction, usage } = await runCinematicDirector(p0.idea, design, p0.dimension);
        await ctl.trackAnthropic(usage, "cinematic");
        design = {
          ...design,
          cinematic: { ...design.cinematic, style: design.cinematic?.style || "epica", lines: design.cinematic?.lines || [], direction },
        };
        await updateProject(projectId, (p) => {
          if (p.design) p.design.cinematic = design.cinematic;
        });
        emit(projectId, { type: "design", design });
      } catch (e) {
        console.warn("[forge] cinematic director skipped", e);
      }
    })();

    await cineJob;
    const codeJob = (async () => {
      await ctl.stage("code", "run", "Escribiendo el código");
      const fresh = await getProject(projectId);
      const code = await codeAgent({
        design: fresh?.design || design,
        assets: Object.values(fresh?.assets || records),
        mode: "create",
        idea: p0.idea,
        onProgress: (d) => void ctl.stage("code", "run", d),
        onUsage: (u, label) => void ctl.trackAnthropic(u, label),
      });
      await ctl.stage("code", "ok", `${code.split("\n").length} líneas`);
      return code;
    })();

    const [code] = await Promise.all([codeJob, assetsJob]);
    await ctl.stage("qa", "run", "Validando");
    await saveVersion(projectId, code, "Versión inicial");
    await ctl.stage("qa", "ok", "Listo para jugar");
    ctl.job.finishedAt = Date.now();
    await ctl.finishUsage();
    await ctl.flush();
    await updateProject(projectId, (p) => {
      p.status = "ready";
      p.repairs = 0;
    });
    await addChat(projectId, { who: "forge", text: design.title, tags: ["sys:ready"] });
    emit(projectId, { type: "status", status: "ready" });
  } catch (e) {
    ctl.job.error = errMsg(e);
    ctl.job.finishedAt = Date.now();
    for (const s of ctl.job.stages) if (s.status === "run") s.status = "error";
    await ctl.finishUsage();
    await ctl.flush();
    await updateProject(projectId, (p) => {
      p.status = "error";
    });
    emit(projectId, { type: "status", status: "error" });
  }
}

/* ---------------- Chat change ---------------- */

export function startChat(projectId: string, message: string, playing: boolean) {
  background(projectId, () => chatFlow(projectId, message, playing));
}

async function chatFlow(projectId: string, message: string, playing: boolean) {
  await addChat(projectId, { who: "you", text: message });
  const p = await getProject(projectId);
  if (!p?.design) return;
  const ctl = await startJob(projectId, "chat", [
    { id: "plan", label: "Director" },
    { id: "assets", label: "Recursos" },
    { id: "code", label: "Programador" },
  ]);
  try {
    await ctl.stage("plan", "run", "Entendiendo el cambio");
    const { plan, usage } = await planChange({ design: p.design, assets: Object.values(p.assets), history: p.chat, message, playing });
    await ctl.trackAnthropic(usage, "chat:plan");
    await ctl.stage("plan", "ok");

    // Instant changes first.
    let design = p.design;
    const tuningTouched = plan.tuning.length > 0 || plan.newTuning.length > 0;
    if (tuningTouched || plan.title || plan.cinematicLines.length === 3) {
      const updated = await updateProject(projectId, (pp) => {
        const d = pp.design!;
        for (const t of plan.tuning) {
          const cur = d.tuning.find((x) => x.key === t.key);
          if (cur) cur.value = Math.min(cur.max, Math.max(cur.min, Number(t.value)));
        }
        for (const t of plan.newTuning) if (!d.tuning.some((x) => x.key === t.key)) d.tuning.push(t);
        if (plan.title) d.title = plan.title;
        if (plan.cinematicLines.length === 3) {
          d.cinematic.lines = plan.cinematicLines;
          const spoken = voicePromptFromLines(plan.cinematicLines);
          const narrSpec = d.assets.audio.find((a) => a.kind === "voice" || a.id === "narration");
          if (narrSpec && spoken) narrSpec.prompt = spoken;
          const narrRec = Object.values(pp.assets).find((a) => a.type === "audio" && ((a.spec as AudioAssetSpec).kind === "voice" || a.id === "narration"));
          if (narrRec && spoken) (narrRec.spec as AudioAssetSpec).prompt = spoken;
        }
      });
      design = updated.design!;
      if (tuningTouched) emit(projectId, { type: "tuning", tuning: design.tuning });
      emit(projectId, { type: "design", design });
    }

    // Assets.
    const toGenerate: AssetRecord[] = [];
    await updateProject(projectId, (pp) => {
      const d = pp.design!;
      for (const r of plan.regenerate) {
        const a = pp.assets[r.id];
        if (!a || a.type === "model") continue;
        if (r.prompt) {
          const spec = a.spec as { prompt: string; kind?: string };
          spec.prompt =
            a.type === "audio" && spec.kind === "voice"
              ? sanitizeVoicePrompt(r.prompt, d.cinematic?.lines)
              : r.prompt;
        }
        a.liked = 0;
        toGenerate.push(a);
      }
      for (const s of plan.newImages) {
        if (pp.assets[s.id]) continue;
        d.assets.images.push(s);
        pp.assets[s.id] = newRecord("image", s);
        toGenerate.push(pp.assets[s.id]);
      }
      for (const s of plan.newAudio) {
        if (pp.assets[s.id]) continue;
        if (s.kind === "voice") s.prompt = sanitizeVoicePrompt(s.prompt, d.cinematic?.lines);
        d.assets.audio.push(s);
        pp.assets[s.id] = newRecord("audio", s);
        toGenerate.push(pp.assets[s.id]);
      }
      design = d;
    });
    for (const a of toGenerate) emit(projectId, { type: "asset", asset: a });

    const assetsJob = toGenerate.length
      ? (async () => {
          await ctl.stage("assets", "run", `0/${toGenerate.length}`);
          let n = 0;
          await pool(toGenerate, 3, async (r) => {
            const u = await generateAsset(projectId, r, design, p.imageProvider);
            if (u) {
              await ctl.track({
                provider: u.provider as ApiProvider,
                label: u.label,
                calls: 1,
                estimatedUsd: u.estimatedUsd,
                ms: u.ms,
                images: u.images,
                audioSec: u.audioSec,
                models: u.models,
              });
            }
            await ctl.stage("assets", "run", `${++n}/${toGenerate.length}`);
          });
          await ctl.stage("assets", "ok", `${toGenerate.length} actualizados`);
        })()
      : ctl.stage("assets", "skip");

    const codeJob = plan.code
      ? (async () => {
          await ctl.stage("code", "run", "Editando el código");
          const prev = await readCurrentCode(p);
          const fresh = await getProject(projectId);
          const code = await codeAgent({
            design,
            assets: Object.values(fresh!.assets),
            mode: "edit",
            previousCode: prev ?? "",
            instructions: plan.code,
            onProgress: (d) => void ctl.stage("code", "run", d),
            onUsage: (u, label) => void ctl.trackAnthropic(u, label),
          });
          await saveVersion(projectId, code, message.slice(0, 80));
          await updateProject(projectId, (pp) => {
            pp.repairs = 0;
          });
          await ctl.stage("code", "ok", "Nueva versión");
        })()
      : ctl.stage("code", "skip");

    await Promise.all([assetsJob, codeJob]);
    ctl.job.finishedAt = Date.now();
    ctl.job.reload = !!plan.code || toGenerate.length > 0;
    await ctl.finishUsage();
    await ctl.flush();
    await addChat(projectId, { who: "forge", text: plan.reply || "Listo.", tags: plan.tags });
  } catch (e) {
    ctl.job.error = errMsg(e);
    ctl.job.finishedAt = Date.now();
    for (const s of ctl.job.stages) if (s.status === "run") s.status = "error";
    await ctl.finishUsage();
    await ctl.flush();
    await addChat(projectId, { who: "forge", text: `No pude aplicar ese cambio: ${errMsg(e)}` });
  }
}

/* ---------------- Repair ---------------- */

export const MAX_REPAIRS = 3;

export function startRepair(projectId: string, error: string) {
  background(projectId, () => repairFlow(projectId, error));
}

async function repairFlow(projectId: string, error: string) {
  const p = await getProject(projectId);
  if (!p?.design) return;
  const ctl = await startJob(projectId, "repair", [{ id: "code", label: "Programador · reparación" }]);
  try {
    await updateProject(projectId, (pp) => {
      pp.repairs = (pp.repairs || 0) + 1;
    });
    await ctl.stage("code", "run", "Analizando el error");
    const prev = await readCurrentCode(p);
    const code = await codeAgent({
      design: p.design,
      assets: Object.values(p.assets),
      mode: "repair",
      previousCode: prev ?? "",
      error,
      onProgress: (d) => void ctl.stage("code", "run", d),
      onUsage: (u, label) => void ctl.trackAnthropic(u, label),
    });
    await saveVersion(projectId, code, "Reparación automática");
    await ctl.stage("code", "ok", "Error corregido");
    ctl.job.finishedAt = Date.now();
    ctl.job.reload = true;
    await ctl.finishUsage();
    await ctl.flush();
    await addChat(projectId, { who: "forge", text: "Encontré un error al ejecutar el juego y lo corregí." });
  } catch (e) {
    ctl.job.error = errMsg(e);
    ctl.job.finishedAt = Date.now();
    for (const s of ctl.job.stages) if (s.status === "run") s.status = "error";
    await ctl.finishUsage();
    await ctl.flush();
  }
}

/* ---------------- Single asset ---------------- */

export function startAssetRegen(projectId: string, assetId: string, prompt?: string) {
  background(projectId, async () => {
    const p = await getProject(projectId);
    const rec = p?.assets[assetId];
    if (!p?.design || !rec) return;
    const ctl = await startJob(projectId, "asset", [{ id: "assets", label: rec.name }]);
    if (prompt) {
      const cleaned =
        rec.type === "audio" && (rec.spec as AudioAssetSpec).kind === "voice"
          ? sanitizeVoicePrompt(prompt, p.design.cinematic?.lines)
          : prompt;
      await updateProject(projectId, (pp) => {
        (pp.assets[assetId].spec as { prompt: string }).prompt = cleaned;
        const dAudio = pp.design?.assets.audio.find((a) => a.id === assetId);
        if (dAudio) dAudio.prompt = cleaned;
      });
      (rec.spec as { prompt: string }).prompt = cleaned;
    }
    await ctl.stage("assets", "run", "Generando");
    const u = await generateAsset(projectId, rec, p.design, p.imageProvider);
    if (u) {
      await ctl.track({
        provider: u.provider as ApiProvider,
        label: u.label,
        calls: 1,
        estimatedUsd: u.estimatedUsd,
        ms: u.ms,
        images: u.images,
        audioSec: u.audioSec,
        models: u.models,
      });
    }
    const fresh = await getProject(projectId);
    const status = fresh?.assets[assetId]?.status;
    await ctl.stage("assets", status === "ready" ? "ok" : "error", fresh?.assets[assetId]?.error);
    ctl.job.finishedAt = Date.now();
    ctl.job.reload = status === "ready";
    await ctl.finishUsage();
    await ctl.flush();
  });
}

/* ---------------- Retry a failed creation ---------------- */

export async function retryCreate(projectId: string) {
  const p = await getProject(projectId);
  if (!p) return;
  if (p.design && p.versions.length) return;
  await updateProject(projectId, (pp) => {
    pp.status = "generating";
  });
  emit(projectId, { type: "status", status: "generating" });
  startCreate(projectId);
}
