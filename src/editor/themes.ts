export type Palette = {
  keyword: string;
  type: string;
  string: string;
  number: string;
  comment: string;
  function: string;
  variable: string;
  link: string;
  attribute?: string;
  preprocessor?: string;
};

export type ColorTheme = { id: string; name: string; palette: Palette; dark?: Palette };

export const colorThemes: ColorTheme[] = [
  {
    id: "one",
    name: "Atom One",
    dark: { keyword: "#c678dd", type: "#e5c07b", string: "#98c379", number: "#d19a66", comment: "#7f848e", function: "#61afef", variable: "#e06c75", link: "#56b6c2" },
    palette: { keyword: "#a626a4", type: "#c18401", string: "#50a14f", number: "#986801", comment: "#a0a1a7", function: "#4078f2", variable: "#e45649", link: "#0184bc" },
  },
  {
    id: "github",
    name: "GitHub",
    dark: { keyword: "#ff7b72", type: "#ffa657", string: "#a5d6ff", number: "#79c0ff", comment: "#8b949e", function: "#d2a8ff", variable: "#7ee787", link: "#58a6ff" },
    palette: { keyword: "#cf222e", type: "#953800", string: "#0a3069", number: "#0550ae", comment: "#6e7781", function: "#8250df", variable: "#116329", link: "#0969da" },
  },
  {
    id: "xcode",
    name: "Xcode",
    dark: { keyword: "#fc5fa3", type: "#d0a8ff", string: "#fc6a5d", number: "#d0bf69", comment: "#7f8c98", function: "#67b7a4", variable: "#5dd8ff", link: "#6699ff", attribute: "#fc5fa3", preprocessor: "#fd8f3f" },
    palette: {
      keyword: "#ac3261",
      type: "#853cc1",
      string: "#b33421",
      number: "#286dab",
      comment: "#606578",
      function: "#265c52",
      variable: "#2c7290",
      link: "#1146b3",
      attribute: "#ac3261",
      preprocessor: "#805f24",
    },
  },
  {
    id: "solarized",
    name: "Solarized",
    dark: { keyword: "#859900", type: "#b58900", string: "#2aa198", number: "#d33682", comment: "#657b83", function: "#268bd2", variable: "#cb4b16", link: "#6c71c4", preprocessor: "#cb4b16" },
    palette: {
      keyword: "#859900",
      type: "#b58900",
      string: "#2aa198",
      number: "#d33682",
      comment: "#93a1a1",
      function: "#268bd2",
      variable: "#cb4b16",
      link: "#6c71c4",
      preprocessor: "#cb4b16",
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    dark: { keyword: "#cba6f7", type: "#f9e2af", string: "#a6e3a1", number: "#fab387", comment: "#7f849c", function: "#89b4fa", variable: "#f38ba8", link: "#74c7ec", attribute: "#f9e2af", preprocessor: "#f5c2e7" },
    palette: {
      keyword: "#8839ef",
      type: "#df8e1d",
      string: "#40a02b",
      number: "#fe640b",
      comment: "#7c7f93",
      function: "#1e66f5",
      variable: "#e64553",
      link: "#209fb5",
      attribute: "#df8e1d",
      preprocessor: "#ea76cb",
    },
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    dark: { keyword: "#fb4934", type: "#fabd2f", string: "#b8bb26", number: "#d3869b", comment: "#928374", function: "#8ec07c", variable: "#83a598", link: "#83a598", attribute: "#fe8019", preprocessor: "#fe8019" },
    palette: {
      keyword: "#9d0006",
      type: "#b57614",
      string: "#79740e",
      number: "#8f3f71",
      comment: "#928374",
      function: "#427b58",
      variable: "#076678",
      link: "#076678",
      attribute: "#af3a03",
      preprocessor: "#af3a03",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    dark: { keyword: "#bb9af7", type: "#2ac3de", string: "#9ece6a", number: "#ff9e64", comment: "#6a73a0", function: "#7aa2f7", variable: "#f7768e", link: "#2ac3de", attribute: "#e0af68" },
    palette: {
      keyword: "#9854f1",
      type: "#007197",
      string: "#587539",
      number: "#b15c00",
      comment: "#848cb5",
      function: "#2e7de9",
      variable: "#f52a65",
      link: "#007197",
      attribute: "#8c6c3e",
    },
  },
  {
    id: "rose-pine",
    name: "Rosé Pine",
    dark: { keyword: "#3e8fb0", type: "#9ccfd8", string: "#f6c177", number: "#eb6f92", comment: "#6e6a86", function: "#ea9a97", variable: "#c4a7e7", link: "#9ccfd8" },
    palette: { keyword: "#286983", type: "#56949f", string: "#ea9d34", number: "#b4637a", comment: "#9893a5", function: "#d7827e", variable: "#907aa9", link: "#56949f" },
  },
  {
    id: "dracula",
    name: "Alucard",
    dark: { keyword: "#ff79c6", type: "#8be9fd", string: "#f1fa8c", number: "#bd93f9", comment: "#6272a4", function: "#50fa7b", variable: "#ffb86c", link: "#8be9fd" },
    palette: { keyword: "#a3144d", type: "#036a96", string: "#846e15", number: "#644ac9", comment: "#6c664b", function: "#14710a", variable: "#a34d14", link: "#036a96" },
  },
  {
    id: "pierre",
    name: "Pierre",
    dark: { keyword: "#ff678d", type: "#d568ea", string: "#5ecc71", number: "#68cdf2", comment: "#84848a", function: "#9d6afb", variable: "#ffa359", link: "#69b1ff", attribute: "#69b1ff" },
    palette: {
      keyword: "#d32a61",
      type: "#a631be",
      string: "#199f43",
      number: "#1ca1c7",
      comment: "#737373",
      function: "#693acf",
      variable: "#d47628",
      link: "#1a85d4",
      attribute: "#1a85d4",
    },
  },
];

export const defaultColorTheme = "one";

export function findTheme(id: string) {
  return colorThemes.find((t) => t.id === id) ?? colorThemes[0];
}

export function applyColorTheme(id: string) {
  const theme = findTheme(id);
  const dark = document.documentElement.dataset.theme === "dark";
  const p = dark && theme.dark ? theme.dark : theme.palette;
  const vars: Record<string, string> = {
    keyword: p.keyword,
    type: p.type,
    string: p.string,
    number: p.number,
    comment: p.comment,
    function: p.function,
    variable: p.variable,
    link: p.link,
    attribute: p.attribute ?? p.number,
    preprocessor: p.preprocessor ?? p.keyword,
  };
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(vars)) root.setProperty(`--tk-${k}`, v);
}
