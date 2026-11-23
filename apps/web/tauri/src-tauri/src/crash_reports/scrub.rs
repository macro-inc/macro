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
/// The word after one of these is a credential (`Authorization: Bearer x`).
const CREDENTIAL_SCHEMES: &[&str] = &["basic", "bearer"];
/// Names whose value is a credential, in `name=value` or `name: value`: a
/// name ending in one of these (`api_key`, `session_token`).
const CREDENTIAL_KEYS: &[&str] = &[
    "auth",
    "authorization",
    "cookie",
    "key",
    "passwd",
    "password",
    "secret",
    "session",
    "sessionid",
    "session_id",
    "token",
];

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
        after_scheme = precedes_credential(word);
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

/// `Bearer`, `Authorization:Bearer`, or `password:`.
fn precedes_credential(word: &str) -> bool {
    let core = word.trim_matches(|c: char| !(c.is_alphanumeric() || c == ':'));
    let scheme = core.rsplit(':').next().unwrap_or_default();
    CREDENTIAL_SCHEMES
        .iter()
        .any(|credential| scheme.eq_ignore_ascii_case(credential))
        || core
            .strip_suffix(':')
            .is_some_and(|name| !name.contains(':') && is_credential_name(name))
}

fn is_credential_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    CREDENTIAL_KEYS
        .iter()
        .any(|credential| name.ends_with(credential))
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
        // Byte index after the last character that can't be in a scheme;
        // that character may be multibyte (`«https://…`).
        let scheme_start = core[..url]
            .char_indices()
            .rev()
            .find(|(_, c)| !(c.is_ascii_alphanumeric() || "+-.".contains(*c)))
            .map_or(0, |(index, c)| index + c.len_utf8());
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
    } else if let Some((key, _)) = core
        .split_once('=')
        .filter(|(key, value)| !value.starts_with('=') && is_credential_name(key))
    {
        format!("{key}={REDACTED}")
    } else if is_ip_address(core) || is_ipv6_address(core) {
        "<ip>".to_string()
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

/// `fe80::1` or `fe80::abcd%en0`: hex digits and colons, with a digit and at
/// least two colons. A Rust path has a non-hex letter (`v2::h1`) or no digit
/// (`a::b`), which is why a digit-free address like `a::b` is kept: it can't
/// be told apart from a module path.
fn is_ipv6_address(word: &str) -> bool {
    let word = word.split('%').next().unwrap_or_default();
    word.matches(':').count() >= 2
        && word.chars().any(|c| c.is_ascii_digit())
        && word.chars().all(|c| c.is_ascii_hexdigit() || c == ':')
}

/// A long random-looking run, like an API key or session id: mixed case with
/// a digit (`Ab3dEf6h…`), or many digits among letters. A code identifier
/// (`buffer_len_v2_remaining_count`) is neither.
fn is_token(word: &str) -> bool {
    let digits = word.chars().filter(char::is_ascii_digit).count();
    let mixed_case = word.chars().any(|c| c.is_ascii_uppercase())
        && word.chars().any(|c| c.is_ascii_lowercase());
    word.len() >= 20
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && word.chars().any(|c| c.is_ascii_alphabetic())
        && ((mixed_case && digits > 0) || digits >= 6)
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
