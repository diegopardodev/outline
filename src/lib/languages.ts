import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { basename } from "./fs";

const extra: LanguageDescription[] = [
  LanguageDescription.of({
    name: "Dotenv",
    filename: /^\.env(\..*)?$/,
    load: async () => {
      const { properties } = await import("@codemirror/legacy-modes/mode/properties");
      return new LanguageSupport(StreamLanguage.define(properties));
    },
  }),
];

const all = [...extra, ...languages];

const aliases: Record<string, string> = {
  mjs: "js",
  cjs: "js",
  mts: "ts",
  cts: "ts",
};

export function describe(path: string): LanguageDescription | null {
  const name = basename(path);
  const byName = LanguageDescription.matchFilename(all, name);
  if (byName) return byName;
  const ext = name.split(".").pop() ?? "";
  const alias = aliases[ext];
  return alias ? LanguageDescription.matchFilename(all, `x.${alias}`) : null;
}

export function languageName(path: string | null): string {
  if (!path) return "";
  return describe(path)?.name ?? "Plain Text";
}

export function describeFence(lang: string): LanguageDescription | null {
  const name = lang.trim().toLowerCase();
  if (!name) return null;
  return LanguageDescription.matchLanguageName(all, name, true) ?? LanguageDescription.matchFilename(all, `x.${name}`);
}
