use crate::{err, walker};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_MATCHES: usize = 5_000;
const MAX_SEARCH_BYTES: u64 = 2 * 1024 * 1024;
const BEFORE_CHARS: usize = 40;
const AFTER_CHARS: usize = 160;

#[derive(Serialize)]
pub struct SearchMatch {
    line: u32,
    col: u32,
    len: u32,
    before: String,
    text: String,
    after: String,
}

#[derive(Serialize)]
pub struct SearchFile {
    path: String,
    matches: Vec<SearchMatch>,
}

#[derive(Serialize)]
pub struct SearchResult {
    files: Vec<SearchFile>,
    total: usize,
    truncated: bool,
}

fn tail(s: &str, n: usize) -> String {
    let count = s.chars().count();
    if count <= n {
        s.to_string()
    } else {
        let mut out = String::from("…");
        out.extend(s.chars().skip(count - n));
        out
    }
}

fn head(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn build_regex(query: &str, case_sensitive: bool, whole_word: bool, is_regex: bool) -> Result<Regex, String> {
    let mut pattern = if is_regex { query.to_string() } else { regex::escape(query) };
    if whole_word {
        pattern = format!(r"\b(?:{})\b", pattern);
    }
    RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|_| "Invalid regular expression".to_string())
}

/// Reads a file the same way search does, skipping large, binary and non-UTF-8 files.
fn read_searchable(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > MAX_SEARCH_BYTES {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    if bytes.iter().take(8000).any(|b| *b == 0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

#[tauri::command]
pub async fn search_project(
    root: String,
    query: String,
    case_sensitive: bool,
    whole_word: bool,
    is_regex: bool,
) -> Result<SearchResult, String> {
    if query.is_empty() {
        return Ok(SearchResult { files: vec![], total: 0, truncated: false });
    }
    let re = build_regex(&query, case_sensitive, whole_word, is_regex)?;

    tauri::async_runtime::spawn_blocking(move || {
        let root_path = PathBuf::from(&root);
        let mut paths: Vec<PathBuf> = walker(&root_path)
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .map(|e| e.into_path())
            .collect();
        paths.sort();

        let mut files = Vec::new();
        let mut total = 0usize;
        let mut truncated = false;

        'files: for path in paths {
            let Some(content) = read_searchable(&path) else { continue };
            let mut matches = Vec::new();
            for (i, line) in content.lines().enumerate() {
                for m in re.find_iter(line) {
                    if m.is_empty() {
                        continue;
                    }
                    if total >= MAX_MATCHES {
                        truncated = true;
                        if !matches.is_empty() {
                            files.push(SearchFile { path: path.to_string_lossy().to_string(), matches });
                        }
                        break 'files;
                    }
                    let before_full = &line[..m.start()];
                    matches.push(SearchMatch {
                        line: (i + 1) as u32,
                        col: before_full.encode_utf16().count() as u32,
                        len: m.as_str().encode_utf16().count() as u32,
                        before: tail(before_full.trim_start(), BEFORE_CHARS),
                        text: head(m.as_str(), 200),
                        after: head(&line[m.end()..], AFTER_CHARS),
                    });
                    total += 1;
                }
            }
            if !matches.is_empty() {
                files.push(SearchFile { path: path.to_string_lossy().to_string(), matches });
            }
        }
        SearchResult { files, total, truncated }
    })
    .await
    .map_err(err)
}

/// A single match to replace: its 1-based line and its UTF-16 column, as reported by search.
#[derive(Deserialize, Clone, Copy)]
pub struct Target {
    line: u32,
    col: u32,
}

struct Replacer {
    re: Regex,
    replacement: String,
    expand: bool,
    target: Option<Target>,
}

impl Replacer {
    fn new(query: &str, case_sensitive: bool, whole_word: bool, is_regex: bool, replacement: String, target: Option<Target>) -> Result<Self, String> {
        if query.is_empty() {
            return Err("Nothing to replace".into());
        }
        let re = build_regex(query, case_sensitive, whole_word, is_regex)?;
        Ok(Self { re, replacement, expand: is_regex, target })
    }

    /// Replaces matches line by line, exactly like search finds them: matches never span
    /// lines, empty matches are skipped, and line endings are kept as they were.
    fn apply(&self, content: &str) -> (String, usize) {
        let mut out = String::with_capacity(content.len());
        let mut count = 0;
        for (i, chunk) in content.split_inclusive('\n').enumerate() {
            let (body, ending) = if let Some(b) = chunk.strip_suffix("\r\n") {
                (b, "\r\n")
            } else if let Some(b) = chunk.strip_suffix('\n') {
                (b, "\n")
            } else {
                (chunk, "")
            };
            if self.target.is_some_and(|t| t.line as usize != i + 1) {
                out.push_str(chunk);
                continue;
            }
            let mut last = 0;
            for caps in self.re.captures_iter(body) {
                let m = caps.get(0).expect("group 0 always matches");
                if m.is_empty() {
                    continue;
                }
                if self.target.is_some_and(|t| body[..m.start()].encode_utf16().count() as u32 != t.col) {
                    continue;
                }
                out.push_str(&body[last..m.start()]);
                if self.expand {
                    caps.expand(&self.replacement, &mut out);
                } else {
                    out.push_str(&self.replacement);
                }
                last = m.end();
                count += 1;
            }
            out.push_str(&body[last..]);
            out.push_str(ending);
        }
        (out, count)
    }
}

#[derive(Serialize)]
pub struct Replaced {
    text: String,
    count: usize,
}

/// Applies a replacement to text the editor already has open, so the change lands in
/// the buffer (and its undo history) instead of on disk.
#[tauri::command]
pub fn replace_in_text(
    text: String,
    query: String,
    case_sensitive: bool,
    whole_word: bool,
    is_regex: bool,
    replacement: String,
    target: Option<Target>,
) -> Result<Replaced, String> {
    let replacer = Replacer::new(&query, case_sensitive, whole_word, is_regex, replacement, target)?;
    let (text, count) = replacer.apply(&text);
    Ok(Replaced { text, count })
}

/// Replaces matches in files on disk and returns how many were replaced.
#[tauri::command]
pub async fn replace_in_files(
    paths: Vec<String>,
    query: String,
    case_sensitive: bool,
    whole_word: bool,
    is_regex: bool,
    replacement: String,
    target: Option<Target>,
) -> Result<usize, String> {
    let replacer = Replacer::new(&query, case_sensitive, whole_word, is_regex, replacement, target)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut total = 0;
        for path in &paths {
            let Some(content) = read_searchable(Path::new(path)) else { continue };
            let (next, count) = replacer.apply(&content);
            if count == 0 {
                continue;
            }
            fs::write(path, next).map_err(|e| format!("{}: {}", path, e))?;
            total += count;
        }
        Ok(total)
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn replace(query: &str, regex: bool, with: &str, text: &str, target: Option<Target>) -> (String, usize) {
        Replacer::new(query, false, false, regex, with.into(), target).unwrap().apply(text)
    }

    #[test]
    fn keeps_line_endings_and_counts() {
        assert_eq!(replace("foo", false, "bar", "foo x\r\nfoo foo\n", None), ("bar x\r\nbar bar\n".into(), 3));
    }

    #[test]
    fn literal_mode_does_not_expand_captures() {
        assert_eq!(replace("a.b", false, "$1", "a.b axb", None), ("$1 axb".into(), 1));
    }

    #[test]
    fn regex_mode_expands_captures_per_line() {
        assert_eq!(replace(r"(\w+)=(\w+)", true, "$2=$1", "a=b\nc=d", None), ("b=a\nd=c".into(), 2));
        // \s+ must not join lines, matching how search reports results
        assert_eq!(replace(r"\s+", true, "_", "a  b\nc", None), ("a_b\nc".into(), 1));
    }

    #[test]
    fn target_replaces_one_match_by_utf16_column() {
        let text = "é foo foo\nfoo";
        assert_eq!(replace("foo", false, "X", text, Some(Target { line: 1, col: 6 })), ("é foo X\nfoo".into(), 1));
    }

    #[test]
    fn skips_empty_matches() {
        assert_eq!(replace("x*", true, "-", "axb", None), ("a-b".into(), 1));
    }
}
