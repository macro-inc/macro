//! A user's per-channel choice of which channel notifications they receive.
//!
//! A channel either follows its sections for every kind (with no section
//! setting either, every kind is on), or has its own settings for all six,
//! which replace its sections'. There is no mix of the two. These settings are
//! independent of mute and snooze ([`crate::domain::item_preferences`]): a
//! muted channel sends nothing, and resuming it restores exactly the kinds
//! chosen here.

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
};
use uuid::Uuid;

/// A channel notification a user can turn off for one channel.
///
/// Each kind is one notification event type, which is also its wire form.
/// A message that mentions a document follows the kind of its message: a
/// top-level message outside a thread, a thread reply inside one (its
/// producer says which, see [`crate::domain::models::request`]). Channel
/// invites are not here: they reach people as they join, before they could
/// have chosen anything.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
    strum::EnumString,
    strum::IntoStaticStr,
    strum::EnumIter,
)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum ChannelNotificationKind {
    /// A message posted outside a thread.
    #[serde(rename = "channel_message_send")]
    #[strum(serialize = "channel_message_send")]
    TopLevelMessage,
    /// A reply in a thread the user is part of.
    #[serde(rename = "channel_message_reply")]
    #[strum(serialize = "channel_message_reply")]
    ThreadReply,
    /// A message that @mentions the user, including @here.
    #[serde(rename = "channel_mention")]
    #[strum(serialize = "channel_mention")]
    Mention,
    /// A reaction to one of the user's messages.
    #[serde(rename = "channel_message_reaction")]
    #[strum(serialize = "channel_message_reaction")]
    Reaction,
    /// A call started in the channel.
    #[serde(rename = "call_started")]
    #[strum(serialize = "call_started")]
    CallStarted,
    /// Someone asked to join the channel.
    #[serde(rename = "channel_access_requested")]
    #[strum(serialize = "channel_access_requested")]
    JoinRequest,
}

/// One user's own settings for one channel. A channel without any has no settings.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ChannelNotificationSettings {
    /// The channel's own settings: exactly the kinds it notifies for,
    /// whatever its sections say. `None` follows the sections.
    pub enabled: Option<BTreeSet<ChannelNotificationKind>>,
    /// The channel notifies even when the sections holding it are muted.
    /// Muting the channel itself still silences it.
    pub overrides_section_mute: bool,
}

impl ChannelNotificationSettings {
    /// Whether nothing is set, so the channel follows its sections entirely.
    pub fn is_empty(&self) -> bool {
        self.enabled.is_none() && !self.overrides_section_mute
    }
}

/// What a change does to a channel's kinds.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum ChannelKindsChange {
    /// Keep the current kinds.
    #[default]
    Keep,
    /// Give the channel its own settings: exactly these kinds notify.
    Set(BTreeSet<ChannelNotificationKind>),
    /// Drop the channel's own kinds so it follows its sections again.
    Inherit,
}

/// A change to one channel's settings.
#[derive(Debug, Clone, Default)]
pub struct ChannelNotificationSettingsChange {
    /// What happens to the channel's kinds.
    pub kinds: ChannelKindsChange,
    /// Set or clear the section mute override; `None` keeps it.
    pub overrides_section_mute: Option<bool>,
}

/// Persistence of channel settings scoped to their owner.
pub trait ChannelNotificationSettingsRepository: Send + Sync {
    /// This user's channels that have any settings, by channel.
    fn list(
        &self,
        user: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<BTreeMap<Uuid, ChannelNotificationSettings>, Report>> + Send;

    /// Apply a change atomically and return the channel's resulting settings.
    /// A channel left with no settings loses its row. A change to the kinds
    /// also drops the channel's legacy mentions-only preference, which these
    /// settings replace.
    fn update(
        &self,
        user: MacroUserIdStr<'_>,
        channel_id: Uuid,
        change: &ChannelNotificationSettingsChange,
    ) -> impl Future<Output = Result<ChannelNotificationSettings, ChannelSettingsWriteError>> + Send;

    /// Remove every setting on this user's channel, including a legacy
    /// mentions-only preference, so it follows its sections.
    fn reset(
        &self,
        user: MacroUserIdStr<'_>,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// A write the repository could not apply.
#[derive(Debug, thiserror::Error)]
pub enum ChannelSettingsWriteError {
    /// The channel does not exist.
    #[error("Channel not found")]
    UnknownChannel,
    /// Persistence failed.
    #[error("Could not update channel notification settings: {0}")]
    Repository(Report),
}

/// A rejected settings change.
#[derive(Debug, thiserror::Error)]
pub enum ChannelNotificationSettingsError {
    /// A change must change something.
    #[error("Choose at least one notification setting to change")]
    EmptyChange,
    /// The repository rejected or failed the write.
    #[error(transparent)]
    Write(#[from] ChannelSettingsWriteError),
}

/// Manages a user's own channel settings; they never change another user's delivery.
#[derive(Clone)]
pub struct ChannelNotificationSettingsService<R> {
    repository: R,
}

impl<R: ChannelNotificationSettingsRepository> ChannelNotificationSettingsService<R> {
    /// Construct with the owning repository.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    /// The authenticated user's channels that have any settings, by channel.
    #[tracing::instrument(skip_all, err)]
    pub async fn list(
        &self,
        user: MacroUserIdStr<'_>,
    ) -> Result<BTreeMap<Uuid, ChannelNotificationSettings>, Report> {
        self.repository.list(user).await
    }

    /// Change the settings of one of the authenticated user's channels.
    #[tracing::instrument(
        skip_all,
        fields(
            channel_id = %channel_id,
            kinds = ?change.kinds,
            overrides_section_mute = ?change.overrides_section_mute,
        ),
        err
    )]
    pub async fn update(
        &self,
        user: MacroUserIdStr<'_>,
        channel_id: Uuid,
        change: ChannelNotificationSettingsChange,
    ) -> Result<ChannelNotificationSettings, ChannelNotificationSettingsError> {
        if change.kinds == ChannelKindsChange::Keep && change.overrides_section_mute.is_none() {
            return Err(ChannelNotificationSettingsError::EmptyChange);
        }

        Ok(self.repository.update(user, channel_id, &change).await?)
    }

    /// Remove every setting on one of the authenticated user's channels, so
    /// it follows its sections again.
    #[tracing::instrument(skip_all, fields(channel_id = %channel_id), err)]
    pub async fn reset(&self, user: MacroUserIdStr<'_>, channel_id: Uuid) -> Result<(), Report> {
        self.repository.reset(user, channel_id).await
    }
}

#[cfg(test)]
mod test;
