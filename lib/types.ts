export type Dimension = "2d" | "2.5d" | "3d";
export type Engine = "phaser" | "three";
export type ImageProvider = "openai" | "minimax";

export type ImageRole =
  | "hero"
  | "enemy"
  | "npc"
  | "collectible"
  | "hazard"
  | "prop"
  | "platform"
  | "tile"
  | "goal"
  | "background"
  | "texture"
  | "ui"
  | "portrait";

export type Aspect = "1:1" | "16:9" | "9:16" | "3:2" | "2:3";

export interface ImageAssetSpec {
  id: string;
  name: string;
  role: ImageRole;
  prompt: string;
  transparent: boolean;
  aspect: Aspect;
  usage: string;
  /** Must tile on X (left≈right). Only abstract layers; never unique landmarks. */
  seamless?: boolean;
}

export type UiControlType = "toggle" | "slider" | "select";

export interface UiHudItem {
  id: string;
  label: string;
  kind: "value" | "bar" | "icon" | "lives";
  shows: string;
}

export interface UiMenuItem {
  id: string;
  label: string;
  action: string;
}

export interface UiSetting {
  key: string;
  label: string;
  type: UiControlType;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  defaultValue?: number | string | boolean;
}

export interface GameUiSpec {
  hud: UiHudItem[];
  pauseMenu: UiMenuItem[];
  settings: UiSetting[];
  gameOverActions: string[];
  startActions: string[];
}

export interface AudioAssetSpec {
  id: string;
  name: string;
  kind: "music" | "sfx" | "voice";
  prompt: string;
  durationSec: number;
  loop: boolean;
  usage: string;
}

export interface ModelAssetSpec {
  id: string;
  name: string;
  prompt: string;
  usage: string;
}

export interface TuningParam {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
}

export interface GameDesign {
  title: string;
  tagline: string;
  genre: string;
  dimension: Dimension;
  engine: Engine;
  camera: string;
  artStyle: string;
  palette: string[];
  setting: string;
  hero: { name: string; description: string };
  mechanics: string[];
  controls: { input: string; action: string }[];
  objective: string;
  loseCondition: string;
  levelOutline: string;
  tuning: TuningParam[];
  /** In-game UI the programmer must implement (HUD + pause/settings). */
  ui: GameUiSpec;
  cinematic: { style: string; lines: string[] };
  assets: {
    images: ImageAssetSpec[];
    audio: AudioAssetSpec[];
    models: ModelAssetSpec[];
  };
}

export type AssetType = "image" | "audio" | "model";
export type AssetStatus = "pending" | "generating" | "ready" | "error" | "skipped";

export interface AssetRecord {
  id: string;
  type: AssetType;
  name: string;
  spec: ImageAssetSpec | AudioAssetSpec | ModelAssetSpec;
  status: AssetStatus;
  file?: string;
  mime?: string;
  provider?: string;
  error?: string;
  liked?: -1 | 0 | 1;
  custom?: boolean;
  rev: number;
  updatedAt: number;
}

export interface Version {
  n: number;
  createdAt: number;
  note: string;
  file: string;
}

export interface ChatMsg {
  who: "you" | "forge";
  text: string;
  tags?: string[];
  at: number;
}

export type StageStatus = "wait" | "run" | "ok" | "error" | "skip";

export interface JobStage {
  id: string;
  label: string;
  status: StageStatus;
  detail?: string;
}

export interface Job {
  kind: "create" | "chat" | "repair" | "asset";
  stages: JobStage[];
  startedAt: number;
  finishedAt?: number;
  error?: string;
  /** The game must be reloaded in the preview (new code or new asset files). */
  reload?: boolean;
}

export type ApiProvider = "anthropic" | "openai" | "minimax" | "elevenlabs" | "tripo";

export interface UsageEvent {
  at: number;
  provider: ApiProvider;
  label: string;
  calls?: number;
  inputTokens?: number;
  outputTokens?: number;
  images?: number;
  audioSec?: number;
  models?: number;
  estimatedUsd?: number;
  ms?: number;
  model?: string;
  note?: string;
}

export interface ProviderUsage {
  provider: ApiProvider;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  images: number;
  audioSec: number;
  models: number;
  estimatedUsd: number;
  ms: number;
}

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  images: number;
  audioSec: number;
  models: number;
  estimatedUsd: number;
  ms: number;
}

export interface UsageReport {
  startedAt: number;
  finishedAt?: number;
  byProvider: Partial<Record<ApiProvider, ProviderUsage>>;
  events: UsageEvent[];
  totals: UsageTotals;
}

export interface Project {
  id: string;
  createdAt: number;
  updatedAt: number;
  idea: string;
  dimension: Dimension;
  imageProvider: ImageProvider;
  status: "generating" | "ready" | "error";
  design?: GameDesign;
  assets: Record<string, AssetRecord>;
  versions: Version[];
  currentVersion: number;
  chat: ChatMsg[];
  job?: Job;
  /** Cumulative API usage for this project (create + chat + repairs). */
  usage?: UsageReport;
  /** Usage of the last/current job only. */
  jobUsage?: UsageReport;
  repairs: number;
  /** Play the cinematic before the start screen. */
  cineAuto?: boolean;
}

export type ForgeEvent =
  | { type: "project"; project: Project }
  | { type: "job"; job: Job }
  | { type: "asset"; asset: AssetRecord }
  | { type: "design"; design: GameDesign }
  | { type: "chat"; msg: ChatMsg }
  | { type: "tuning"; tuning: TuningParam[] }
  | { type: "version"; n: number }
  | { type: "status"; status: Project["status"] }
  | { type: "usage"; usage: UsageReport; cumulative: UsageReport }
  | { type: "log"; text: string };
