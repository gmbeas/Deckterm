// Atajos configurables: "Ctrl+Shift+T" -> función que matchea un KeyboardEvent.

export type Action =
  | "newTab" | "closeTab" | "nextTab" | "prevTab" | "openSettings"
  | "copy" | "paste" | "zoomIn" | "zoomOut";

type Matcher = (e: KeyboardEvent) => boolean;

function parse(combo: string): Matcher {
  const parts = combo.toLowerCase().split("+").map((s) => s.trim());
  // "Ctrl+=" se parte en ["ctrl", "="] y "Ctrl++" en ["ctrl","",""]
  const key = parts[parts.length - 1] || "+";
  const ctrl = parts.includes("ctrl");
  const shift = parts.includes("shift");
  const alt = parts.includes("alt");
  const meta = parts.includes("cmd") || parts.includes("meta");
  return (e) =>
    e.ctrlKey === ctrl && e.shiftKey === shift && e.altKey === alt && e.metaKey === meta &&
    (e.key.toLowerCase() === key || e.code.toLowerCase() === key || (key === "tab" && e.key === "Tab"));
}

export class Keymap {
  private list: [Action, Matcher][] = [];
  constructor(bindings: Record<string, string>) { this.set(bindings); }
  set(bindings: Record<string, string>) {
    this.list = Object.entries(bindings).map(([a, c]) => [a as Action, parse(c)]);
  }
  match(e: KeyboardEvent): Action | null {
    if (e.type !== "keydown") return null;
    for (const [a, m] of this.list) if (m(e)) return a;
    return null;
  }
}
