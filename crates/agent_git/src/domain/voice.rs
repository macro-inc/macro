//! The agent's call voice, committed to its repo as `config/voice.json`.

use serde::{Deserialize, Serialize};

/// Where the voice lives in the agent's repo.
pub const VOICE_PATH: &str = "config/voice.json";

/// Longest accepted model id.
const MAX_MODEL_CHARS: usize = 100;

/// An Aura-2 voice model id, `aura-2-<name>-<language>`, such as
/// `aura-2-thalia-en`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct VoiceModel(String);

/// The text is not an Aura-2 voice model id.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("choose an Aura-2 voice such as aura-2-thalia-en")]
pub struct InvalidVoiceModel;

impl VoiceModel {
    /// Parse `aura-2-<lowercase name>-<two-letter language>`, at most 100
    /// characters.
    pub fn parse(model: impl Into<String>) -> Result<Self, InvalidVoiceModel> {
        let model = model.into();
        if model.len() > MAX_MODEL_CHARS
            || !lazy_regex::regex_is_match!(r"^aura-2-[a-z]+-[a-z]{2}$", &model)
        {
            return Err(InvalidVoiceModel);
        }
        Ok(Self(model))
    }

    /// The whole model id.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The provider's voice name (`thalia`).
    pub fn voice(&self) -> &str {
        self.parts().0
    }

    /// The voice's language (`en`).
    pub fn language(&self) -> &str {
        self.parts().1
    }

    fn parts(&self) -> (&str, &str) {
        // `parse` guarantees the prefix and exactly one trailing `-xx`.
        self.0
            .strip_prefix("aura-2-")
            .and_then(|rest| rest.rsplit_once('-'))
            .unwrap_or_default()
    }
}

impl TryFrom<String> for VoiceModel {
    type Error = InvalidVoiceModel;

    fn try_from(model: String) -> Result<Self, Self::Error> {
        Self::parse(model)
    }
}

impl From<VoiceModel> for String {
    fn from(model: VoiceModel) -> Self {
        model.0
    }
}

impl std::fmt::Display for VoiceModel {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// Content of `config/voice.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoiceConfig {
    /// The selected Aura-2 model.
    pub model: VoiceModel,
}

impl VoiceConfig {
    /// The file's contents: pretty JSON with a trailing newline.
    pub fn to_file_contents(&self) -> serde_json::Result<String> {
        Ok(format!("{}\n", serde_json::to_string_pretty(self)?))
    }
}

#[cfg(test)]
mod test;
