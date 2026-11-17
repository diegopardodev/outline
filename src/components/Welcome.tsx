import { useStore } from "../store";
import { basename, tildify } from "../lib/fs";
import { openFolder, setRoot } from "../actions";
import { bindingLabel } from "../commands";

const shortcutIds: [string, string][] = [
  ["Go to File", "quick-open"],
  ["Commands", "commands"],
  ["Search in Project", "search"],
  ["Terminal", "terminal"],
  ["Toggle Sidebar", "toggle-sidebar"],
];

// Splits a label like "⇧⌘P" into one key cap per modifier plus the key itself.
const keyCaps = (label: string) => {
  const m = /^([⌃⌥⇧⌘]*)(.*)$/.exec(label.split(" ")[0])!;
  return [...m[1], m[2]].filter(Boolean);
};

export function Welcome() {
  const root = useStore((s) => s.root);
  const recents = useStore((s) => s.recents);
  const shortcuts = shortcutIds
    .map(([label, id]) => [label, keyCaps(bindingLabel(id) ?? "")] as const)
    .filter(([, keys]) => keys.length > 0);
  const openKeys = keyCaps(bindingLabel("open-folder") ?? "");

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="wordmark">
          outline<span>.</span>
        </div>
        {root ? (
          <div className="welcome-shortcuts">
            {shortcuts.map(([label, keys]) => (
              <div key={label} className="shortcut-row">
                <span>{label}</span>
                <span className="keys">
                  {keys.map((k, i) => (
                    <kbd key={i}>{k}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="welcome-start">
            <button className="primary-btn" onClick={openFolder}>
              Open Folder
              {openKeys.length > 0 && (
                <span className="keys">
                  {openKeys.map((k, i) => (
                    <kbd key={i}>{k}</kbd>
                  ))}
                </span>
              )}
            </button>
            {recents.length > 0 && (
              <div className="recents">
                <div className="section-label">Recent</div>
                {recents.map((r) => (
                  <button key={r} className="recent" onClick={() => setRoot(r)}>
                    <span className="recent-name">{basename(r)}</span>
                    <span className="recent-path">{tildify(r)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
