//! Viewer-aware channel names, as a port. A channel is known by its stored
//! name when it has one; DMs and unnamed private channels by the other
//! participants. Adapters that need a channel's display name (call previews,
//! search) take a [`ChannelNames`] instead of the Postgres implementation,
//! `channels_outbound::channel_name::PgChannelNames`, which the composition
//! root supplies.

use std::{collections::HashMap, future::Future, pin::Pin};

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::ChannelType;

/// The future a [`ChannelNames`] method returns, boxed so the port can be held
/// as `Arc<dyn ChannelNames<Err = _>>`.
pub type ChannelNamesFuture<'a, T, E> = Pin<Box<dyn Future<Output = Result<T, E>> + Send + 'a>>;

/// A channel whose viewer-facing name matched a [`ChannelNameSearch`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelNameMatch {
    /// The matched channel.
    pub channel_id: Uuid,
    /// The channel's `updated_at`, which orders the matches.
    pub updated_at: DateTime<Utc>,
}

/// A name search over the channels a viewer actively participates in.
#[derive(Debug)]
pub struct ChannelNameSearch<'a> {
    /// Whose channels to search, and whose view of each name to match.
    pub viewer_user_id: MacroUserIdStr<'a>,
    /// One pattern per search term. A channel matches when every pattern
    /// matches its stored name or the display name of some participant other
    /// than the viewer.
    pub patterns: &'a [String],
    /// Patterns are case-insensitive POSIX regexes when set, `ILIKE` patterns
    /// otherwise.
    pub regex_patterns: bool,
    /// Only these channels; empty means every channel.
    pub channel_ids: &'a [Uuid],
    /// Only these channel types; empty means every type.
    pub channel_types: &'a [ChannelType],
    /// Keyset cursor: only channels ordered strictly after `(updated_at, id)`.
    pub after: Option<(DateTime<Utc>, Uuid)>,
    /// Maximum number of channels to return.
    pub limit: i64,
}

/// Resolves and searches channel names as a viewer sees them.
pub trait ChannelNames: Send + Sync + 'static {
    /// The adapter's error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Display names for `channel_ids` from `viewer_user_id`'s perspective.
    fn batch_resolve_channel_names<'a>(
        &'a self,
        channel_ids: &'a [Uuid],
        viewer_user_id: MacroUserIdStr<'a>,
    ) -> ChannelNamesFuture<'a, HashMap<Uuid, String>, Self::Err>;

    /// One channel's display name for each of `viewer_user_ids`.
    fn resolve_channel_name_for_viewers<'a>(
        &'a self,
        channel_id: Uuid,
        viewer_user_ids: &'a [MacroUserIdStr<'a>],
    ) -> ChannelNamesFuture<'a, HashMap<MacroUserIdStr<'static>, String>, Self::Err>;

    /// Channels whose name as the viewer sees it matches every pattern of
    /// `search`, newest `updated_at` first.
    fn match_channel_names<'a>(
        &'a self,
        search: ChannelNameSearch<'a>,
    ) -> ChannelNamesFuture<'a, Vec<ChannelNameMatch>, Self::Err>;
}
