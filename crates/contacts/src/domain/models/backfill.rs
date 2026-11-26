//! What the backfill reads from the legacy directory and its sources: channels
//! and their members, the April 2026 channel snapshot, inboxes, and legacy
//! edges with the evidence the audit reads for them.

use crate::domain::models::list::InboxProvider;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// The type of a channel, as stored.
#[derive(Clone, Copy, Debug, Eq, PartialEq, strum::EnumString, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum ChannelType {
    /// Anyone in the workspace can join.
    Public,
    /// Members are added by other members.
    Private,
    /// A team's channel.
    Team,
    /// A conversation between two people.
    DirectMessage,
}

/// A channel, read in id order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChannelRecord {
    /// The channel id.
    pub id: Uuid,
    /// Its type.
    pub channel_type: ChannelType,
    /// A private channel named like a signup support channel
    /// (`Macro Support x …`). It is one when it also holds a support-roster
    /// address.
    pub support_name: bool,
}

/// A Macro user's participant row in a channel. Bots and deleted accounts are
/// never read.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChannelMember {
    /// The channel.
    pub channel_id: Uuid,
    /// The member.
    pub user: MacroUserIdStr<'static>,
    /// When they joined.
    pub joined_at: DateTime<Utc>,
    /// When they left, if the row was kept. People's rows are deleted when
    /// they leave, so this is almost always empty.
    pub left_at: Option<DateTime<Utc>>,
}

/// One channel's participants as `contacts_backfill_outbox` recorded them in
/// April 2026, which still names people whose rows were since deleted.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChannelSnapshot {
    /// The outbox row id, the read order.
    pub id: i32,
    /// The channel.
    pub channel_id: Uuid,
    /// When the snapshot was taken.
    pub taken_at: DateTime<Utc>,
    /// The Macro users it lists that still have an account.
    pub users: Vec<MacroUserIdStr<'static>>,
}

/// A connected inbox.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Inbox {
    /// The `email_links` id.
    pub link_id: Uuid,
    /// Its provider.
    pub provider: InboxProvider,
}

/// A user with connected inboxes, read in owner order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InboxOwner {
    /// The owner exactly as `email_links` stores it, which is also how their
    /// legacy edges name them.
    pub owner: String,
    /// The owner's inboxes that are not being disconnected.
    pub inboxes: Vec<Inbox>,
}

/// One of an inbox owner's legacy contacts and the owner's inboxes that know
/// them.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InboxContact {
    /// The contact exactly as the legacy edge stores it; also the page cursor.
    pub peer: String,
    /// The owner's inboxes whose address book or correspondents hold the
    /// contact's address. Empty when none does.
    pub link_ids: Vec<Uuid>,
}

/// A legacy `contacts_connections` edge with the evidence for each direction
/// that the database holds. Channel and DM evidence comes from the loaded
/// channels instead.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct LegacyEdge {
    /// The edge id, the read order.
    pub id: i32,
    /// One end, as stored.
    pub user1: String,
    /// The other end, as stored.
    pub user2: String,
    /// Both are on the same team now.
    pub teammates: bool,
    /// `user1`'s invited list already holds `user2`.
    pub user1_invited_user2: bool,
    /// `user2`'s invited list already holds `user1`.
    pub user2_invited_user1: bool,
    /// One of `user1`'s inboxes knows `user2`.
    pub user1_inbox_has_user2: bool,
    /// One of `user2`'s inboxes knows `user1`.
    pub user2_inbox_has_user1: bool,
    /// `user1` once had an inbox that is now disconnected.
    pub user1_disconnected_inbox: bool,
    /// `user2` once had an inbox that is now disconnected.
    pub user2_disconnected_inbox: bool,
    /// One referred the other to Macro.
    pub referral: bool,
}

/// List rows that can outlive the account they belong to. Account deletion
/// removes them only once `contacts-list-writes` is on, so the backfill sweeps
/// what deletions left behind while it was off.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OrphanKind {
    /// `contact_list_members` rows whose owner has no account.
    ListOwner,
    /// `contact_inbox_members` rows whose owner has no account.
    InboxOwner,
    /// `interacted` rows whose contact has no account. Invited and inbox
    /// contacts may be addresses without one, so their rows stay.
    InteractedContact,
}

/// An owner or contact a sweep page read.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrphanCheck {
    /// The id as the list stores it; also the page cursor.
    pub id: String,
    /// Their rows of the swept kind when no account matches them; empty when
    /// one does.
    pub orphaned_rows: Option<i64>,
}
