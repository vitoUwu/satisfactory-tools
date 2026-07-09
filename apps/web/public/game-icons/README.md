# Game Icons

Satisfactory item, resource, and building icons (64px PNG) for the Planner UI.

- **Source:** community icon set from [greeny/SatisfactoryTools](https://github.com/greeny/SatisfactoryTools)
  (`www/assets/images/items`), which in turn derives from the game's own assets.
- **Game version:** 1.2.
- **Slugs:** filenames are kebab-case, derived from the in-game class name core
  (e.g. `Desc_OreIron_C` → `ore-iron.png`, `Build_SmelterMk1_C` → `smelter-mk1.png`).
  `_default.svg` is the fallback icon.
- **Mapping:** resolve a path with `getItemIcon()` from
  `apps/web/src/lib/game-icons.ts`, which accepts both Unreal class names
  (`Desc_*` / `Build_*`) and kebab slugs (game-internal like `ore-iron` and
  display-name aliases like `iron-ore`).

## Licensing

These icons are © Coffee Stain Studios and are used here for **personal,
non-commercial** use only. They are not covered by the repository's software
license. Do not redistribute commercially.

## Regenerating

Run `scratchpad/build-icons.ts` (Bun) against a `Docs.json` dump and a checkout
of the greeny icon set to re-copy icons and regenerate `game-icons.ts`.
