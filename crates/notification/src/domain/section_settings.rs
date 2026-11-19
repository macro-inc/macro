//! A user's own notification settings for Chat sidebar sections, and how they
//! combine with a channel's own settings when a notification is sent.
//!
//! A section's settings apply to every channel it holds for that user at
//! send time, so channels added to the section later follow it too. A
//! channel can sit in several sections: it notifies for a kind when any of
//! them allows it, and its sections mute it only when all of them are muted.
//! A section the user never changed allows everything and is unmuted. A
//! channel with its own settings uses them for every kind instead of its
//! sections', and muting the channel itself always wins.

use crate::domain::channel_settings::{ChannelNotificationKind, ChannelNotificationSettings};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    future::Future,
};
use uuid::Uuid;

/// A Chat sidebar section a user can set notifications for. The catch-all
/// "All channels" section has no settings and is not one of these.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChannelSection {
    /// A custom section, team-shared or personal, manual or rule-based.
    Label {
        /// The section's `channel_label` id.
        #[serde(rename = "labelId")]
        label_id: Uuid,
    },
    /// The user's favorite channels.
    Favorites,
    /// Direct messages and group chats.
    DirectMessages,
    /// Team channels in none of the user's custom sections.
    TeamChannels,
}

/// Whether a section is muted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SectionMute {
    /// The section's channels notify.
    #[default]
    Unmuted,
    /// Muted until the user unmutes it.
    Muted,
    /// Muted until a deadline.
    Snoozed {
        /// When the section notifies again.
        until: DateTime<Utc>,
    },
}

impl SectionMute {
    /// The mute as of `now`: a snooze that has ended no longer mutes.
    pub fn at(self, now: DateTime<Utc>) -> Self {
        match self {
            Self::Snoozed { until } if until <= now => Self::Unmuted,
            mute => mute,
        }
    }

    fn is_muted(self) -> bool {
        self != Self::Unmuted
    }
}

/// One user's settings for one section. A section without any allows every
/// kind and is unmuted.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SectionNotificationSettings {
    /// Kinds the section does not allow for its channels.
    pub disabled: BTreeSet<ChannelNotificationKind>,
    /// Whether the section is muted.
    pub mute: SectionMute,
}

impl SectionNotificationSettings {
    /// Whether the section has nothing set.
    pub fn is_empty(&self) -> bool {
        self.disabled.is_empty() && self.mute == SectionMute::Unmuted
    }
}

/// A change to one section's settings. Kinds the change does not name keep
/// their setting.
#[derive(Debug, Clone, Default)]
pub struct SectionNotificationSettingsChange {
    /// Kinds to allow.
    pub enable: BTreeSet<ChannelNotificationKind>,
    /// Kinds to stop allowing.
    pub disable: BTreeSet<ChannelNotificationKind>,
    /// The new mute; `None` keeps it.
    pub mute: Option<SectionMute>,
}

