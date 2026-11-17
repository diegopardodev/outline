export type DiffSide = "work" | "staged";

const PREFIX = "diff:";

export const diffPath = (path: string, side: DiffSide) => `${PREFIX}${side}:${path}`;

export function parseDiffPath(tab: string): { side: DiffSide; path: string } | null {
  if (!tab.startsWith(PREFIX)) return null;
  const rest = tab.slice(PREFIX.length);
  const cut = rest.indexOf(":");
  if (cut < 0) return null;
  const side = rest.slice(0, cut);
  if (side !== "work" && side !== "staged") return null;
  return { side, path: rest.slice(cut + 1) };
}

export const isDiffPath = (tab: string) => tab.startsWith(PREFIX);
