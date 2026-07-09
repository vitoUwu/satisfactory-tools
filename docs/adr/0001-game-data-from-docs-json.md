# Game data is parsed from the game's Docs.json into static datasets

We need accurate, current (1.2) recipes, items, and buildings. Rather than depending on a community dataset's update cadence or hand-curating hundreds of recipes in the DB, a parse script converts the official `Docs.json` dump (shipped with the game in `CommunityResources`) into a static, typed Game Dataset checked into the repo. Updating to a new game version means re-running the script against the new dump. Icons are not in the dump; they come from a community icon pack (personal, non-commercial use).

## Considered Options

- Reuse a community dataset (e.g. greeny/SatisfactoryTools export) — rejected: downstream of someone else's update schedule.
- Hand-curate in the DB — rejected: hundreds of recipes to maintain, easy to drift from the game.
