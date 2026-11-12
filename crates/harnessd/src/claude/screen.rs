//! What `claude setup-token`'s screens say.

#[cfg(test)]
mod test;

const URL_PREFIX: &str = "https://claude.com/cai/oauth/authorize?";
const CODE_PROMPT: &str = "Paste code here if prompted";
const CREATED: &str = "Long-lived authentication token created successfully";
const AFTER_TOKEN: &str = "Store this token securely";
const TOKEN_PREFIX: &str = "sk-ant-";
const VALID_FOR: &str = "valid for ";
const REJECTED: &str = "OAuth error";
const MALFORMED: &str = "Invalid code";

/// The sign-in URL, once the code prompt below it is drawn. The CLI
/// hard-wraps the URL at the terminal width, so its rows are joined.
pub fn sign_in_url(rows: &[String]) -> Option<String> {
    let start = rows
        .iter()
        .position(|row| row.trim_start().starts_with(URL_PREFIX))?;
    if !rows[start..].iter().any(|row| row.contains(CODE_PROMPT)) {
        return None;
    }

    // The URL has no spaces, so it ends at a blank row or a row of words.
    let mut url = String::new();
    for row in &rows[start..] {
        let part = row.trim();
        if part.is_empty() || part.contains(char::is_whitespace) {
            break;
        }
        url.push_str(part);
    }
    Some(url)
}

/// How the CLI answered a pasted code.
#[derive(Clone, PartialEq, Eq)]
pub enum CodeOutcome {
    /// The token was created.
    Created {
        token: String,
        /// How long the screen says the token lasts.
        valid_for: Option<Validity>,
    },
    /// The provider refused the code.
    Rejected,
    /// The CLI could not read the code.
    Malformed,
}

impl std::fmt::Debug for CodeOutcome {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Created { valid_for, .. } => formatter
                .debug_struct("Created")
                .field("token", &"<redacted>")
                .field("valid_for", valid_for)
                .finish(),
            Self::Rejected => formatter.write_str("Rejected"),
            Self::Malformed => formatter.write_str("Malformed"),
        }
    }
}

/// A token's lifetime as the CLI words it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Validity {
    Years(u32),
    Months(u32),
    Days(u32),
}

/// The CLI's answer to a pasted code, once it is fully drawn.
pub fn code_outcome(rows: &[String]) -> Option<CodeOutcome> {
    if rows.iter().any(|row| row.contains(REJECTED)) {
        return Some(CodeOutcome::Rejected);
    }
    if rows.iter().any(|row| row.contains(MALFORMED)) {
        return Some(CodeOutcome::Malformed);
    }
    if !rows.iter().any(|row| row.contains(CREATED)) {
        return None;
    }

    // The token follows its heading; the rows after it must be drawn too,
    // or the token row may still be partial.
    let token_row = rows
        .iter()
        .position(|row| row.trim_start().starts_with(TOKEN_PREFIX))?;
    if !rows[token_row..]
        .iter()
        .any(|row| row.contains(AFTER_TOKEN))
    {
        return None;
    }
    let mut token = String::new();
    for row in &rows[token_row..] {
        let part = row.trim();
        if part.is_empty() || part.contains(char::is_whitespace) {
            break;
        }
        token.push_str(part);
    }

    let valid_for = rows[..token_row].iter().find_map(|row| validity(row));
    Some(CodeOutcome::Created { token, valid_for })
}

/// Reads `(valid for 1 year)` and the like.
fn validity(row: &str) -> Option<Validity> {
    let start = row.find(VALID_FOR)? + VALID_FOR.len();
    let mut words = row[start..].split(|character: char| !character.is_ascii_alphanumeric());
    let count = words.next()?.parse::<u32>().ok()?;
    let unit = words.find(|word| !word.is_empty())?;
    match unit {
        "year" | "years" => Some(Validity::Years(count)),
        "month" | "months" => Some(Validity::Months(count)),
        "day" | "days" => Some(Validity::Days(count)),
        _ => None,
    }
}
