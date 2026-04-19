import { LIGHT_PHASES, TURN_MINUTES } from "./constants.js";

export class TimeManager {
  static derive(turn) {
    const totalMinutes = Math.max(0, Number(turn || 0)) * TURN_MINUTES;
    const day = Math.floor(totalMinutes / (24 * 60)) + 1;
    const minuteOfDay = totalMinutes % (24 * 60);
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;

    const phase = LIGHT_PHASES.find((p) => hour >= p.startHour && hour < p.endHour)?.id ?? "night";

    return {
      totalTurns: Number(turn || 0),
      day,
      hour,
      minute,
      phase
    };
  }

  static formatClock(turn) {
    const info = this.derive(turn);
    const hh = String(info.hour).padStart(2, "0");
    const mm = String(info.minute).padStart(2, "0");
    return `Day ${info.day} ${hh}:${mm} (${info.phase})`;
  }
}
