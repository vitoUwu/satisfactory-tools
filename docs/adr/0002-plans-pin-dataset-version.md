# Plans pin the Game Dataset version they were built against

When the game updates, recipes get rebalanced or removed, which would silently change a saved Plan's flows or break its nodes on load. Each Plan therefore stores and keeps computing against the dataset version it was created with, until the user runs an explicit Plan Migration to a newer version (changed ratios recompute; removed references flag nodes as broken).

## Consequences

- Every released Game Dataset version stays available in the app, not just the latest.
- "Up to date with the game" is a per-Plan property, achieved through migration, not automatic.
