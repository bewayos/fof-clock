import { LIGHT_TYPES, MODULE_ID, SETTING_DEBUG } from "./constants.js";
import { TimeManager } from "./time-manager.js";

function debounce(fn, delay = 120) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

export class FoFClockApp extends Application {
  constructor(api, options = {}) {
    super(options);
    this.api = api;
    this.safeRender = debounce(() => this.render(false), 100);
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "fof-clock-app",
      classes: ["fof-clock"],
      title: "FoF Clock",
      template: `modules/${MODULE_ID}/templates/fof-clock-app.hbs`,
      width: 500,
      height: 650,
      resizable: true
    });
  }

  getData() {
    const state = this.api.getState();
    const time = TimeManager.derive(state.turn);
    const lights = Object.values(state.lights).sort((a, b) => a.remainingTurns - b.remainingTurns);
    const debug = game.settings.get(MODULE_ID, SETTING_DEBUG);

    const hydratedLights = lights.map((light) => {
      const scene = game.scenes.get(light.sceneId);
      const sceneName = scene?.name ?? "Unknown Scene";
      const ownerName = this.ownerLabel(light, scene);
      const mismatch = scene ? (light.tokenId && !scene.tokens.get(light.tokenId) && !scene.tokens.contents.find((t) => t.actorId === light.actorId)) : true;
      return {
        ...light,
        typeLabel: LIGHT_TYPES[light.type]?.name ?? light.type,
        ownerName,
        sceneName,
        mismatch
      };
    });

    const debugWarnings = hydratedLights.filter((l) => l.mismatch).map((l) => `Missing token match for ${l.id} (${l.sceneName})`);

    return {
      turn: state.turn,
      clockLabel: TimeManager.formatClock(state.turn),
      time,
      lightTypes: Object.values(LIGHT_TYPES),
      selectedTokenName: canvas?.tokens?.controlled?.[0]?.name ?? "(none)",
      lights: hydratedLights,
      debug,
      debugWarnings,
      rawState: JSON.stringify(state, null, 2)
    };
  }

  ownerLabel(light, scene) {
    const token = light.tokenId ? scene?.tokens?.get(light.tokenId) : null;
    if (token) return token.name;
    if (light.actorId) {
      const actor = game.actors.get(light.actorId);
      if (actor) return `${actor.name} (actor fallback)`;
    }
    return light.position ? "Dropped" : "Unresolved";
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("[data-action='advance']").on("click", async (event) => {
      await this.api.advanceTime(Number(event.currentTarget.dataset.turns || 1));
      this.safeRender();
    });

    html.find("[data-action='ignite']").on("click", async (event) => {
      const token = canvas?.tokens?.controlled?.[0]?.document;
      if (!token) return ui.notifications.warn("Select a token first");
      await this.api.createCarriedLight(token, event.currentTarget.dataset.type);
      this.safeRender();
    });

    html.find("[data-action='drop']").on("click", async () => {
      const token = canvas?.tokens?.controlled?.[0]?.document;
      if (!token) return ui.notifications.warn("Select a token first");
      await this.api.dropSelectedLight(token);
      this.safeRender();
    });

    html.find("[data-action='pickup']").on("click", async () => {
      const token = canvas?.tokens?.controlled?.[0]?.document;
      if (!token) return ui.notifications.warn("Select a token first");
      await this.api.pickUpNearestDroppedLight(token);
      this.safeRender();
    });

    html.find("[data-action='extinguish-id']").on("click", async (event) => {
      await this.api.extinguishById(event.currentTarget.dataset.lightId);
      this.safeRender();
    });

    html.find("[data-action='jump-token']").on("click", async (event) => {
      await this.api.jumpToLightToken(event.currentTarget.dataset.lightId);
    });
  }
}

export class UIController {
  constructor(api) {
    this.api = api;
    this.app = new FoFClockApp(api);
  }

  addSceneControl(controls) {
    if (!game.user.isGM) return;
    const tokenControls = controls.find((c) => c.name === "token");
    if (!tokenControls) return;

    if (tokenControls.tools.some((t) => t.name === "fof-clock-open")) return;
    tokenControls.tools.push({
      name: "fof-clock-open",
      title: "FoF Clock",
      icon: "fas fa-hourglass-half",
      button: true,
      onClick: () => this.app.render(true)
    });
  }
}
