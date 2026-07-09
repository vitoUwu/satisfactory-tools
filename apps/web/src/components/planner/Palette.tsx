/**
 * Left palette: a searchable list of buildings grouped by category, plus the two
 * boundary node types. Entries are dragged onto the canvas (HTML5 drag-and-drop);
 * the canvas reads the payload on drop and creates the node at the cursor.
 */

import type { Building } from "@satisfactory-tools/game-data";
import { Input } from "@satisfactory-tools/ui/components/input";
import { ScrollArea } from "@satisfactory-tools/ui/components/scroll-area";
import { LogIn, LogOut } from "lucide-react";
import { useMemo, useState } from "react";

import { buildingCategory, CATEGORY_ORDER } from "./factory";
import { ItemIcon } from "./ItemIcon";
import { usePlanner } from "./PlannerContext";

/** Drag payload written to the dataTransfer during a palette drag. */
export type PaletteDrag =
  | { kind: "building"; className: string }
  | { kind: "planInput" }
  | { kind: "planOutput" };

export const PALETTE_MIME = "application/planner-node";

function DragItem({
  label,
  iconSlug,
  icon,
  payload,
}: {
  label: string;
  iconSlug?: string;
  icon?: React.ReactNode;
  payload: PaletteDrag;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PALETTE_MIME, JSON.stringify(payload));
        e.dataTransfer.effectAllowed = "move";
      }}
      className="flex cursor-grab items-center gap-2 border border-transparent px-2 py-1.5 text-xs hover:border-border hover:bg-accent/40 active:cursor-grabbing"
    >
      {iconSlug !== undefined ? (
        <ItemIcon slug={iconSlug} alt={label} className="size-5 shrink-0" />
      ) : (
        <span className="flex size-5 shrink-0 items-center justify-center text-primary">
          {icon}
        </span>
      )}
      <span className="truncate">{label}</span>
    </div>
  );
}

export function Palette() {
  const { dataset } = usePlanner();
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const buildings = Object.values(dataset.buildings).filter((b) =>
      q ? b.displayName.toLowerCase().includes(q) : true,
    );
    const map = new Map<string, Building[]>();
    for (const b of buildings) {
      const cat = buildingCategory(b);
      const list = map.get(cat) ?? [];
      list.push(b);
      map.set(cat, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
    return map;
  }, [dataset, query]);

  const q = query.trim().toLowerCase();
  const showBoundary =
    !q || "plan input".includes(q) || "plan output".includes(q);

  return (
    <div className="flex h-[calc(100vh-48px)] flex-col border-r border-border bg-sidebar">
      <div className="border-b border-border p-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search buildings…"
          className="h-8 text-xs"
        />
      </div>
      <ScrollArea className="h-[calc(100%-49px)]">
        <div className="p-2">
          {CATEGORY_ORDER.map((cat) => {
            if (cat === "Boundary") return null;
            const list = grouped.get(cat);
            if (!list || list.length === 0) return null;
            return (
              <div key={cat} className="mb-3">
                <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {cat}
                </div>
                {list.map((b) => (
                  <DragItem
                    key={b.className}
                    label={b.displayName}
                    iconSlug={b.className}
                    payload={{ kind: "building", className: b.className }}
                  />
                ))}
              </div>
            );
          })}
          {showBoundary && (
            <div className="mb-3">
              <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Boundary
              </div>
              <DragItem
                label="Plan Input"
                icon={<LogIn className="size-4" />}
                payload={{ kind: "planInput" }}
              />
              <DragItem
                label="Plan Output"
                icon={<LogOut className="size-4" />}
                payload={{ kind: "planOutput" }}
              />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
