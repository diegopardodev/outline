import { snippet, type Completion, type CompletionSource } from "@codemirror/autocomplete";
import { Facet } from "@codemirror/state";

export const docPath = Facet.define<string, string>({ combine: (values) => values[0] ?? "" });

type Snippet = {
  prefix: string;
  description: string;
  extensions: string[];
  body: (name: string) => string;
};

const reactFiles = ["tsx", "jsx", "js"];

const snippets: Snippet[] = [
  {
    prefix: "rfc",
    description: "React function component",
    extensions: reactFiles,
    body: (name) => `export default function \${1:${name}}() {\n\treturn <div>\${2}</div>;\n}\n`,
  },
];

function componentName(path: string) {
  const parts = path.split("/");
  let base = (parts.pop() ?? "").replace(/\.[^.]+$/, "");
  if (base === "index" || base === "page" || base === "layout") base = parts.pop() ?? base;
  const words = base.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  if (!name) return "Component";
  return /^[0-9]/.test(name) ? `Component${name}` : name;
}

export const snippetCompletionSource: CompletionSource = (ctx) => {
  const path = ctx.state.facet(docPath);
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const available = snippets.filter((s) => s.extensions.includes(ext));
  if (!available.length) return null;
  const word = ctx.matchBefore(/[A-Za-z]+$/);
  if (!word && !ctx.explicit) return null;
  const typed = word?.text ?? "";
  const options: Completion[] = available
    .filter((s) => s.prefix.startsWith(typed))
    .map((s) => ({
      label: s.prefix,
      detail: s.description,
      type: "snippet",
      boost: 99,
      apply: snippet(s.body(componentName(path))),
    }));
  if (!options.length) return null;
  return { from: word ? word.from : ctx.pos, options, validFor: /^[A-Za-z]*$/ };
};
