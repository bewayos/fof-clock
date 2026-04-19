import { LIGHT_TYPES, MODULE_ID } from "./constants.js";
import { LightManager } from "./light-manager.js";
import { debugLog } from "./logger.js";
import { StateManager } from "./state-manager.js";
import { TimeManager } from "./time-manager.js";

export class FoFClockAPI {
  getState() {
    return StateManager.getState();
  }

  getTimeInfo() {
    return TimeManager.derive(this.getState().turn);
  }

  async patchLight(lightId, patch) {
    const next = await StateManager.updateState((prev) => {
      const curr = prev.lights[lightId];
      if (!curr) return prev;
      return {
        ...prev,
        lights: {
          ...prev.lights,
          [lightId]: { ...curr, ...patch }
        }
      };
    });
    return next.lights[lightId];
  }

  async createCarriedLight(token, type) {
    if (!token) throw new Error("Token is required");
    if (!LIGHT_TYPES[type]) throw new Error(`Unknown light type ${type}`);

    const state = this.getState();
    const existing = Object.values(state.lights).find((l) => l.tokenId === token.id && l.sceneId === token.parent?.id);
    if (existing) return existing;

    const light = LightManager.buildLight({
      type,
      sceneId: token.parent.id,
      tokenId: token.id,
      actorId: token.actor?.id ?? token.actorId,
      createdAtTurn: state.turn
    });

    await StateManager.updateState((prev) => ({
      ...prev,
      lights: {
        ...prev.lights,
        [light.id]: light
      }
    }));

    await LightManager.syncSceneLights(this.getState(), token.parent);
    debugLog("create-carried-light", { tokenId: token.id, sceneId: token.parent.id, lightId: light.id, type });
    return light;
  }

  async extinguishSelected(token) {
    if (!token) return;
    await StateManager.updateState((prev) => {
      const remaining = Object.fromEntries(
        Object.values(prev.lights)
          .filter((l) => !(l.tokenId === token.id && l.sceneId === token.parent?.id))
          .map((l) => [l.id, l])
      );
      return { ...prev, lights: remaining };
    });

    await token.parent.updateEmbeddedDocuments("Token", [{ _id: token.id, light: { dim: 0, bright: 0, color: null } }]);
    await LightManager.syncSceneLights(this.getState(), token.parent);
    debugLog("extinguish", { tokenId: token.id, sceneId: token.parent.id });
  }

  async dropSelectedLight(token) {
    if (!token) return;
    const state = this.getState();
    const light = Object.values(state.lights).find((l) => l.tokenId === token.id && l.sceneId === token.parent?.id);
    if (!light) return;

    const dropped = await LightManager.dropLight(light, token);
    await this.patchLight(light.id, dropped);
    await LightManager.syncSceneLights(this.getState(), token.parent);
    debugLog("drop-light", { tokenId: token.id, sceneId: token.parent.id, lightId: light.id });
  }

  async pickUpNearestDroppedLight(token) {
    if (!token) return;
    const sceneId = token.parent?.id;
    const state = this.getState();
    const dropped = Object.values(state.lights)
      .filter((l) => !l.tokenId && l.sceneId === sceneId && l.position)
      .sort((a, b) => {
        const da = Math.hypot((a.position.x - token.x), (a.position.y - token.y));
        const db = Math.hypot((b.position.x - token.x), (b.position.y - token.y));
        return da - db;
      });

    const nearest = dropped[0];
    if (!nearest) return;

    const picked = await LightManager.pickUpLight(nearest, token);
    await this.patchLight(nearest.id, picked);
    await LightManager.syncSceneLights(this.getState(), token.parent);
    debugLog("pickup-light", { tokenId: token.id, sceneId, lightId: nearest.id });
  }

  async advanceTime(turns = 1) {
    const amount = Math.max(0, Number(turns || 0));
    if (!amount) return this.getState();

    const prev = this.getState();
    const nextLights = LightManager.decrementLights(prev.lights, amount);
    const warningMessages = LightManager.warnings(prev.lights, nextLights);

    const expiredLights = Object.values(prev.lights).filter((l) => !nextLights[l.id]);
    const nextState = await StateManager.setState({
      turn: prev.turn + amount,
      lights: nextLights
    });

    for (const light of expiredLights) {
      if (!light.tokenId && light.ambientLightId) {
        const scene = game.scenes.get(light.sceneId);
        if (scene?.lights?.get(light.ambientLightId)) {
          await scene.deleteEmbeddedDocuments("AmbientLight", [light.ambientLightId]);
        }
      }
    }

    if (game.user.isGM) {
      for (const message of warningMessages) {
        ui.notifications.warn(message);
      }
    }

    if (canvas?.scene) {
      await LightManager.syncSceneLights(nextState, canvas.scene);
    }

    Hooks.callAll(`${MODULE_ID}.timeAdvanced`, {
      amount,
      before: prev,
      after: nextState,
      clock: TimeManager.derive(nextState.turn)
    });

    debugLog("advance-time", {
      amount,
      beforeTurn: prev.turn,
      afterTurn: nextState.turn,
      expiredCount: expiredLights.length
    });

    return nextState;
  }
}
