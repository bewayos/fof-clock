import { LIGHT_TYPES, MODULE_ID, SETTING_STATE } from "./constants.js";
import { debugLog, warnLog } from "./logger.js";

export class StateManager {
  static defaultState() {
    return { turn: 0, lights: {} };
  }

  static getState() {
    const raw = game.settings.get(MODULE_ID, SETTING_STATE);
    const { state, repaired, reasons } = this.validateAndRepair(raw);
    if (repaired) {
      warnLog("state-repaired-on-read", { reasons, raw });
      void game.settings.set(MODULE_ID, SETTING_STATE, state);
    }
    return state;
  }

  static async setState(nextState) {
    const { state, repaired, reasons } = this.validateAndRepair(nextState);
    if (repaired) warnLog("state-repaired-on-write", { reasons });
    await game.settings.set(MODULE_ID, SETTING_STATE, state);
    return state;
  }

  static async updateState(updater, meta = {}) {
    const prev = this.getState();
    const candidate = updater(prev);
    const next = await this.setState(candidate);
    debugLog("state-update", { meta, prevTurn: prev.turn, nextTurn: next.turn, lightCount: Object.keys(next.lights).length });
    return { prev, next };
  }

  static validateAndRepair(input) {
    const reasons = [];
    const base = foundry.utils.deepClone(this.defaultState());
    const src = input && typeof input === "object" ? input : base;

    const turn = Number(src.turn);
    if (!Number.isFinite(turn) || turn < 0) reasons.push("invalid turn");

    const rawLights = src.lights && typeof src.lights === "object" ? src.lights : {};
    if (rawLights !== src.lights) reasons.push("lights replaced with object");

    const repairedLights = {};
    for (const [key, value] of Object.entries(rawLights)) {
      const normalized = this.normalizeLight(value);
      if (!normalized) {
        reasons.push(`invalid light dropped: ${key}`);
        continue;
      }
      if (repairedLights[normalized.id]) {
        reasons.push(`duplicate light id dropped: ${normalized.id}`);
        continue;
      }
      repairedLights[normalized.id] = normalized;
    }

    return {
      state: {
        turn: Number.isFinite(turn) && turn >= 0 ? Math.floor(turn) : 0,
        lights: repairedLights
      },
      repaired: reasons.length > 0,
      reasons
    };
  }

  static normalizeLight(light) {
    if (!light || typeof light !== "object") return null;
    const id = typeof light.id === "string" && light.id ? light.id : null;
    const type = typeof light.type === "string" ? light.type : null;
    if (!id || !type || !LIGHT_TYPES[type]) return null;

    const sceneId = typeof light.sceneId === "string" && light.sceneId ? light.sceneId : null;
    if (!sceneId) return null;

    const remainingTurns = Math.max(0, Math.floor(Number(light.remainingTurns ?? 0)));
    if (!remainingTurns) return null;

    const position = light.position && Number.isFinite(Number(light.position.x)) && Number.isFinite(Number(light.position.y))
      ? { x: Number(light.position.x), y: Number(light.position.y) }
      : null;

    return {
      id,
      type,
      remainingTurns,
      sceneId,
      tokenId: typeof light.tokenId === "string" && light.tokenId ? light.tokenId : null,
      actorId: typeof light.actorId === "string" && light.actorId ? light.actorId : null,
      position,
      createdAtTurn: Math.max(0, Math.floor(Number(light.createdAtTurn ?? 0))),
      ambientLightId: typeof light.ambientLightId === "string" && light.ambientLightId ? light.ambientLightId : null,
      warnedAtOneTurn: Boolean(light.warnedAtOneTurn)
    };
  }
}
