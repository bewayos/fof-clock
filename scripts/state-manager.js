import { MODULE_ID, SETTING_STATE } from "./constants.js";

export class StateManager {
  static getState() {
    const state = game.settings.get(MODULE_ID, SETTING_STATE);
    return {
      turn: Number(state?.turn ?? 0),
      lights: { ...(state?.lights ?? {}) }
    };
  }

  static async setState(nextState) {
    const frozen = {
      turn: Number(nextState?.turn ?? 0),
      lights: { ...(nextState?.lights ?? {}) }
    };
    await game.settings.set(MODULE_ID, SETTING_STATE, frozen);
    return frozen;
  }

  static async updateState(updater) {
    const prev = this.getState();
    const next = updater(prev);
    return this.setState(next);
  }
}
