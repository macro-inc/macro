#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use zeroize::Zeroizing;

/// A model provider an agent can bring its own key for.
///
/// The string form is both the `cursor_configs.provider` value and the
/// provider segment of a routed model id (`anthropic/claude-opus-5-5`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ModelProvider {
    /// Anthropic's Messages API.
    Anthropic,
    /// OpenAI's Responses API.
    OpenAi,
}

impl ModelProvider {
    /// Every provider a key can be registered for.
    pub const ALL: [Self; 2] = [Self::Anthropic, Self::OpenAi];

    /// The stored and routed name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::OpenAi => "openai",
        }
    }

    /// The provider named `value`, if it is one.
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|provider| provider.as_str() == value)
    }

    /// The provider serving a routed `provider/model` id, if an agent key
    /// can pay for it.
    #[must_use]
    pub fn of_model(model: &str) -> Option<Self> {
        model
            .split_once('/')
            .and_then(|(provider, _)| Self::parse(provider))
    }

    /// The provider's name as people know it.
    #[must_use]
    pub const fn display_name(self) -> &'static str {
        match self {
            Self::Anthropic => "Anthropic",
            Self::OpenAi => "OpenAI",
        }
    }

    /// The prefix every key this provider mints starts with. The table's
    /// `cursor_configs_key_prefix` check names the same values.
    const fn key_prefix(self) -> &'static str {
        match self {
            Self::Anthropic => "sk-ant-",
            Self::OpenAi => "sk-",
        }
    }
}

/// An agent's provider API key in plaintext.
///
/// Redacts its `Debug` and zeroizes on drop, like `CursorApiKey`: a decrypted
/// key becomes a request header and is dropped with the turn that used it.
pub struct ProviderApiKey {
    provider: ModelProvider,
    key: Zeroizing<String>,
}

impl ProviderApiKey {
    /// Accept a key someone pasted for `provider`, checking its shape.
    ///
    /// Surrounding whitespace and quotes are stripped rather than rejected,
    /// since they are what a paste most often adds. Shape only: this cannot
    /// tell a live key from random characters behind the right prefix.
    pub fn parse(provider: ModelProvider, supplied: &str) -> Result<Self, MalformedProviderApiKey> {
        let trimmed = supplied
            .trim()
            .trim_matches(|character| character == '"' || character == '\'');
        let secret = trimmed
            .strip_prefix(provider.key_prefix())
            .ok_or(MalformedProviderApiKey)?;
        let another_providers_key = ModelProvider::ALL.into_iter().any(|other| {
            other != provider
                && other.key_prefix().len() > provider.key_prefix().len()
                && trimmed.starts_with(other.key_prefix())
        });
        if secret.is_empty() || another_providers_key || secret.contains(char::is_whitespace) {
            return Err(MalformedProviderApiKey);
        }
        Ok(Self {
            provider,
            key: Zeroizing::new(trimmed.to_owned()),
        })
    }

    /// The provider the key authenticates with.
    #[must_use]
    pub fn provider(&self) -> ModelProvider {
        self.provider
    }

    /// The public prefix stored beside the ciphertext.
    #[must_use]
    pub fn prefix(&self) -> &'static str {
        self.provider.key_prefix()
    }

    /// The plaintext key. Only for the client that authenticates with it —
    /// never for a log, a span field, an error, or an API response.
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.key
    }
}

impl std::fmt::Debug for ProviderApiKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "ProviderApiKey({}, redacted)",
            self.provider.as_str()
        )
    }
}

/// A supplied string that is not a key for the provider it was given for.
/// Carries nothing: the rejected value is a credential.
#[derive(Debug, thiserror::Error)]
#[error("value does not look like an API key for this provider")]
pub struct MalformedProviderApiKey;

/// An encrypted key, as the row stores it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EncryptedProviderApiKey {
    /// The KMS ciphertext blob.
    pub key_ciphertext: Vec<u8>,
    /// The scheme that produced the ciphertext.
    pub encryption_version: i16,
    /// The KMS key that encrypted it.
    pub kms_key_id: String,
}

/// Who an agent belongs to, and so whose plan its key needs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AgentOwner {
    /// A person's own agent.
    User(MacroUserIdStr<'static>),
    /// A team's agent.
    Team(Uuid),
}

/// The agent a key is for, as its caller already authorized it.
#[derive(Clone, Debug)]
pub struct KeyedAgent {
    /// The agent's bot id.
    pub bot_id: Uuid,
    /// Who owns the agent.
    pub owner: AgentOwner,
    /// The harness the agent runs on.
    pub harness: String,
    /// The agent's model, a routed `provider/model` id.
    pub model: String,
}

impl KeyedAgent {
    /// The provider whose key this agent can run on: only in-memory agents
    /// on an Anthropic or OpenAI model have one.
    #[must_use]
    pub fn key_provider(&self) -> Option<ModelProvider> {
        runs_in_memory(&self.harness)
            .then(|| ModelProvider::of_model(&self.model))
            .flatten()
    }
}

/// Whether `harness` is Macro's in-memory runtime, the only one that runs
/// model calls on an agent's key.
#[must_use]
pub fn runs_in_memory(harness: &str) -> bool {
    matches!(harness, "in-memory" | "macro-inmem")
}

/// That an agent has a key. Never carries the key.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentKeyStatus {
    /// The provider the key is for.
    pub provider: ModelProvider,
    /// When the key was last replaced.
    pub updated_at: DateTime<Utc>,
}

/// An agent's key, and whether its turns can run on it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentKeyView {
    /// The stored key, if any.
    pub key: Option<AgentKeyStatus>,
    /// Whether the agent's owner's plan includes keys. A key saved before a
    /// downgrade is still shown (and removable) but unused.
    pub plan_allows: bool,
}

/// A stored key with the agent facts that decide whether it is usable.
#[derive(Clone, Debug)]
pub struct StoredAgentKey {
    /// The agent, as it is configured now.
    pub agent: KeyedAgent,
    /// The provider the key is for.
    pub provider: ModelProvider,
    /// The ciphertext.
    pub encrypted: EncryptedProviderApiKey,
}

/// An agent's key a turn may run on, decrypted for that turn.
#[derive(Debug)]
pub struct UsableAgentKey {
    /// The agent's bot id, which usage on the key references.
    pub bot_id: Uuid,
    /// The key.
    pub key: ProviderApiKey,
}

/// Why an agent key operation failed.
#[derive(Debug, thiserror::Error)]
pub enum AgentKeyError {
    /// The supplied value is not a key for the provider.
    #[error("value does not look like an API key for this provider")]
    MalformedKey,
    /// The agent cannot run on a key: it is not an in-memory agent on an
    /// Anthropic or OpenAI model.
    #[error("only in-memory agents on an Anthropic or OpenAI model can use an API key")]
    UnsupportedAgent,
    /// The agent owner's plan does not include API keys.
    #[error("a paid plan is required to use an agent's own API key")]
    PlanRequired,
    /// The owner's plan could not be read.
    #[error("the plan could not be read")]
    Plan(#[source] anyhow::Error),
    /// Encryption or decryption failed. Opaque: KMS's reason can tell a
    /// prober whether the encryption context matched.
    #[error("the key could not be encrypted or decrypted")]
    Cipher,
    /// The row could not be read or written.
    #[error("the key could not be stored")]
    Storage(#[source] anyhow::Error),
}
