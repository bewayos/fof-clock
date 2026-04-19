import { LIGHT_TYPES, MODULE_ID } from "./constants.js";
import { debugStateTransition } from "./logger.js";
import { LightManager } from "./light-manager.js";
import { StateManager } from "./state-manager.js";
import { TimeManager } from "./time-manager.js";

export class FoFClockAPI {
  getState() {
    return StateManager.getState();
  }

  getTimeInfo() {
    return TimeManager.derive(this.getState().turn);
  }

  getLightsForScene(sceneId) {
    return Object.values(this.getState().lights).filter((l) => l.sceneId === sceneId);
  }

  async patchLight(lightId, patch) {
    const { next } = await StateManager.updateState((prev) => {
      const curr = prev.lights[lightId];
      if (!curr) return prev;
      return {
        ...prev,
        lights: {
          ...prev.lights,
          [lightId]: { ...curr, ...patch }
        }
      };
    }, { op: "patchLight", lightId });
    return next.lights[lightId];
  }

  async removeLight(lightId) {
    return StateManager.updateState((prev) => {
      if (!prev.lights[lightId]) return prev;
      const nextLights = { ...prev.lights };
      delete nextLights[lightId];
      return { ...prev, lights: nextLights };
    }, { op: "removeLight", lightId });
  }

  async createCarriedLight(token, type) {
    if (!token) throw new Error("Token is required");
    if (!LIGHT_TYPES[type]) throw new Error(`Unknown light type ${type}`);

    const state = this.getState();
    const existing = Object.values(state.lights).find((l) => l.sceneId === token.parent.id && (l.tokenId === token.id || (!l.tokenId && l.actorId && l.actorId === token.actorId)));
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
    }), { op: "createCarriedLight", lightId: light.id });

    await LightManager.syncSceneLights(this.getState(), token.parent);
    this.postChat(LightManager.igniteMessage(light, token.name));
    return light;
  }

  async extinguishSelected(token) {
    if (!token) return;
    const scene = token.parent;
    const state = this.getState();
    const light = Object.values(state.lights).find((l) => l.sceneId === scene.id && (l.tokenId === token.id || (!l.tokenId && l.actorId === token.actorId)));
    if (!light) return;

    await this.removeLight(light.id);
    await LightManager.syncSceneLights(this.getState(), scene);
  }

  async extinguishById(lightId) {
    const state = this.getState();
    const light = state.lights[lightId];
    if (!light) return;
    await this.removeLight(lightId);
    const scene = game.scenes.get(light.sceneId);
    if (scene) await LightManager.syncSceneLights(this.getState(), scene);
  }

  async dropSelectedLight(token) {
    if (!token) return;
    const state = this.getState();
    const light = Object.values(state.lights).find((l) => l.sceneId === token.parent.id && l.tokenId === token.id);
    if (!light) return;

    const dropped = LightManager.dropLight(light, token);
    await this.patchLight(light.id, dropped);

    const ambientLightId = await LightManager.ensureDroppedAmbient(dropped, token.parent);
    if (ambientLightId && ambientLightId !== dropped.ambientLightId) {
      await this.patchLight(light.id, { ambientLightId });
    }

    await LightManager.syncCarriedLights(this.getLightsForScene(token.parent.id), token.parent);
  }

  async pickUpNearestDroppedLight(token) {
    if (!token) return;
    const sceneId = token.parent?.id;
    const state = this.getState();
    const dropped = Object.values(state.lights)
      .filter((l) => !l.tokenId && l.sceneId === sceneId && l.position)
      .sort((a, b) => Math.hypot(a.position.x - token.x, a.position.y - token.y) - Math.hypot(b.position.x - token.x, b.position.y - token.y));

    const nearest = dropped[0];
    if (!nearest) return;

    const picked = await LightManager.pickUpLight(nearest, token);
    await this.patchLight(nearest.id, picked);
    await LightManager.syncSceneLights(this.getState(), token.parent);
  }

  async jumpToLightToken(lightId) {
    const light = this.getState().lights[lightId];
    if (!light) return;
    const scene = game.scenes.get(light.sceneId);
    if (!scene) return;
    if (canvas?.scene?.id !== scene.id) await scene.activate();

    const currentScene = canvas.scene;
    const token = LightManager.resolveTokenForLight(light, currentScene);
    if (token?.object) {
      token.object.control({ releaseOthers: true });
      canvas.animatePan({ x: token.x, y: token.y, scale: 1.2, duration: 300 });
    } else if (light.position) {
      canvas.animatePan({ x: light.position.x, y: light.position.y, scale: 1.2, duration: 300 });
    }
  }

  async advanceTime(turns = 1) {
    const amount = Math.max(0, Number(turns || 0));
    if (!amount) return this.getState();

    const before = this.getState();
    const afterLights = LightManager.decrementLights(before.lights, amount);
    const warnings = LightManager.getNewWarnings(before.lights, afterLights);
    const expiredLights = Object.values(before.lights).filter((l) => !afterLights[l.id]);

    const after = await StateManager.setState({
      turn: before.turn + amount,
      lights: afterLights
    });

    await LightManager.cleanupExpiredDropped(expiredLights);

    const activeSceneIds = new Set(Object.values(after.lights).map((light) => light.sceneId));
    for (const sceneId of activeSceneIds) {
      const scene = game.scenes.get(sceneId);
      if (scene) await LightManager.syncSceneLights(after, scene);
    }

    if (game.user.isGM) {
      warnings.forEach((light) => {
        const msg = LightManager.warningMessage(light);
        ui.notifications.warn(msg);
        this.postChat(msg);
      });

      expiredLights.forEach((light) => this.postChat(LightManager.expirationMessage(light)));
    }

    const info = TimeManager.derive(after.turn);
    Hooks.callAll(`${MODULE_ID}.timeAdvanced`, { amount, before, after, clock: info });
    debugStateTransition("advanceTime", before, after, { amount, warnings: warnings.map((w) => w.id), expired: expiredLights.map((e) => e.id) });

    return after;
  }

  postChat(content) {
    if (!game.user.isGM) return;
    ChatMessage.create({
      content: `<p><strong>FoF Clock:</strong> ${content}</p>`,
      whisper: ChatMessage.getWhisperRecipients("GM")
    });
  }
}
