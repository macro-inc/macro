//! Keeps personal data out of panic messages. A message is code text with
//! values formatted into it, and values are where user data hides: quoted
//! strings, paths under a home directory, URLs, email addresses.

const MAX_MESSAGE_CHARS: usize = 300;
const REDACTED: &str = "…";

/// The message with quoted values, `'c'` characters, non-identifier backtick
/// spans, paths, URL paths, email addresses, and long numbers replaced.
pub(super) fn scrub_message(message: &str) -> String {
    let unquoted = redact_quotes(message);
    let mut scrubbed = String::with_capacity(unquoted.len());
    for (index, word) in unquoted.split(' ').enumerate() {
        if index > 0 {
            scrubbed.push(' ');
        }
        scrubbed.push_str(&redact_word(word));
    }
    truncate(&scrubbed, MAX_MESSAGE_CHARS)
}

fn redact_quotes(message: &str) -> String {
    let chars: Vec<char> = message.chars().collect();
    let mut out = String::with_capacity(message.len());
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        match c {
            '"' => {
                // `Debug` of a string: skip to the closing unescaped quote.
                let mut end = index + 1;
                while end < chars.len() && chars[end] != '"' {
                    end += if chars[end] == '\\' { 2 } else { 1 };
                }
                out.push('"');
                out.push_str(REDACTED);
                out.push('"');
                index = end + 1;
            }
            '`' => match chars[index + 1..].iter().position(|&c| c == '`') {
                Some(length) => {
                    let span: String = chars[index + 1..index + 1 + length].iter().collect();
                    out.push('`');
                    // `Result::unwrap()` is code; anything else may be the
                    // text being sliced (`is not a char boundary`).
                    out.push_str(if is_code(&span) { &span } else { REDACTED });
                    out.push('`');
                    index += length + 2;
                }
                None => {
                    out.push(c);
                    index += 1;
                }
            },
            // A `char` value (`'é'`), not an apostrophe in prose.
            '\'' if chars.get(index + 2) == Some(&'\'') => {
                out.push('\'');
                out.push_str(REDACTED);
                out.push('\'');
                index += 3;
            }
            _ => {
                out.push(c);
                index += 1;
            }
        }
    }
    out
}

fn is_code(span: &str) -> bool {
    !span.is_empty()
        && span
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_:<>()&,".contains(c))
}

fn redact_word(word: &str) -> String {
    let core = word.trim_matches(|c: char| "()[]{},;.".contains(c));
    if core.is_empty() {
        return word.to_string();
    }
    let replacement = if let Some((scheme, rest)) = core.split_once("://") {
        let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
        let host = host.rsplit('@').next().unwrap_or_default();
        if host.len() < rest.len() {
            format!("{scheme}://{host}/{REDACTED}")
        } else {
            format!("{scheme}://{host}")
        }
    } else if core
        .split_once('@')
        .is_some_and(|(_, domain)| domain.contains('.'))
    {
        "<email>".to_string()
    } else if is_path(core) {
        "<path>".to_string()
    } else if core.chars().filter(char::is_ascii_digit).count() >= 7 {
        "<number>".to_string()
    } else {
        return word.to_string();
    };
    word.replacen(core, &replacement, 1)
}

fn is_path(word: &str) -> bool {
    let unix = (word.starts_with('/') || word.starts_with("~/")) && word.matches('/').count() >= 2;
    let bytes = word.as_bytes();
    let windows = bytes.len() > 2 && bytes[0].is_ascii_alphabetic() && &bytes[1..3] == b":\\";
    unix || windows
}

fn truncate(text: &str, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((end, _)) => format!("{}{REDACTED}", &text[..end]),
        None => text.to_string(),
    }
}

/// A source path from a panic location or backtrace, without the build
/// machine's directories: `tokio-1.47.1/src/runtime/park.rs` rather than the
/// full path under `~/.cargo/registry/src/<index>/`.
pub(super) fn short_source_path(path: &str) -> String {
    let path = path.replace('\\', "/");
    for (marker, skip) in [
        ("/.cargo/registry/src/", 1),
        ("/.cargo/git/checkouts/", 2),
        ("/vendor/", 0),
        ("/rustc/", 1),
    ] {
        if let Some((_, rest)) = path.rsplit_once(marker) {
            return rest
                .splitn(skip + 1, '/')
                .last()
                .unwrap_or(rest)
                .to_string();
        }
    }
    if is_path(&path) {
        // A crate in this repository, built from an absolute path.
        for marker in ["/apps/web/tauri/", "/crates/"] {
            if let Some((_, rest)) = path.rsplit_once(marker) {
                return rest.to_string();
            }
        }
        return path.rsplit('/').next().unwrap_or_default().to_string();
    }
    path
}
