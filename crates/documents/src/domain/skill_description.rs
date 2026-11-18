//! A skill's routing description: one line saying when to use the skill.

#[cfg(test)]
mod test;

/// The longest description, in characters. The database enforces it too.
pub const MAX_CHARS: usize = 300;

const OPENING: &str = "use when ";

/// When to use a skill, in one line that opens "Use when" (and ideally says
/// "; not …" too). Agents choose skills for a request by this sentence.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(transparent)]
pub struct SkillDescription(String);

/// Why a description was rejected; the message is shown to the user.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SkillDescriptionError {
    /// Nothing but whitespace.
    #[error("Describe when to use the skill, starting \"Use when\".")]
    Empty,
    /// More than one line.
    #[error("Keep the description to one line.")]
    MultipleLines,
    /// Longer than [`MAX_CHARS`].
    #[error("Keep the description to {MAX_CHARS} characters or fewer.")]
    TooLong,
    /// Does not open with "Use when".
    #[error(
        "Start the description with \"Use when\", e.g. \"Use when drafting release notes; not changelogs\"."
    )]
    MissingOpening,
}

impl SkillDescription {
    /// Validate a description the user wrote, trimming surrounding space.
    pub fn parse(text: &str) -> Result<Self, SkillDescriptionError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(SkillDescriptionError::Empty);
        }
        if text.contains(['\n', '\r']) {
            return Err(SkillDescriptionError::MultipleLines);
        }
        if text.chars().count() > MAX_CHARS {
            return Err(SkillDescriptionError::TooLong);
        }
        let opening = text.get(..OPENING.len()).unwrap_or_default();
        if !opening.eq_ignore_ascii_case(OPENING) {
            return Err(SkillDescriptionError::MissingOpening);
        }
        Ok(Self(text.to_owned()))
    }

    /// A description already validated when it was stored.
    pub fn from_stored(text: String) -> Self {
        Self(text)
    }

    /// The description text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<SkillDescriptionError> for crate::domain::models::DocumentError {
    fn from(error: SkillDescriptionError) -> Self {
        Self::BadRequest(error.to_string())
    }
}
