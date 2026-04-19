# FoF Clock & Light Tracker (Foundry VTT v13)

A production-style module (not macro bundle) for expedition-time pressure:

- Global dungeon turn clock (`1 turn = 10 minutes`)
- Persistent world-level light registry
- Carried and dropped lights across scenes
- Time advancement and automatic burn-down
- GM warnings at 1 turn remaining

## Install

1. Copy this folder into your Foundry data path under:
   - `Data/modules/fofClock`
2. Ensure `module.json` is inside that folder.
3. In Foundry, go to **Add-on Modules** and enable **FoF Clock & Light Tracker** for your world.

## Usage

1. Open **Token Controls** and click the **hourglass icon** to open FoF Clock.
2. Select a token.
3. Ignite a light (Torch/Lantern/Candle).
4. Advance time with `+1/+5/+10` turns.
5. Drop/Pickup torches as needed.

## Architecture

- `scripts/main.js`: module bootstrap + hooks
- `scripts/state-manager.js`: immutable world state read/write
- `scripts/time-manager.js`: turn → day/hour/minute/phase derivation
- `scripts/light-manager.js`: carried/dropped light sync + lifecycle
- `scripts/module-api.js`: all gameplay actions, including `advanceTime(turns)`
- `scripts/ui-controller.js`: control button + application UI

## Data Model

World setting key: `game.settings.register("fofClock", "state", ...)`

```js
{
  turn: 0,
  lights: {
    [id]: {
      id,
      type,
      remainingTurns,
      sceneId,
      tokenId,
      actorId,
      position,
      createdAtTurn,
      ambientLightId
    }
  }
}
```

## Notes

- Source of truth is world setting state (not token flags).
- Updates are immutable.
- Scene restoration runs on `canvasReady` and token hooks.
