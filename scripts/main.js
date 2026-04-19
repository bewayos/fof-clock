import { MODULE_ID, SETTING_DEBUG, SETTING_STATE } from "./constants.js";
import { LightManager } from "./light-manager.js";
import { debugLog } from "./logger.js";
import { FoFClockAPI } from "./module-api.js";
import { UIController } from "./ui-controller.js";

let api;
let uiController;

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING_STATE, {
    scope: "world",
    config: false,
    type: Object,
    default: {
      turn: 0,
      lights: {}
    }
  });

  game.settings.register(MODULE_ID, SETTING_DEBUG, {
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    name: "Enable FoF debug logging",
    hint: "When enabled, prints structured logs to browser console."
  });
});

Hooks.once("ready", () => {
  api = new FoFClockAPI();
  uiController = new UIController(api);

  game.modules.get(MODULE_ID).api = api;
  debugLog("ready", { state: api.getState() });
});

Hooks.on("getSceneControlButtons", (controls) => {
  uiController?.addSceneControl(controls);
});

Hooks.on("canvasReady", async (canvasRef) => {
  if (!api || !canvasRef?.scene) return;
  await LightManager.syncSceneLights(api.getState(), canvasRef.scene);
  debugLog("canvas-ready-sync", { sceneId: canvasRef.scene.id });
});

Hooks.on("createToken", async (tokenDoc) => {
  if (!api) return;
  const state = api.getState();
  const actorMatches = Object.values(state.lights).filter((l) => !l.tokenId && l.actorId && l.actorId === tokenDoc.actorId && l.sceneId === tokenDoc.parent?.id);
  if (!actorMatches.length) return;

  for (const light of actorMatches) {
    await api.patchLight(light.id, {
      ...light,
      tokenId: tokenDoc.id,
      position: null,
      ambientLightId: null
    });
  }
  await LightManager.syncSceneLights(api.getState(), tokenDoc.parent);
});

Hooks.on("updateToken", async (tokenDoc, change) => {
  if (!api || !tokenDoc.parent) return;
  if (change.x === undefined && change.y === undefined) return;

  const state = api.getState();
  const dropped = Object.values(state.lights).filter((l) => !l.tokenId && l.sceneId === tokenDoc.parent.id);
  if (!dropped.length) return;

  debugLog("update-token", { tokenId: tokenDoc.id, sceneId: tokenDoc.parent.id, moved: { x: change.x, y: change.y } });
});

Hooks.on("deleteToken", async (tokenDoc) => {
  if (!api) return;
  await LightManager.onTokenDeleted(tokenDoc);
  await LightManager.syncSceneLights(api.getState(), tokenDoc.parent);
});

Hooks.on(`${MODULE_ID}.timeAdvanced`, () => {
  uiController?.app?.render(false);
});
