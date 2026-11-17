export const fontCandidates = [
  "Berkeley Mono",
  "Ioskeley Mono",
  "System Mono",
  "JetBrains Mono",
  "Menlo",
  "Monaco",
  "Fira Code",
  "Geist Mono",
  "IBM Plex Mono",
  "Cascadia Code",
  "Source Code Pro",
  "Commit Mono",
  "Monaspace Neon",
  "Iosevka",
  "Hack",
  "Victor Mono",
  "Martian Mono",
  "Atkinson Hyperlegible Mono",
  "Input Mono",
  "MonoLisa",
  "Operator Mono",
  "Courier New",
];

let canvas: CanvasRenderingContext2D | null = null;
const sample = "mmmmmmmmmlli10OO@#WWww";

function width(font: string) {
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas) return 0;
  canvas.font = `40px ${font}`;
  return canvas.measureText(sample).width;
}

export const SYSTEM_MONO = "System Mono";

export function isInstalled(name: string) {
  if (name === SYSTEM_MONO) return true;
  const quoted = `"${name.replace(/"/g, "")}"`;
  return width(`${quoted}, monospace`) !== width("monospace") || width(`${quoted}, serif`) !== width("serif");
}

export function fontStack(name: string) {
  if (name === SYSTEM_MONO) return "ui-monospace, Menlo, monospace";
  return `"${name.replace(/"/g, "")}", ui-monospace, Menlo, monospace`;
}
