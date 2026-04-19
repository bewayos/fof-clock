import { MODULE_ID, SETTING_DEBUG, SETTING_STATE } from "./constants.js";
import { LightManager } from "./light-manager.js";
import { debugLog, isDebugEnabled, warnLog } from "./logger.js";
import { FoFClockAPI } from "./module-api.js";
import { UIController } from "./ui-controller.js";

let api;
let uiController;
const sceneSyncTimers = new Map();

function logDebugGroup(message, payload = null) {
  if (!isDebugEnabled()) return;
  console.group("FOF CLOCK");
  console.log(message);
  if (payload !== null) console.log(payload);
  console.groupEnd();
}

function scheduleSceneSync(scene, delay = 150) {
  if (!scene?.id || !api) return;

  const existing = sceneSyncTimers.get(scene.id);
  if (existing) clearTimeout(existing);

  const timeoutId = setTimeout(async () => {
    sceneSyncTimers.delete(scene.id);
    try {
      await LightManager.syncSceneLights(api.getState(), scene);
      logDebugGroup("light change: debounced scene sync", { sceneId: scene.id });
    } catch (error) {
      warnLog("scene-sync-failed", { sceneId: scene.id, error: error?.message ?? error });
    }
  }, delay);

  sceneSyncTimers.set(scene.id, timeoutId);
}

async function ensureAccessMacro() {
  if (!game.user?.isGM) return;

  const name = "FoF Clock UI";
  const command = "game.fofClock.openUI()";

  let macro = game.macros.find((m) => m.name === name && m.type === "script");
  if (!macro) {
    macro = await Macro.create({
      name,
      type: "script",
      img: "icons/svg/clockwork.svg",
      command,
      scope: "global"
    });
    logDebugGroup("light change: created access macro", { macroId: macro?.id });
  } else if (macro.command !== command) {
    await macro.update({ command, type: "script" });
    logDebugGroup("light change: updated access macro", { macroId: macro.id });
  }

  if (!macro) return;

  const assignedSlots = Object.entries(game.user.hotbar ?? {})
    .filter(([, macroId]) => macroId === macro.id)
    .map(([slot]) => Number(slot));

  if (assignedSlots.length) return;

  const firstOpenSlot = Array.from({ length: 50 }, (_, i) => i + 1).find((slot) => !game.user.hotbar?.[slot]);
  if (firstOpenSlot) {
    await game.user.assignHotbarMacro(macro, firstOpenSlot);
    logDebugGroup("light change: assigned macro to hotbar", { slot: firstOpenSlot, macroId: macro.id });
  }
}

function ensureSidebarButton(app, html) {
  if (!game.user?.isGM) return;
  const tabName = app?.tabName ?? app?.options?.id;
  if (tabName !== "settings") return;

  if (html.find(".fof-clock-sidebar-button").length) return;

  const button = $(`
    <button type="button" class="fof-clock-sidebar-button">
      <i class="fas fa-clock"></i>
      <span>FoF Clock</span>
    </button>
  `);

  button.on("click", () => game.fofClock?.openUI());

  const actions = html.find(".settings-actions, .directory-footer").first();
  if (actions.length) {
    actions.append(button);
  } else {
    html.append(button);
  }
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

Hooks.once("ready", async () => {
  api = new FoFClockAPI();
  uiController = new UIController(api);
  game.modules.get(MODULE_ID).api = api;

  game.fofClock = {
    ...(game.fofClock ?? {}),
    api,
    openUI: () => uiController.openUI()
  };

  await ensureAccessMacro();
  debugLog("ready", { state: api.getState() });
});

Hooks.on("getSceneControlButtons", (controls) => {
  logDebugGroup("light change: getSceneControlButtons", controls.map((c) => c.name));
  uiController?.addSceneControl(controls);
});

Hooks.on("renderSidebarTab", (app, html) => {
  ensureSidebarButton(app, html);
});

Hooks.on("canvasReady", async (canvasRef) => {
  if (!api || !canvasRef?.scene) return;
  await LightManager.syncSceneLights(api.getState(), canvasRef.scene);
  logDebugGroup("light change: canvas ready sync", { sceneId: canvasRef.scene.id });
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

  scheduleSceneSync(tokenDoc.parent);
});

Hooks.on("updateToken", (tokenDoc, change) => {
  if (!api || !tokenDoc?.parent) return;
  if (change.x === undefined && change.y === undefined) return;

  scheduleSceneSync(tokenDoc.parent);
});

Hooks.on("deleteToken", async (tokenDoc) => {
  if (!api || !tokenDoc?.parent) return;
  const state = api.getState();
  const carried = Object.values(state.lights).filter((l) => l.sceneId === tokenDoc.parent.id && l.tokenId === tokenDoc.id);
  for (const light of carried) {
    await api.patchLight(light.id, LightManager.onTokenDeletedPatch(light, tokenDoc));
  }

  scheduleSceneSync(tokenDoc.parent);
});

Hooks.on(`${MODULE_ID}.timeAdvanced`, ({ amount } = {}) => {
  logDebugGroup("time advance", { amount });
  uiController?.app?.safeRender();
});
