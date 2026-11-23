//! Keeps personal data out of panic messages. A message is code text with
//! values formatted into it, and values are where user data hides: quoted
//! strings, paths under a home directory, URLs, email addresses.

const MAX_MESSAGE_CHARS: usize = 300;
const REDACTED: &str = "…";
/// Backtick spans kept verbatim: the code std's own panic messages quote.
/// Anything else in backticks may be user text (`is not a char boundary`).
const CODE_SPANS: &[&str] = &[
    "Err",
    "None",
    "Ok",
    "Some",
    "Option::unwrap()",
    "Option::expect()",
    "Result::unwrap()",
    "Result::unwrap_err()",
    "Result::expect()",
    "Result::expect_err()",
    "async fn",
    "left == right",
    "left != right",
];
/// The word after one of these is a credential.
const CREDENTIAL_SCHEMES: &[&str] = &["basic", "bearer", "token"];
/// `name=value` pairs whose value is a credential.
const CREDENTIAL_KEYS: &[&str] = &["auth", "key", "password", "secret", "session", "token"];

/// This user's home directory and login name, replaced wherever they appear.
#[derive(Clone, Debug, Default)]
pub(super) struct Redactions {
    home: Option<String>,
    user: Option<String>,
}

impl Redactions {
    pub fn for_this_user() -> Self {
        Self::new(std::env::home_dir().and_then(|home| home.to_str().map(str::to_string)))
    }

    pub fn new(home: Option<String>) -> Self {
        let home = home.filter(|home| home.len() > 1);
        let user = home
            .as_deref()
            .and_then(|home| home.rsplit(['/', '\\']).find(|part| !part.is_empty()))
            // A very short name would also match ordinary words.
            .filter(|user| user.chars().count() >= 3)
            .map(str::to_string);
        Self { home, user }
    }

    fn apply(&self, text: &str) -> String {
        let mut text = text.to_string();
        if let Some(home) = &self.home {
            text = text.replace(home.as_str(), "~");
        }
        if let Some(user) = &self.user {
            text = text.replace(user.as_str(), "<user>");
        }
        text
    }
}

/// The message with this user's home and name, quoted values, backtick spans
/// that aren't code, paths, URL paths, email addresses, and long numbers
/// replaced.
pub(super) fn scrub_message(message: &str, redactions: &Redactions) -> String {
    let unquoted = redact_quotes(&redactions.apply(message));
    let mut scrubbed = String::with_capacity(unquoted.len());
    let mut word = String::new();
    let mut after_scheme = false;
    let mut flush = |word: &mut String, scrubbed: &mut String| {
        if word.is_empty() {
            return;
        }
        let core_after_scheme = word.trim_matches(|c: char| "()[]{},;.'\"".contains(c));
        if after_scheme && !core_after_scheme.is_empty() {
            let core = word.trim_matches(|c: char| "()[]{},;.'\"".contains(c));
            scrubbed.push_str(&word.replacen(core, "<token>", 1));
        } else {
            scrubbed.push_str(&redact_word(word));
        }
        let core = word.trim_matches(|c: char| !c.is_alphanumeric());
        after_scheme = CREDENTIAL_SCHEMES
            .iter()
            .any(|scheme| core.eq_ignore_ascii_case(scheme));
        word.clear();
    };
    for c in unquoted.chars() {
        if c.is_whitespace() {
            flush(&mut word, &mut scrubbed);
            scrubbed.push(c);
        } else {
            word.push(c);
        }
    }
    flush(&mut word, &mut scrubbed);
    truncate(&scrubbed, MAX_MESSAGE_CHARS)
}

fn redact_quotes(message: &str) -> String {
    let chars: Vec<char> = message.chars().collect();
    let mut out = String::with_capacity(message.len());
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        let span = match c {
            // `Debug` of a string: up to the closing unescaped quote.
            '"' => {
                let mut end = index + 1;
                while end < chars.len() && chars[end] != '"' {
                    end += if chars[end] == '\\' { 2 } else { 1 };
                }
                Some((end.min(chars.len()), false))
            }
            '`' => chars[index + 1..]
                .iter()
                .position(|&c| c == '`')
                .map(|length| (index + 1 + length, true)),
            // A quoted value (`'é'`, `'/tmp/x'`), not an apostrophe in prose.
            '\'' if index == 0 || !chars[index - 1].is_alphanumeric() => chars[index + 1..]
                .iter()
                .enumerate()
                .position(|(offset, &c)| {
                    let after = chars.get(index + 2 + offset);
                    c == '\'' && after.is_none_or(|after| !after.is_alphanumeric())
                })
                .map(|length| (index + 1 + length, false)),
            _ => None,
        };
        match span {
            Some((end, keep_code)) => {
                let inner: String = chars[index + 1..end].iter().collect();
                out.push(c);
                out.push_str(if keep_code && is_code(&inner) {
                    inner.as_str()
                } else {
                    REDACTED
                });
                out.push(c);
                index = end + 1;
            }
            None => {
                out.push(c);
                index += 1;
            }
        }
    }
    out
}

fn is_code(span: &str) -> bool {
    CODE_SPANS.contains(&span)
}

fn redact_word(word: &str) -> String {
    let core = word.trim_matches(|c: char| "()[]{},;.'\"".contains(c));
    if core.is_empty() {
        return word.to_string();
    }
    let replacement = if let Some(url) = core.find("://") {
        let scheme_start = core[..url]
            .rfind(|c: char| !(c.is_ascii_alphanumeric() || "+-.".contains(c)))
            .map_or(0, |index| index + 1);
        let rest = &core[url + 3..];
        let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
        let host = host.rsplit('@').next().unwrap_or_default();
        let host = if is_ip_address(host) { "<ip>" } else { host };
        let tail = if host.len() < rest.len() { "/…" } else { "" };
        format!(
            "{}{}://{host}{tail}",
            &core[..scheme_start],
            &core[scheme_start..url]
        )
    } else if core
        .split_once('@')
        .is_some_and(|(_, domain)| domain.contains('.'))
    {
        "<email>".to_string()
    } else if let Some((key, _)) = core.split_once('=').filter(|(key, _)| {
        let key = key.to_ascii_lowercase();
        CREDENTIAL_KEYS
            .iter()
            .any(|credential| key.contains(credential))
    }) {
        format!("{key}={REDACTED}")
    } else if core.contains('/') || core.contains('\\') {
        // A path, or part of one split at a space; module paths use `::`.
        "<path>".to_string()
    } else if core.chars().filter(char::is_ascii_digit).count() >= 7 {
        "<number>".to_string()
    } else if is_token(core) {
        "<token>".to_string()
    } else {
        return word.to_string();
    };
    word.replacen(core, &replacement, 1)
}

/// An IPv4 address (with or without a port) or a bracketed IPv6 one.
fn is_ip_address(host: &str) -> bool {
    if host.starts_with('[') {
        return true;
    }
    let address = host.split(':').next().unwrap_or_default();
    let parts: Vec<_> = address.split('.').collect();
    parts.len() == 4
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

/// A long run of letters and digits mixed, like an API key or session id.
fn is_token(word: &str) -> bool {
    word.len() >= 20
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && word.chars().any(|c| c.is_ascii_digit())
        && word.chars().any(|c| c.is_ascii_alphabetic())
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
    if path.starts_with('/') || path.starts_with("~/") {
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
