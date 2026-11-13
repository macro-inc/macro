//! A session's system prompt, built from named sections whose sizes and
//! hashes every model call records (see `crate::telemetry`).

use sha2::{Digest as _, Sha256};

/// A session's system prompt, optionally split where the part every session
/// of the agent repeats byte for byte ends, with an optional tail that
/// changes every turn.
///
/// Anthropic caches the shared part apart from the per-session rest
/// (instructions, memory), so a session reads the shared part back even when
/// its rest is new. The turn's part comes last, after anything the loop adds
/// (the model id, connected integrations), so a change to it costs only what
/// follows it. Other providers receive the parts joined.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SystemPrompt {
    shared: Option<String>,
    rest: String,
    turn: String,
    sections: Vec<MeasuredSection>,
}

/// What a part of the system prompt is, so a model call can say how large
/// each part was and which one changed when the provider's cache broke.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptSection {
    /// The agent-session preamble.
    Preamble,
    /// The static Macro prompt that comes with the toolset.
    MacroPrompt,
    /// The named agent's identity.
    Identity,
    /// The session's own instructions.
    SessionInstructions,
    /// Which agent session this is and how to search its history.
    SessionNote,
    /// The note that no opening line went out.
    OpenerNote,
    /// The owner's memory.
    Memory,
    /// The line naming the model serving the call.
    ModelId,
    /// The integrations reachable through tool search.
    ConnectedIntegrations,
    /// SDK documentation selected for the turn (code mode).
    SdkDocs,
    /// A prompt not built from named sections.
    Unsectioned,
}

impl PromptSection {
    /// The span attribute holding this section's size in bytes.
    pub(crate) fn bytes_key(self) -> &'static str {
        match self {
            Self::Preamble => "macro.genai.prompt.preamble.bytes",
            Self::MacroPrompt => "macro.genai.prompt.macro_prompt.bytes",
            Self::Identity => "macro.genai.prompt.identity.bytes",
            Self::SessionInstructions => "macro.genai.prompt.session_instructions.bytes",
            Self::SessionNote => "macro.genai.prompt.session_note.bytes",
            Self::OpenerNote => "macro.genai.prompt.opener_note.bytes",
            Self::Memory => "macro.genai.prompt.memory.bytes",
            Self::ModelId => "macro.genai.prompt.model_id.bytes",
            Self::ConnectedIntegrations => "macro.genai.prompt.connected_integrations.bytes",
            Self::SdkDocs => "macro.genai.prompt.sdk_docs.bytes",
            Self::Unsectioned => "macro.genai.prompt.unsectioned.bytes",
        }
    }

    /// The span attribute holding a short hash of this section's text.
    pub(crate) fn hash_key(self) -> &'static str {
        match self {
            Self::Preamble => "macro.genai.prompt.preamble.hash",
            Self::MacroPrompt => "macro.genai.prompt.macro_prompt.hash",
            Self::Identity => "macro.genai.prompt.identity.hash",
            Self::SessionInstructions => "macro.genai.prompt.session_instructions.hash",
            Self::SessionNote => "macro.genai.prompt.session_note.hash",
            Self::OpenerNote => "macro.genai.prompt.opener_note.hash",
            Self::Memory => "macro.genai.prompt.memory.hash",
            Self::ModelId => "macro.genai.prompt.model_id.hash",
            Self::ConnectedIntegrations => "macro.genai.prompt.connected_integrations.hash",
            Self::SdkDocs => "macro.genai.prompt.sdk_docs.hash",
            Self::Unsectioned => "macro.genai.prompt.unsectioned.hash",
        }
    }
}

/// A section's size and hash, kept instead of its text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MeasuredSection {
    pub(crate) section: PromptSection,
    pub(crate) bytes: usize,
    pub(crate) hash: String,
}

impl SystemPrompt {
    /// Append `text` to the part every session of the agent shares, which
    /// makes the prompt split.
    pub fn push_shared(&mut self, section: PromptSection, text: &str) {
        self.shared.get_or_insert_default().push_str(text);
        self.measure(section, text);
    }

    /// Append `text` to the session's own part.
    pub fn push(&mut self, section: PromptSection, text: &str) {
        self.rest.push_str(text);
        self.measure(section, text);
    }

    /// Append `text` to the part only this turn sends, which goes last.
    pub fn push_turn(&mut self, section: PromptSection, text: &str) {
        self.turn.push_str(text);
        self.measure(section, text);
    }

    /// The shared part, when the prompt is split.
    pub fn shared(&self) -> Option<&str> {
        self.shared.as_deref()
    }

    /// Everything after the shared part: the session's own, then the turn's.
    pub fn rest(&self) -> String {
        format!("{}{}", self.rest, self.turn)
    }

    /// The whole prompt as one string.
    pub(crate) fn joined(&self) -> String {
        self.to_string()
    }

    /// Each section's size and hash, in the order they were added.
    pub(crate) fn sections(&self) -> &[MeasuredSection] {
        &self.sections
    }

    fn measure(&mut self, section: PromptSection, text: &str) {
        self.sections.push(MeasuredSection {
            section,
            bytes: text.len(),
            hash: short_hash(text.as_bytes()),
        });
    }
}

/// The first 16 hex digits of the SHA-256 of `bytes`: enough to tell two
/// versions of a section apart, and nothing of its content.
pub(crate) fn short_hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

impl std::fmt::Display for SystemPrompt {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{}{}{}",
            self.shared.as_deref().unwrap_or_default(),
            self.rest,
            self.turn
        )
    }
}

impl From<String> for SystemPrompt {
    fn from(rest: String) -> Self {
        rest.as_str().into()
    }
}

impl From<&String> for SystemPrompt {
    fn from(rest: &String) -> Self {
        rest.as_str().into()
    }
}

impl From<&str> for SystemPrompt {
    fn from(rest: &str) -> Self {
        let mut prompt = Self::default();
        prompt.push(PromptSection::Unsectioned, rest);
        prompt
    }
}
