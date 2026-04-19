import { MODULE_ID, SETTING_DEBUG } from "./constants.js";

export function debugLog(event, payload = {}) {
  const enabled = game.settings.get(MODULE_ID, SETTING_DEBUG);
  if (!enabled) return;
  console.log(`[${MODULE_ID}]`, { event, ...payload });
}

export function warnLog(event, payload = {}) {
  console.warn(`[${MODULE_ID}]`, { event, ...payload });
}
