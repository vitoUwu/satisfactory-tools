/**
 * Renders children only after mount. React Flow measures the DOM, so the canvas
 * must never render during TanStack Start's SSR pass.
 */

import { useEffect, useState, type ReactNode } from "react";

export function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <>{mounted ? children : fallback}</>;
}
