use std::{fs, path::Path};

use anyhow::Context;
use serde::Deserialize;

use crate::LocalE2eConfig;

/// Alias data for stable local E2E fixtures.
#[derive(Clone, Debug, Deserialize)]
pub struct LocalE2eManifest {
    /// Primary authenticated user for local E2E.
    pub user: LocalE2eUserAlias,
    /// Stable document aliases.
    pub documents: LocalE2eDocumentAliases,
    /// Stable channel aliases.
    pub channels: LocalE2eChannelAliases,
}

/// User alias in the local E2E manifest.
#[derive(Clone, Debug, Deserialize)]
pub struct LocalE2eUserAlias {
    /// User email.
    pub email: String,
}

/// Document aliases in the local E2E manifest.
#[derive(Clone, Debug, Deserialize)]
pub struct LocalE2eDocumentAliases {
    /// Project roadmap document fixture.
    #[serde(rename = "projectRoadmap")]
    pub project_roadmap: LocalE2eDocumentAlias,
}

/// Document alias in the local E2E manifest.
#[derive(Clone, Debug, Deserialize)]
pub struct LocalE2eDocumentAlias {
    /// Document id.
    pub id: String,
    /// Document name.
    pub name: String,
}

/// Channel aliases in the local E2E manifest.
#[derive(Clone, Debug, Deserialize)]
pub struct LocalE2eChannelAliases {
    /// General channel fixture.
    pub general: LocalE2eChannelAlias,
}

/// Channel alias in the local E2E manifest.
#[derive(Clone, Debug, Deserialize)]
pub struct LocalE2eChannelAlias {
    /// Channel id.
    pub id: String,
    /// Channel name.
    pub name: String,
    /// Canonical seeded message content for the channel.
    pub message: String,
}

/// User row from `seed/local_e2e/users.json`.
#[derive(Clone, Debug, Deserialize)]
pub struct SeedUser {
    /// Stable database id in `macro_user`.
    pub macro_user_id: String,
    /// Stable FusionAuth id used in locally generated JWTs.
    pub fusion_user_id: String,
    /// Macro auth user id, e.g. `macro|e2e@macro.local`.
    pub user_id: String,
    /// Display username.
    pub username: String,
    /// Email address.
    pub email: String,
    /// Stripe customer id fixture value.
    pub stripe_customer_id: String,
    /// First name.
    pub first_name: String,
    /// Last name.
    pub last_name: String,
    /// Role ids assigned to the user.
    pub roles: Vec<String>,
    /// Whether onboarding tutorial is complete.
    pub tutorial_complete: bool,
    /// Whether onboarding documents exist.
    pub has_onboarding_documents: bool,
    /// Whether the user has trialed.
    pub has_trialed: bool,
    /// Whether the user's email is verified.
    pub is_verified: bool,
}

/// Document row from `seed/documents/documents.json`.
#[derive(Clone, Debug, Deserialize)]
pub struct SeedDocument {
    /// Stable document id.
    pub document_id: String,
    /// Display document name.
    pub document_name: String,
    /// Source file name.
    pub file_name: String,
    /// Whether the document is public.
    pub is_public: bool,
}

/// Channel row from `seed/channels.json`.
#[derive(Clone, Debug, Deserialize)]
pub struct SeedChannel {
    /// Stable channel id.
    pub channel_id: String,
    /// Optional channel name.
    pub channel_name: Option<String>,
    /// Channel type string as accepted by the seed CLI.
    pub channel_type: String,
    /// Participant user ids excluding the owner appended by the seed CLI.
    #[serde(default)]
    pub participants: Vec<String>,
}

/// Entity mention row from a seeded channel message.
#[derive(Clone, Debug, Deserialize)]
pub struct SeedMention {
    /// Mentioned entity type.
    pub entity_type: String,
    /// Mentioned entity id.
    pub entity_id: String,
}

/// Message row from `seed/channel_messages.json`.
#[derive(Clone, Debug, Deserialize)]
pub struct SeedChannelMessage {
    /// Stable message id.
    pub message_id: String,
    /// Channel id containing this message.
    pub channel_id: String,
    /// Sender user id.
    pub sender_id: String,
    /// Message content.
    pub content: String,
    /// Optional thread root id.
    pub thread_id: Option<String>,
    /// Entity mentions in the message.
    #[serde(default)]
    pub entity_mentions: Vec<SeedMention>,
}

/// Fully loaded local E2E seed world.
#[derive(Clone, Debug)]
pub struct LocalE2eSeed {
    /// Stable fixture aliases.
    pub manifest: LocalE2eManifest,
    /// Seeded users.
    pub users: Vec<SeedUser>,
    /// Seeded documents.
    pub documents: Vec<SeedDocument>,
    /// Seeded channels.
    pub channels: Vec<SeedChannel>,
    /// Seeded channel messages.
    pub channel_messages: Vec<SeedChannelMessage>,
}

