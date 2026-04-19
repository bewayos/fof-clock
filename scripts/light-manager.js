import { LIGHT_TYPES, MODULE_ID } from "./constants.js";
import { debugLog, warnLog } from "./logger.js";

export class LightManager {
  static generateId() {
    return foundry.utils.randomID();
  }

  static buildLight({ type, sceneId, tokenId = null, actorId = null, position = null, createdAtTurn = 0, remainingTurns = null, ambientLightId = null }) {
    const lightType = LIGHT_TYPES[type];
    if (!lightType) throw new Error(`Unknown light type: ${type}`);

    return {
      id: this.generateId(),
      type,
      remainingTurns: Number(remainingTurns ?? lightType.durationTurns),
      sceneId,
      tokenId,
      actorId,
      position: position ? { x: position.x, y: position.y } : null,
      createdAtTurn: Number(createdAtTurn),
      ambientLightId
    };
  }

  static isDropped(light) {
    return !light.tokenId;
  }

  static decrementLights(lightsById, turns) {
    return Object.fromEntries(
      Object.values(lightsById)
        .map((light) => ({
          ...light,
          remainingTurns: Math.max(0, Number(light.remainingTurns) - turns)
        }))
        .filter((light) => light.remainingTurns > 0)
        .map((light) => [light.id, light])
    );
  }

  static warnings(previousLights, updatedLights) {
    return Object.values(updatedLights)
      .filter((light) => {
        const before = previousLights[light.id];
        return before && before.remainingTurns > 1 && light.remainingTurns === 1;
      })
      .map((light) => this.warningMessage(light));
  }

  static warningMessage(light) {
    const label = LIGHT_TYPES[light.type]?.name ?? "Light";
    return `${label} almost burned out`;
  }

  static async syncSceneLights(state, scene = canvas?.scene) {
    if (!scene) return;
    const sceneId = scene.id;
    const lights = Object.values(state.lights).filter((l) => l.sceneId === sceneId);

    await Promise.all([
      this.syncCarriedLights(lights, scene),
      this.syncDroppedLights(lights, scene)
    ]);
  }

  static async syncCarriedLights(lights, scene) {
    const carried = lights.filter((l) => l.tokenId);
    const tokenUpdates = [];

    for (const light of carried) {
      const tokenDoc = scene.tokens.get(light.tokenId);
      if (!tokenDoc) {
        warnLog("missing-token", { lightId: light.id, tokenId: light.tokenId, sceneId: scene.id });
        continue;
      }
      const config = this.tokenLightConfig(light.type);
      tokenUpdates.push({ _id: tokenDoc.id, light: config });
    }

    if (tokenUpdates.length) {
      debugLog("sync-carried", { count: tokenUpdates.length, sceneId: scene.id });
      await scene.updateEmbeddedDocuments("Token", tokenUpdates, { noHook: false });
    }

    const litTokenIds = new Set(carried.map((l) => l.tokenId));
    const darkenUpdates = scene.tokens.contents
      .filter((t) => !litTokenIds.has(t.id))
      .filter((t) => (t.light?.dim ?? 0) > 0 || (t.light?.bright ?? 0) > 0)
      .map((t) => ({ _id: t.id, light: { dim: 0, bright: 0, angle: 360, alpha: 0.5, color: null, attenuation: 0.5, luminosity: 0.5, shadows: 0.2, animation: { type: null, speed: 0, intensity: 0 } } }));

    if (darkenUpdates.length) {
      await scene.updateEmbeddedDocuments("Token", darkenUpdates);
    }
  }

  static async syncDroppedLights(lights, scene) {
    const dropped = lights.filter((l) => this.isDropped(l));
    const existing = scene.lights.contents.filter((l) => l.flags?.[MODULE_ID]?.lightId);
    const keepIds = new Set(dropped.map((l) => l.ambientLightId).filter(Boolean));

    const deleteIds = existing.filter((a) => !keepIds.has(a.id)).map((a) => a.id);
    if (deleteIds.length) {
      debugLog("delete-stale-ambient", { deleteIds, sceneId: scene.id });
      await scene.deleteEmbeddedDocuments("AmbientLight", deleteIds);
    }

    for (const light of dropped) {
      const config = this.ambientLightConfig(light.id, light.type, light.position);
      if (light.ambientLightId && scene.lights.get(light.ambientLightId)) {
        await scene.updateEmbeddedDocuments("AmbientLight", [{ _id: light.ambientLightId, ...config }]);
      } else {
        const created = await scene.createEmbeddedDocuments("AmbientLight", [config]);
        const createdId = created?.[0]?.id;
        if (!createdId) continue;
        await game.modules.get(MODULE_ID).api.patchLight(light.id, { ambientLightId: createdId });
      }
    }
  }

  static tokenLightConfig(type) {
    const base = LIGHT_TYPES[type];
    return {
      dim: base.dim,
      bright: base.bright,
      angle: 360,
      alpha: base.alpha,
      color: base.color,
      attenuation: 0.5,
      luminosity: 0.5,
      shadows: 0.2,
      animation: {
        type: "torch",
        speed: 2,
        intensity: 2
      }
    };
  }

  static ambientLightConfig(lightId, type, position) {
    const base = LIGHT_TYPES[type];
    return {
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      config: {
        dim: base.dim,
        bright: base.bright,
        angle: 360,
        alpha: base.alpha,
        color: base.color,
        attenuation: 0.5,
        luminosity: 0.5,
        shadows: 0.2,
        animation: {
          type: "torch",
          speed: 2,
          intensity: 2
        }
      },
      flags: {
        [MODULE_ID]: {
          lightId
        }
      }
    };
  }

  static async dropLight(light, token) {
    return {
      ...light,
      tokenId: null,
      actorId: token?.actor?.id ?? light.actorId,
      position: { x: token?.x ?? light.position?.x ?? 0, y: token?.y ?? light.position?.y ?? 0 },
      ambientLightId: null
    };
  }

  static async pickUpLight(light, token) {
    if (light.ambientLightId && canvas?.scene?.lights?.get(light.ambientLightId)) {
      await canvas.scene.deleteEmbeddedDocuments("AmbientLight", [light.ambientLightId]);
    }

    return {
      ...light,
      tokenId: token.id,
      actorId: token.actor?.id ?? light.actorId,
      position: null,
      ambientLightId: null
    };
  }

  static async onTokenDeleted(tokenDoc) {
    const state = game.modules.get(MODULE_ID).api.getState();
    const lights = Object.values(state.lights);
    const toDrop = lights.filter((l) => l.tokenId === tokenDoc.id && l.sceneId === tokenDoc.parent?.id);
    if (!toDrop.length) return;

    for (const light of toDrop) {
      const dropped = {
        ...light,
        tokenId: null,
        actorId: tokenDoc.actorId ?? light.actorId,
        position: { x: tokenDoc.x, y: tokenDoc.y },
        ambientLightId: null
      };
      await game.modules.get(MODULE_ID).api.patchLight(light.id, dropped);
    }

    debugLog("token-deleted-dropped-lights", { tokenId: tokenDoc.id, count: toDrop.length });
  }
}
