import { MODULE_ID, SETTING_DEBUG, SETTING_STATE } from "./constants.js";
import { LightManager } from "./light-manager.js";
import { debugLog } from "./logger.js";
import { FoFClockAPI } from "./module-api.js";
import { UIController } from "./ui-controller.js";

let api;
let uiController;

function injectFallbackTokenTool(controls) {
  const tokenControls = controls.find((c) => c.name === "token");
  if (!tokenControls) {
    console.log("FOF: token controls group not found");
    return false;
  }

  if (tokenControls.tools.some((t) => t.name === "fof-test")) {
    console.log("FOF: fallback tool already present");
    return true;
  }

  tokenControls.tools.push({
    name: "fof-test",
    title: "FoF TEST",
    icon: "fas fa-bug",
    button: true,
    onClick: () => console.log("FOF TEST CLICK")
  });

  console.log("FOF: fallback tool injected into token controls");
  return true;
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING_STATE, {
    scope: "world",
    config: false,
    type: Object,
    default: { turn: 0, lights: {} }
  });

  game.settings.register(MODULE_ID, SETTING_DEBUG, {
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    name: "Enable FoF debug logging",
    hint: "Structured state/light logs + debug panel in FoF Clock UI."
  });
});

Hooks.once("ready", () => {
  api = new FoFClockAPI();
  uiController = new UIController(api);
  game.modules.get(MODULE_ID).api = api;

  game.fofClock = {
    ...(game.fofClock ?? {}),
    api,
    openUI: () => {
      debugLog("fallback-openUI", { source: "game.fofClock.openUI" });
      uiController.openUI();
    }
  };

  debugLog("ready", { state: api.getState() });
});

Hooks.on("getSceneControlButtons", (controls) => {
  console.log("FOF: getSceneControlButtons fired", controls);
  debugLog("register-scene-controls", { controlGroups: controls.map((c) => c.name) });

  if (!game.user?.isGM) {
    console.log("FOF: scene controls skipped (non-GM user)");
    return;
  }

  console.log("FOF: injecting controls");
  const added = uiController?.addSceneControl(controls) ?? false;

  if (!added) {
    console.log("FOF: primary control injection failed, trying token tool fallback");
    injectFallbackTokenTool(controls);
  }
});

Hooks.on("canvasReady", async (canvasRef) => {
  if (!api || !canvasRef?.scene) return;
  await LightManager.syncSceneLights(api.getState(), canvasRef.scene);
  debugLog("canvasReady-sync", { sceneId: canvasRef.scene.id });
});

Hooks.on("createToken", async (tokenDoc) => {
  if (!api || !tokenDoc?.parent) return;

  const state = api.getState();
  const actorMatches = Object.values(state.lights).filter((l) => l.sceneId === tokenDoc.parent.id && !l.tokenId && l.actorId && l.actorId === tokenDoc.actorId);
  if (!actorMatches.length) return;

  for (const light of actorMatches) {
    await api.patchLight(light.id, {
      tokenId: tokenDoc.id,
      actorId: tokenDoc.actorId ?? light.actorId,
      position: null,
      ambientLightId: null
    });
  }

  await LightManager.syncSceneLights(api.getState(), tokenDoc.parent);
});

Hooks.on("updateToken", async (tokenDoc, change) => {
  if (!api || !tokenDoc?.parent) return;
  if (change.x === undefined && change.y === undefined) return;

  await LightManager.syncSceneLights(api.getState(), tokenDoc.parent);
});

Hooks.on("deleteToken", async (tokenDoc) => {
  if (!api || !tokenDoc?.parent) return;
  const state = api.getState();
  const carried = Object.values(state.lights).filter((l) => l.sceneId === tokenDoc.parent.id && l.tokenId === tokenDoc.id);
  for (const light of carried) {
    await api.patchLight(light.id, LightManager.onTokenDeletedPatch(light, tokenDoc));
  }
  await LightManager.syncSceneLights(api.getState(), tokenDoc.parent);
});

Hooks.on(`${MODULE_ID}.timeAdvanced`, () => uiController?.app?.safeRender());
