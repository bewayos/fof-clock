# FoF Clock & Light Tracker (Foundry VTT v13)

Production-ready expedition time + light tracking module (no macro dependency).

## What’s new in this upgrade

- Hardened immutable state pipeline with validation + automatic repair on corrupted data.
- Warning dedupe (`warnedAtOneTurn`) to prevent repeated “almost burned out” spam.
- Actor fallback resolution when a light’s token is missing on a scene.
- Safer dropped light handling for manual deletion/scene switches.
- Expanded GM panel with light table, per-light actions, jump-to-owner, and debug section.
- Structured debug logs and state transition tracing.

## Install

1. Copy this folder into Foundry Data: `Data/modules/fofClock`
2. Ensure `module.json` exists in that folder.
3. Enable **FoF Clock & Light Tracker** in your world’s Add-on Modules.

## Manual migration note

No manual migration is required.
On first read/write, the module validates existing `fofClock.state` and automatically repairs invalid entries.

## Architecture

- `scripts/main.js`: hooks + bootstrap
- `scripts/state-manager.js`: state validation/repair + immutable persistence
- `scripts/time-manager.js`: turn clock math
- `scripts/light-manager.js`: all light lifecycle/sync logic
- `scripts/module-api.js`: game actions + orchestration
- `scripts/ui-controller.js`: application UI and interactions

## Debugging

Enable **Enable FoF debug logging** in module settings to get:

- grouped console logs (`FOF CLOCK :: ...`)
- before/after state transitions
- debug section in UI with raw state + mismatch warnings
