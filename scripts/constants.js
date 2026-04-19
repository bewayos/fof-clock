export const MODULE_ID = "fofClock";
export const SETTING_STATE = "state";
export const SETTING_DEBUG = "debug";

export const TURN_MINUTES = 10;

export const LIGHT_TYPES = Object.freeze({
  torch: Object.freeze({ id: "torch", name: "Torch", durationTurns: 6, dim: 20, bright: 10, color: "#ffb347", alpha: 0.35 }),
  lantern: Object.freeze({ id: "lantern", name: "Lantern", durationTurns: 36, dim: 40, bright: 20, color: "#ffd27f", alpha: 0.45 }),
  candle: Object.freeze({ id: "candle", name: "Candle", durationTurns: 3, dim: 10, bright: 5, color: "#ffe0a3", alpha: 0.25 })
});

export const LIGHT_PHASES = Object.freeze([
  { id: "night", startHour: 0, endHour: 6 },
  { id: "morning", startHour: 6, endHour: 10 },
  { id: "day", startHour: 10, endHour: 18 },
  { id: "evening", startHour: 18, endHour: 22 },
  { id: "night", startHour: 22, endHour: 24 }
]);

export const TOKEN_LIGHT_FLAG = "activeLightId";