impl LocalE2eSeed {
    /// Load seed data using the default local E2E configuration.
    pub fn load() -> anyhow::Result<Self> {
        let config = LocalE2eConfig::load()?;
        Self::from_config(&config)
    }

    /// Load seed data from a configuration's repository root.
    pub fn from_config(config: &LocalE2eConfig) -> anyhow::Result<Self> {
        Self::from_seed_dir(&config.seed_dir())
    }

    /// Load seed data from an explicit seed directory.
    pub fn from_seed_dir(seed_dir: &Path) -> anyhow::Result<Self> {
        Ok(Self {
            manifest: read_json(&seed_dir.join("local_e2e/manifest.json"))?,
            users: read_json(&seed_dir.join("local_e2e/users.json"))?,
            documents: read_json(&seed_dir.join("documents/documents.json"))?,
            channels: read_json(&seed_dir.join("channels.json"))?,
            channel_messages: read_json(&seed_dir.join("channel_messages.json"))?,
        })
    }

    /// Find a seeded user by email.
    pub fn user_by_email(&self, email: &str) -> Option<&SeedUser> {
        self.users.iter().find(|user| user.email == email)
    }

    /// Find a seeded user by auth user id.
    pub fn user_by_id(&self, user_id: &str) -> Option<&SeedUser> {
        self.users.iter().find(|user| user.user_id == user_id)
    }

    /// Find a seeded document by id.
    pub fn document_by_id(&self, document_id: &str) -> Option<&SeedDocument> {
        self.documents
            .iter()
            .find(|document| document.document_id == document_id)
    }

    /// Find a seeded channel by id.
    pub fn channel_by_id(&self, channel_id: &str) -> Option<&SeedChannel> {
        self.channels
            .iter()
            .find(|channel| channel.channel_id == channel_id)
    }

    /// Find a seeded channel message by id.
    pub fn channel_message_by_id(&self, message_id: &str) -> Option<&SeedChannelMessage> {
        self.channel_messages
            .iter()
            .find(|message| message.message_id == message_id)
    }

    /// Messages in a channel, in seed-file order.
    pub fn channel_messages_by_channel_id(&self, channel_id: &str) -> Vec<&SeedChannelMessage> {
        self.channel_messages
            .iter()
            .filter(|message| message.channel_id == channel_id)
            .collect()
    }

    /// Primary authenticated smoke-test user.
    pub fn smoke_user(&self) -> anyhow::Result<&SeedUser> {
        self.user_by_email(&self.manifest.user.email)
            .with_context(|| format!("missing local E2E user {}", self.manifest.user.email))
    }

    /// Project roadmap smoke-test document.
    pub fn project_roadmap_document(&self) -> anyhow::Result<&SeedDocument> {
        self.document_by_id(&self.manifest.documents.project_roadmap.id)
            .with_context(|| {
                format!(
                    "missing local E2E document {}",
                    self.manifest.documents.project_roadmap.id
                )
            })
    }

    /// General channel smoke-test fixture.
    pub fn general_channel(&self) -> anyhow::Result<&SeedChannel> {
        self.channel_by_id(&self.manifest.channels.general.id)
            .with_context(|| {
                format!(
                    "missing local E2E channel {}",
                    self.manifest.channels.general.id
                )
            })
    }

    /// Canonical welcome message in the general channel.
    pub fn general_welcome_message(&self) -> anyhow::Result<&SeedChannelMessage> {
        self.channel_messages
            .iter()
            .find(|message| {
                message.channel_id == self.manifest.channels.general.id
                    && message.content == self.manifest.channels.general.message
            })
            .with_context(|| {
                format!(
                    "missing local E2E general-channel message {:?}",
                    self.manifest.channels.general.message
                )
            })
    }
}

fn read_json<T>(path: &Path) -> anyhow::Result<T>
where
    T: for<'de> Deserialize<'de>,
{
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read seed file {}", path.display()))?;
    serde_json::from_str(&content)
        .with_context(|| format!("failed to parse seed file {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::LocalE2eSeed;

    #[test]
    fn loads_shared_seed_contract() {
        let seed = LocalE2eSeed::load().unwrap();

        let user = seed.smoke_user().unwrap();
        assert_eq!(user.email, seed.manifest.user.email);

        let document = seed.project_roadmap_document().unwrap();
        assert_eq!(
            document.document_id,
            seed.manifest.documents.project_roadmap.id
        );

        let channel = seed.general_channel().unwrap();
        assert_eq!(channel.channel_id, seed.manifest.channels.general.id);

        let message = seed.general_welcome_message().unwrap();
        assert_eq!(message.channel_id, channel.channel_id);
    }
}
