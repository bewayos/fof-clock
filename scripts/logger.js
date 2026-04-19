import { MODULE_ID, SETTING_DEBUG } from "./constants.js";

export function isDebugEnabled() {
  return !!game.settings.get(MODULE_ID, SETTING_DEBUG);
}

export function debugLog(event, payload = {}) {
  if (!isDebugEnabled()) return;
  console.group("FOF CLOCK");
  console.log(event);
  Object.entries(payload).forEach(([key, value]) => console.log(key, value));
  console.groupEnd();
}

export function debugStateTransition(event, beforeState, afterState, meta = {}) {
  if (!isDebugEnabled()) return;
  console.group("FOF CLOCK");
  console.log(event);
  console.log("before", beforeState);
  console.log("after", afterState);
  if (meta && Object.keys(meta).length) console.log("meta", meta);
  console.groupEnd();
}

export function warnLog(event, payload = {}, always = false) {
  if (!always && !isDebugEnabled()) return;
  console.group("FOF CLOCK");
  console.warn(`[${MODULE_ID}] ${event}`, payload);
  console.groupEnd();
}