/// Persistence of section settings scoped to their owner.
pub trait SectionNotificationSettingsRepository: Send + Sync {
    /// This user's sections that have any settings. Ended snoozes read as unmuted.
    fn list(
        &self,
        user: MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<BTreeMap<ChannelSection, SectionNotificationSettings>, Report>> + Send;

    /// Apply a change atomically and return the section's resulting settings.
    /// A section left with nothing set loses its row.
    fn update(
        &self,
        user: MacroUserIdStr<'_>,
        section: ChannelSection,
        change: &SectionNotificationSettingsChange,
    ) -> impl Future<Output = Result<SectionNotificationSettings, SectionSettingsWriteError>> + Send;
}

/// A write the repository could not apply.
#[derive(Debug, thiserror::Error)]
pub enum SectionSettingsWriteError {
    /// The custom section does not exist.
    #[error("Section not found")]
    UnknownSection,
    /// Persistence failed.
    #[error("Could not update section notification settings: {0}")]
    Repository(Report),
}

/// A rejected section settings change.
#[derive(Debug, thiserror::Error)]
pub enum SectionNotificationSettingsError {
    /// A change must change something.
    #[error("Choose at least one notification setting to change")]
    EmptyChange,
    /// One kind cannot be allowed and disallowed at once.
    #[error("A notification can be set only one way at a time")]
    ConflictingChange,
    /// Snoozes must end in the future.
    #[error("Choose a snooze time in the future")]
    InvalidDeadline,
    /// The repository rejected or failed the write.
    #[error(transparent)]
    Write(#[from] SectionSettingsWriteError),
}

/// Manages a user's own section settings; they never change another user's delivery.
#[derive(Clone)]
pub struct SectionNotificationSettingsService<R> {
    repository: R,
}

impl<R: SectionNotificationSettingsRepository> SectionNotificationSettingsService<R> {
    /// Construct with the owning repository.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    /// The authenticated user's sections that have any settings.
    #[tracing::instrument(skip_all, err)]
    pub async fn list(
        &self,
        user: MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> Result<BTreeMap<ChannelSection, SectionNotificationSettings>, Report> {
        self.repository.list(user, now).await
    }

    /// Change the settings of one of the authenticated user's sections.
    #[tracing::instrument(
        skip_all,
        fields(
            section = ?section,
            enable_count = change.enable.len(),
            disable_count = change.disable.len(),
            mute = ?change.mute,
        ),
        err
    )]
    pub async fn update(
        &self,
        user: MacroUserIdStr<'_>,
        section: ChannelSection,
        change: SectionNotificationSettingsChange,
        now: DateTime<Utc>,
    ) -> Result<SectionNotificationSettings, SectionNotificationSettingsError> {
        if change.enable.is_empty() && change.disable.is_empty() && change.mute.is_none() {
            return Err(SectionNotificationSettingsError::EmptyChange);
        }

        if !change.enable.is_disjoint(&change.disable) {
            return Err(SectionNotificationSettingsError::ConflictingChange);
        }

        if let Some(SectionMute::Snoozed { until }) = change.mute
            && until <= now
        {
            return Err(SectionNotificationSettingsError::InvalidDeadline);
        }

        let mut updated = self.repository.update(user, section, &change).await?;
        updated.mute = updated.mute.at(now);
        Ok(updated)
    }
}

/// Which sections hold a channel, for each of some users, as their Chat
/// sidebar shows it.
#[derive(Debug, Clone, Default)]
pub struct ChannelSectionMembership {
    /// The built-in section the channel falls in for a user whose custom
    /// sections don't hold it: direct messages or team channels. `None` for
    /// a channel that falls in "All channels", which has no settings.
    pub built_in: Option<ChannelSection>,
    /// The custom sections holding the channel, per user. Users without any
    /// are omitted.
    pub labels: HashMap<MacroUserIdStr<'static>, Vec<Uuid>>,
    /// Users who have the channel in their favorites.
    pub favorites: HashSet<MacroUserIdStr<'static>>,
}

impl ChannelSectionMembership {
    /// The sections holding the channel for one user.
    pub fn sections_for(&self, user: &MacroUserIdStr<'_>) -> Vec<ChannelSection> {
        let labels = self.labels.get(user).map(Vec::as_slice).unwrap_or_default();
        let mut sections: Vec<_> = labels
            .iter()
            .map(|&label_id| ChannelSection::Label { label_id })
            .collect();

        // The sidebar lists a channel in a built-in section only when none of
        // the user's custom sections holds it.
        if sections.is_empty()
            && let Some(built_in) = self.built_in
        {
            sections.push(built_in);
        }

        if self.favorites.contains(user) {
            sections.push(ChannelSection::Favorites);
        }

        sections
    }
}

/// Resolves which sections hold a channel. Section storage belongs to the
/// channel sections domain, so it implements this port.
pub trait ChannelSectionMembershipReader: Send + Sync + 'static {
    /// Memberships of the channel for these users.
    fn memberships<'a>(
        &self,
        channel_id: Uuid,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> impl Future<Output = Result<ChannelSectionMembership, Report>> + Send;
}

/// A deployment without sidebar sections: no channel is in any section, so
/// section settings never apply.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoChannelSections;

impl ChannelSectionMembershipReader for NoChannelSections {
    async fn memberships<'a>(
        &self,
        _channel_id: Uuid,
        _user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<ChannelSectionMembership, Report> {
        Ok(ChannelSectionMembership::default())
    }
}

/// Whether one user receives one channel notification under their settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelDelivery {
    /// The user receives it.
    Receive,
    /// The channel's or its sections' settings turn this kind off.
    TurnedOff,
    /// Every section holding the channel is muted.
    MutedBySections,
}

/// Decide one user's delivery of a channel notification of `kind` (`None`
/// for a channel notification no setting controls, which only a section
/// mute can stop).
///
/// `sections` are the sections holding the channel for the user, and
/// `section_settings` the user's settings for any of their sections. Muting
/// the channel itself is checked elsewhere and always wins.
pub fn channel_delivery(
    kind: Option<ChannelNotificationKind>,
    channel: Option<&ChannelNotificationSettings>,
    sections: &[ChannelSection],
    section_settings: &BTreeMap<ChannelSection, SectionNotificationSettings>,
    now: DateTime<Utc>,
) -> ChannelDelivery {
    let default_settings = SectionNotificationSettings::default();
    let settings_of =
        |section: &ChannelSection| section_settings.get(section).unwrap_or(&default_settings);

    let overrides_section_mute = channel.is_some_and(|channel| channel.overrides_section_mute);
    let muted_by_sections = !sections.is_empty()
        && sections
            .iter()
            .all(|section| settings_of(section).mute.at(now).is_muted());
    if muted_by_sections && !overrides_section_mute {
        return ChannelDelivery::MutedBySections;
    }

    let Some(kind) = kind else {
        return ChannelDelivery::Receive;
    };

    // A channel with its own settings ignores its sections' kinds.
    if let Some(enabled) = channel.and_then(|channel| channel.enabled.as_ref()) {
        return if enabled.contains(&kind) {
            ChannelDelivery::Receive
        } else {
            ChannelDelivery::TurnedOff
        };
    }

    // A channel outside every section, or in one that allows the kind,
    // receives it.
    let sections_allow = sections.is_empty()
        || sections
            .iter()
            .any(|section| !settings_of(section).disabled.contains(&kind));
    if sections_allow {
        ChannelDelivery::Receive
    } else {
        ChannelDelivery::TurnedOff
    }
}

#[cfg(test)]
mod test;
