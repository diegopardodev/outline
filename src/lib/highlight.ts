import { highlightCode } from "@lezer/highlight";
import { describeFence } from "./languages";
import { highlight } from "../editor/theme";

export async function highlightBlocks(root: HTMLElement, alive: () => boolean) {
  const blocks = root.querySelectorAll<HTMLElement>("pre code[class*='language-']");
  for (const code of blocks) {
    const lang = /language-([\w+#-]+)/.exec(code.className)?.[1];
    const desc = lang ? describeFence(lang) : null;
    if (!desc) continue;
    const support = await desc.load().catch(() => null);
    if (!support || !alive()) return;
    const text = code.textContent ?? "";
    const tree = support.language.parser.parse(text);
    const frag = document.createDocumentFragment();
    highlightCode(
      text,
      tree,
      highlight,
      (chunk, classes) => {
        if (!classes) frag.appendChild(document.createTextNode(chunk));
        else {
          const span = document.createElement("span");
          span.className = classes;
          span.textContent = chunk;
          frag.appendChild(span);
        }
      },
      () => frag.appendChild(document.createTextNode("\n")),
    );
    code.replaceChildren(frag);
  }
}
