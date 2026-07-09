/**
 * Recipe Preferences editor (see CONTEXT.md). Lists every item the game can make
 * with more than one recipe and lets the user pick the recipe the Solver Assist
 * should use for it. The chosen map is lifted to {@link PlannerEditor} state and
 * persisted through the normal autosave (`savePlanGraph`'s `recipePreferences`).
 */

import type { DatasetIndex, Recipe } from "@satisfactory-tools/game-data";
import { recipesForProduct, standardRecipeFor } from "@satisfactory-tools/game-data";
import type { RecipePreferences } from "@satisfactory-tools/planner-engine";
import { Button } from "@satisfactory-tools/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@satisfactory-tools/ui/components/dialog";
import { SlidersHorizontal } from "lucide-react";
import { useMemo } from "react";

import { SimpleSelect } from "./controls";
import { ItemIcon } from "./ItemIcon";

interface MultiRecipeItem {
  itemClass: string;
  displayName: string;
  recipes: Recipe[];
  standardClass: string | undefined;
}

/** Items producible by more than one recipe, with their recipe list, sorted A→Z. */
function multiRecipeItems(dataset: DatasetIndex): MultiRecipeItem[] {
  const out: MultiRecipeItem[] = [];
  for (const item of Object.values(dataset.items)) {
    const recipes = recipesForProduct(dataset, item.className);
    if (recipes.length < 2) continue;
    out.push({
      itemClass: item.className,
      displayName: item.displayName,
      recipes: recipes
        .slice()
        .sort(
          (a, b) => Number(a.isAlternate) - Number(b.isAlternate) ||
            a.displayName.localeCompare(b.displayName),
        ),
      standardClass: standardRecipeFor(dataset, item.className)?.className,
    });
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function RecipePreferencesDialog({
  dataset,
  value,
  onChange,
}: {
  dataset: DatasetIndex;
  value: RecipePreferences;
  onChange: (next: RecipePreferences) => void;
}) {
  const items = useMemo(() => multiRecipeItems(dataset), [dataset]);

  const set = (itemClass: string, recipeClass: string, standard?: string) => {
    const next = { ...value };
    if (recipeClass === standard) delete next[itemClass];
    else next[itemClass] = recipeClass;
    onChange(next);
  };

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <SlidersHorizontal className="size-3.5" />
            Recipe Preferences
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Recipe Preferences</DialogTitle>
          <DialogDescription>
            Choose which recipe the Solver Assist uses for each item. Items with a
            single recipe are not listed.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col divide-y divide-border overflow-y-auto">
          {items.map((it) => {
            const current = value[it.itemClass] ?? it.standardClass ?? "";
            return (
              <div
                key={it.itemClass}
                className="flex items-center gap-3 py-2"
              >
                <ItemIcon slug={it.itemClass} className="size-6 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-xs">
                  {it.displayName}
                </span>
                <div className="w-56 shrink-0">
                  <SimpleSelect
                    value={current}
                    onValueChange={(recipeClass) =>
                      set(it.itemClass, recipeClass, it.standardClass)
                    }
                    options={it.recipes.map((r) => ({
                      value: r.className,
                      label: r.isAlternate ? `Alt: ${r.displayName}` : r.displayName,
                    }))}
                  />
                </div>
              </div>
            );
          })}
          {items.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No multi-recipe items in this dataset.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
