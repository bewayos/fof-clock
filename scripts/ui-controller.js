import { LIGHT_TYPES, MODULE_ID } from "./constants.js";
import { TimeManager } from "./time-manager.js";

export class FoFClockApp extends Application {
  constructor(api, options = {}) {
    super(options);
    this.api = api;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "fof-clock-app",
      classes: ["fof-clock"],
      title: "FoF Clock",
      template: `modules/${MODULE_ID}/templates/fof-clock-app.hbs`,
      width: 340,
      height: "auto",
      resizable: true
    });
  }

  getData() {
    const state = this.api.getState();
    const time = TimeManager.derive(state.turn);
    const selected = canvas?.tokens?.controlled?.[0] ?? null;

    return {
      turn: state.turn,
      clockLabel: TimeManager.formatClock(state.turn),
      time,
      lightTypes: Object.values(LIGHT_TYPES),
      selectedTokenName: selected?.name ?? "(none)",
      droppedCount: Object.values(state.lights).filter((l) => !l.tokenId).length,
      carriedCount: Object.values(state.lights).filter((l) => !!l.tokenId).length
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("[data-action='advance']").on("click", async (event) => {
      const turns = Number(event.currentTarget.dataset.turns || 1);
      await this.api.advanceTime(turns);
      this.render(true);
    });

    html.find("[data-action='ignite']").on("click", async (event) => {
      const type = event.currentTarget.dataset.type;
      const token = canvas?.tokens?.controlled?.[0]?.document;
      if (!token) return ui.notifications.warn("Select a token first");
      await this.api.createCarriedLight(token, type);
      this.render(true);
    });

    html.find("[data-action='extinguish']").on("click", async () => {
      const token = canvas?.tokens?.controlled?.[0]?.document;
      if (!token) return ui.notifications.warn("Select a token first");
      await this.api.extinguishSelected(token);
      this.render(true);
    });

    html.find("[data-action='drop']").on("click", async () => {
      const token = canvas?.tokens?.controlled?.[0]?.document;
      if (!token) return ui.notifications.warn("Select a token first");
      await this.api.dropSelectedLight(token);
      this.render(true);
    });

    html.find("[data-action='pickup']").on("click", async () => {
      const token = canvas?.tokens?.controlled?.[0]?.document;
      if (!token) return ui.notifications.warn("Select a token first");
      await this.api.pickUpNearestDroppedLight(token);
      this.render(true);
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

    tokenControls.tools.push({
      name: "fof-clock-open",
      title: "FoF Clock",
      icon: "fas fa-hourglass-half",
      button: true,
      onClick: () => this.app.render(true)
    });
  }
}
