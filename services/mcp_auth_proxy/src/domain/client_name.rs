//! The name an MCP client registers under, as Macro shows it.
//!
//! The name is self-reported at dynamic client registration and becomes the
//! author label on what the client writes ("Claude Code · Agent"), so the
//! broker bounds what a client can call itself.

#[cfg(test)]
mod test;

/// The longest name a client keeps.
pub(crate) const MAX_CLIENT_NAME_CHARS: usize = 64;

/// Punctuation a name may keep besides ASCII letters, digits and spaces.
/// Mention and markup characters (`<>@#[]` and friends) are left out.
const ALLOWED_PUNCTUATION: &[char] = &['-', '_', '.', ',', ':', '(', ')', '&', '+', '\'', '/', '!'];

/// Words a client may not use on their own, since posts under them would read
/// as coming from Macro staff.
const RESERVED_WORDS: &[&str] = &[
    "admin",
    "administrator",
    "helpdesk",
    "moderator",
    "official",
    "security",
    "staff",
    "support",
    "system",
];

/// A client name fit to show as a post author.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClientName(String);

/// The name claims to be Macro or its staff.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
#[error("client_name is reserved")]
pub struct ReservedClientName;

impl ClientName {
    /// Normalizes a self-reported name: keeps printable ASCII letters, digits,
    /// spaces and [`ALLOWED_PUNCTUATION`], so no control, bidi, zero-width or
    /// lookalike character survives; collapses whitespace; and cuts it to
    /// [`MAX_CLIENT_NAME_CHARS`]. `None` when nothing is left. A name that
    /// claims to be Macro or its staff is refused.
    pub fn parse(raw: &str) -> Result<Option<Self>, ReservedClientName> {
        let kept: String = raw
            .chars()
            .filter_map(|c| match c {
                c if c.is_whitespace() => Some(' '),
                c if c.is_ascii_alphanumeric() || ALLOWED_PUNCTUATION.contains(&c) => Some(c),
                _ => None,
            })
            .collect();
        let collapsed = kept.split_whitespace().collect::<Vec<_>>().join(" ");
        let name = collapsed
            .get(..MAX_CLIENT_NAME_CHARS)
            .unwrap_or(&collapsed)
            .trim_end();

        if is_reserved(name) {
            return Err(ReservedClientName);
        }
        Ok((!name.is_empty()).then(|| Self(name.to_owned())))
    }
}

fn is_reserved(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let letters: String = lower.chars().filter(char::is_ascii_alphanumeric).collect();
    letters.contains("macro")
        || lower
            .split(|c: char| !c.is_ascii_alphanumeric())
            .any(|word| RESERVED_WORDS.contains(&word))
}

impl From<ClientName> for String {
    fn from(name: ClientName) -> Self {
        name.0
    }
}

impl AsRef<str> for ClientName {
    fn as_ref(&self) -> &str {
        &self.0
    }
}
