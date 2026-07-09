/**
 * Renders a game icon (item or building) by className, falling back to a neutral
 * industrial square when the icon pack has no match. Icons come from
 * {@link getItemIcon} (owned by a parallel agent), served under `/game-icons/`.
 */

import { cn } from "@satisfactory-tools/ui/lib/utils";
import { Box } from "lucide-react";
import { useState } from "react";

import { getItemIcon } from "@/lib/game-icons";

export function ItemIcon({
  slug,
  alt,
  className,
}: {
  slug: string;
  alt?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = slug ? getItemIcon(slug) : "";

  if (!src || failed) {
    return (
      <span
        className={cn(
          "flex items-center justify-center border border-border bg-muted/50 text-muted-foreground",
          className,
        )}
        aria-label={alt}
      >
        <Box className="size-1/2" />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt ?? slug}
      draggable={false}
      onError={() => setFailed(true)}
      className={cn("object-contain", className)}
    />
  );
}
