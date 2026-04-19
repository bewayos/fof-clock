import { LIGHT_TYPES, MODULE_ID, TOKEN_LIGHT_FLAG } from "./constants.js";
import { debugLog, warnLog } from "./logger.js";

function lightConfigEqual(left = {}, right = {}) {
  return ["dim", "bright", "angle", "alpha", "color", "attenuation", "luminosity", "shadows"].every((key) => left[key] === right[key])
    && (left.animation?.type ?? null) === (right.animation?.type ?? null)
    && (left.animation?.speed ?? 0) === (right.animation?.speed ?? 0)
    && (left.animation?.intensity ?? 0) === (right.animation?.intensity ?? 0);
}

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
      position: position ? { x: Number(position.x), y: Number(position.y) } : null,
      createdAtTurn: Number(createdAtTurn),
      ambientLightId,
      warnedAtOneTurn: false
    };
  }

  static isDropped(light) {
    return !light.tokenId;
  }

  static decrementLights(lightsById, turns) {
    const updated = {};

    for (const light of Object.values(lightsById)) {
      const remainingTurns = Math.max(0, Number(light.remainingTurns) - turns);
      if (remainingTurns <= 0) continue;

      updated[light.id] = {
        ...light,
        remainingTurns,
        warnedAtOneTurn: light.warnedAtOneTurn || remainingTurns === 1
      };
    }

    return updated;
  }

  static getNewWarnings(previousLights, updatedLights) {
    return Object.values(updatedLights).filter((light) => {
      const before = previousLights[light.id];
      return before && before.remainingTurns > 1 && light.remainingTurns === 1 && !before.warnedAtOneTurn;
    });
  }

  static warningMessage(light) {
    const label = LIGHT_TYPES[light.type]?.name ?? "Light";
    return `${label} almost burned out`;
  }

  static expirationMessage(light) {
    const label = LIGHT_TYPES[light.type]?.name ?? "Light";
    return `${label} has expired`;
  }

  static igniteMessage(light, ownerLabel = "Unknown") {
    const label = LIGHT_TYPES[light.type]?.name ?? "Light";
    return `${ownerLabel} ignites a ${label}`;
  }

  static resolveTokenForLight(light, scene) {
    if (!scene) return null;
    if (light.tokenId && scene.tokens.get(light.tokenId)) return scene.tokens.get(light.tokenId);

    if (light.actorId) {
      const fallback = scene.tokens.contents.find((t) => t.actorId === light.actorId);
      if (fallback) return fallback;
    }
    return null;
  }

  static findAmbientForLight(scene, light) {
    if (!scene || !light) return null;
    if (light.ambientLightId && scene.lights.get(light.ambientLightId)) return scene.lights.get(light.ambientLightId);
    return scene.lights.contents.find((ambient) => ambient.getFlag(MODULE_ID, "lightId") === light.id) ?? null;
  }

  static async ensureDroppedAmbient(light, scene) {
    if (!scene || !light?.position) return null;

    const config = this.ambientLightConfig(light.id, light.type, light.position);
    const existing = this.findAmbientForLight(scene, light);

    if (existing) {
      const changed = Number(existing.x) !== Number(config.x)
        || Number(existing.y) !== Number(config.y)
        || !lightConfigEqual(existing.config ?? {}, config.config ?? {});

      if (changed) {
        await scene.updateEmbeddedDocuments("AmbientLight", [{ _id: existing.id, ...config }]);
      }

      return existing.id;
    }

    const created = await scene.createEmbeddedDocuments("AmbientLight", [config]);
    return created?.[0]?.id ?? null;
  }

  static async deleteAmbientForLight(scene, light) {
    if (!scene || !light) return;
    const ambient = this.findAmbientForLight(scene, light);
    if (!ambient?.id) return;
    await scene.deleteEmbeddedDocuments("AmbientLight", [ambient.id]);
  }

  static async syncSceneLights(state, scene = canvas?.scene) {
    if (!scene) return;
    const lights = Object.values(state.lights).filter((l) => l.sceneId === scene.id);
    await this.syncCarriedLights(lights, scene);
    await this.syncDroppedLights(lights, scene);
  }

  static async syncCarriedLights(lights, scene) {
    const carried = lights.filter((l) => !!l.tokenId);
    const tokenUpdates = [];
    const activeLightIds = new Set();

    for (const light of carried) {
      const tokenDoc = this.resolveTokenForLight(light, scene);
      if (!tokenDoc) {
        warnLog("light change: missing-token-for-light", { lightId: light.id, tokenId: light.tokenId, actorId: light.actorId, sceneId: scene.id });
        continue;
      }

      activeLightIds.add(light.id);
      const nextLight = this.tokenLightConfig(light.type);
      const sameDim = tokenDoc.light?.dim === nextLight.dim;
      const sameBright = tokenDoc.light?.bright === nextLight.bright;
      const sameColor = tokenDoc.light?.color === nextLight.color;
      const sameFlag = tokenDoc.getFlag(MODULE_ID, TOKEN_LIGHT_FLAG) === light.id;
      if (sameDim && sameBright && sameColor && sameFlag) continue;

      tokenUpdates.push({
        _id: tokenDoc.id,
        light: nextLight,
        flags: {
          [MODULE_ID]: {
            [TOKEN_LIGHT_FLAG]: light.id
          }
        }
      });
    }

    if (tokenUpdates.length) {
      await scene.updateEmbeddedDocuments("Token", tokenUpdates);
    }

    const clearUpdates = scene.tokens.contents
      .filter((tokenDoc) => !!tokenDoc.getFlag(MODULE_ID, TOKEN_LIGHT_FLAG))
      .filter((tokenDoc) => !activeLightIds.has(tokenDoc.getFlag(MODULE_ID, TOKEN_LIGHT_FLAG)))
      .map((tokenDoc) => ({
        _id: tokenDoc.id,
        light: { dim: 0, bright: 0, color: null, animation: { type: null, speed: 0, intensity: 0 } },
        flags: {
          [MODULE_ID]: {
            [TOKEN_LIGHT_FLAG]: null
          }
        }
      }));

    if (clearUpdates.length) {
      await scene.updateEmbeddedDocuments("Token", clearUpdates);
    }

    debugLog("light change", { sceneId: scene.id, updates: tokenUpdates.length, clears: clearUpdates.length });
  }

  static async syncDroppedLights(lights, scene) {
    const dropped = lights.filter((l) => this.isDropped(l));
    const existing = scene.lights.contents.filter((l) => l.flags?.[MODULE_ID]?.lightId);
    const validDroppedIds = new Set(dropped.map((l) => l.id));

    const staleAmbientIds = existing.filter((ambient) => !validDroppedIds.has(ambient.flags?.[MODULE_ID]?.lightId)).map((ambient) => ambient.id);
    if (staleAmbientIds.length) {
      await scene.deleteEmbeddedDocuments("AmbientLight", staleAmbientIds);
    }

    const toCreate = [];
    const toUpdate = [];
    const ambientIdPatches = [];

    for (const light of dropped) {
      if (!light.position) continue;

      const config = this.ambientLightConfig(light.id, light.type, light.position);
      const existingAmbient = this.findAmbientForLight(scene, light);

      if (!existingAmbient) {
        toCreate.push({ lightId: light.id, config });
        continue;
      }

      const changed = Number(existingAmbient.x) !== Number(config.x)
        || Number(existingAmbient.y) !== Number(config.y)
        || !lightConfigEqual(existingAmbient.config ?? {}, config.config ?? {});

      if (changed) toUpdate.push({ _id: existingAmbient.id, ...config });
      if (light.ambientLightId !== existingAmbient.id) {
        ambientIdPatches.push({ lightId: light.id, ambientLightId: existingAmbient.id });
      }
    }

    if (toUpdate.length) await scene.updateEmbeddedDocuments("AmbientLight", toUpdate);
    if (toCreate.length) {
      const created = await scene.createEmbeddedDocuments("AmbientLight", toCreate.map((c) => c.config));
      for (let i = 0; i < created.length; i += 1) {
        const createdId = created[i]?.id;
        const lightId = toCreate[i]?.lightId;
        if (!createdId || !lightId) continue;
        ambientIdPatches.push({ lightId, ambientLightId: createdId });
      }
    }

    for (const patch of ambientIdPatches) {
      await game.modules.get(MODULE_ID).api.patchLight(patch.lightId, { ambientLightId: patch.ambientLightId });
    }

    debugLog("light change", {
      sceneId: scene.id,
      updates: toUpdate.length,
      creates: toCreate.length,
      staleDeletes: staleAmbientIds.length,
      patched: ambientIdPatches.length
    });
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
      animation: { type: "torch", speed: 2, intensity: 2 }
    };
  }

  static ambientLightConfig(lightId, type, position) {
    const base = LIGHT_TYPES[type];
    return {
      x: Number(position?.x ?? 0),
      y: Number(position?.y ?? 0),
      config: {
        dim: base.dim,
        bright: base.bright,
        angle: 360,
        alpha: base.alpha,
        color: base.color,
        attenuation: 0.5,
        luminosity: 0.5,
        shadows: 0.2,
        animation: { type: "torch", speed: 2, intensity: 2 }
      },
      flags: {
        [MODULE_ID]: { lightId }
      }
    };
  }

  static dropLight(light, token) {
    return {
      ...light,
      tokenId: null,
      actorId: token?.actor?.id ?? light.actorId,
      position: { x: Number(token?.x ?? light.position?.x ?? 0), y: Number(token?.y ?? light.position?.y ?? 0) },
      ambientLightId: null
    };
  }

  static async pickUpLight(light, token) {
    const scene = token?.parent ?? canvas?.scene;
    await this.deleteAmbientForLight(scene, light);

    return {
      ...light,
      tokenId: token.id,
      actorId: token.actor?.id ?? light.actorId,
      position: null,
      ambientLightId: null
    };
  }

  static async cleanupExpiredDropped(expiredLights) {
    const grouped = new Map();
    for (const light of expiredLights) {
      if (light.tokenId) continue;
      if (!grouped.has(light.sceneId)) grouped.set(light.sceneId, []);
      grouped.get(light.sceneId).push(light);
    }

    for (const [sceneId, lights] of grouped.entries()) {
      const scene = game.scenes.get(sceneId);
      if (!scene) continue;

      for (const light of lights) {
        try {
          await this.deleteAmbientForLight(scene, light);
        } catch (error) {
          warnLog("light change: cleanup-expired-dropped-failed", { sceneId, lightId: light.id, error: error?.message ?? error });
        }
      }
    }
  }

  static onTokenDeletedPatch(light, tokenDoc) {
    return {
      ...light,
      tokenId: null,
      actorId: tokenDoc.actorId ?? light.actorId,
      position: { x: Number(tokenDoc.x ?? 0), y: Number(tokenDoc.y ?? 0) },
      ambientLightId: null
    };
  }
}
