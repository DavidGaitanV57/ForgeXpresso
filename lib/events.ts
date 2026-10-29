import { EventEmitter } from "node:events";
import type { ForgeEvent } from "./types";

const g = globalThis as unknown as { __forgeBus?: EventEmitter };
const bus = g.__forgeBus ?? (g.__forgeBus = new EventEmitter());
bus.setMaxListeners(200);

export function emit(projectId: string, ev: ForgeEvent) {
  bus.emit(projectId, ev);
}

export function subscribe(projectId: string, fn: (ev: ForgeEvent) => void) {
  bus.on(projectId, fn);
  return () => {
    bus.off(projectId, fn);
  };
}
