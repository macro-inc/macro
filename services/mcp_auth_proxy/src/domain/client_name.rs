//! The name an MCP client registers under, as Macro shows it.
//!
//! The name is self-reported at dynamic client registration and becomes the
//! author label on what the client writes ("Claude Code · Agent"), so the
//! broker bounds what a client can call itself.

#[cfg(test)]
mod test;

use bot_id::{
    MACRO_AI_HANDLE, MACRO_AI_NAME, MACRO_CODER_NAME, MACRO_NEW_HANDLE, MACRO_SYSTEM_HANDLE,
    MACRO_SYSTEM_NAME,
};

/// The longest name a client keeps.
pub(crate) const MAX_CLIENT_NAME_CHARS: usize = 64;

/// Punctuation a name may keep besides ASCII letters, digits and spaces.
/// Mention and markup characters (`<>@#[]` and friends) are left out.
const ALLOWED_PUNCTUATION: &[char] = &['-', '_', '.', ',', ':', '(', ')', '&', '+', '\'', '/', '!'];

/// Names that would read as Macro itself: its own personas and the
/// first-party Macro bots. Matched as a whole name, ignoring case, spaces and
/// punctuation, so a client may still mention Macro ("Claude Code (macro)").
/// Cursor and Codex are first-party bots too, but are also the real names of
/// MCP clients, so they are not reserved.
const RESERVED_NAMES: &[&str] = &[
    MACRO_AI_NAME,
    MACRO_AI_HANDLE,
    MACRO_NEW_HANDLE,
    MACRO_CODER_NAME,
    MACRO_SYSTEM_NAME,
    MACRO_SYSTEM_HANDLE,
    "Macro AI",
    "Macro Agent",
    "Macro Team",
    "Macro Support",
    "Macro Security",
];

/// A client name fit to show as a post author.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClientName(String);

/// The name claims to be Macro itself.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
#[error("client_name is reserved")]
pub struct ReservedClientName;

impl ClientName {
    /// Normalizes a self-reported name: keeps printable ASCII letters, digits,
    /// spaces and [`ALLOWED_PUNCTUATION`], so no control, bidi, zero-width or
    /// lookalike character survives; collapses whitespace; and cuts it to
    /// [`MAX_CLIENT_NAME_CHARS`]. `None` when nothing is left. A name in
    /// [`RESERVED_NAMES`] is refused.
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
    let key = reserved_name_key(name);
    RESERVED_NAMES
        .iter()
        .any(|reserved| reserved_name_key(reserved) == key)
}

/// A name lowercased with everything but letters and digits removed.
fn reserved_name_key(name: &str) -> String {
    name.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect()
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
