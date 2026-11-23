//! Classifies each direction of a legacy edge (owner sees contact) by why the
//! owner has that contact, so reviewers can see what the cutover keeps and
//! what it drops before the new reads ramp. Explained directions are the
//! ones the new lists hold: computed teammates, rows the backfill writes, and
//! invited rows referral invites already wrote.

use super::channels::{ChannelDirectory, ChannelProjection, ChannelRelation};
use crate::domain::models::backfill::{ChannelType, LegacyEdge};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Serialize;
use std::collections::BTreeMap;

#[cfg(test)]
mod test;

/// Why an owner has a legacy contact. Each direction gets the first class
/// that applies, explained ones first.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectionClass {
    /// Explained: on the same team now (Teammates, computed live).
    Teammate,
    /// Explained: shared a channel (`interacted`).
    SharedChannel,
    /// Explained: their DM has a message from one of them (`interacted`).
    DmWithMessage,
    /// Explained: one of the owner's inboxes knows the contact (`gmail` or
    /// `outlook`).
    Inbox,
    /// Kept: a referral invite already put the contact in the owner's
    /// `invited` list.
    Invited,
    /// Unexplained: only the contact's inbox knows the owner, the reverse
    /// direction of an import.
    ReverseImport,
    /// Unexplained: their only conversation is an empty DM.
    EmptyDm,
    /// Unexplained: they only share a signup support channel.
    SupportChannel,
    /// Unexplained: one referred the other.
    Referral,
    /// Unexplained: the owner disconnected an inbox, which may have been the
    /// source.
    DisconnectedInbox,
    /// Unexplained, with nothing left to say why: former co-members whose
    /// rows were deleted after the snapshot, ex-teammates who never shared a
    /// channel, referral adds without a referral record.
    NoSurvivingRecord,
    /// An end is not a valid Macro user id.
    InvalidId,
}

impl DirectionClass {
    /// Whether the new directory keeps this direction.
    pub fn explained(self) -> bool {
        matches!(
            self,
            Self::Teammate
                | Self::SharedChannel
                | Self::DmWithMessage
                | Self::Inbox
                | Self::Invited
        )
    }
}

/// The evidence for one direction.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct DirectionEvidence {
    /// On the same team now.
    pub teammates: bool,
    /// What their channels say.
    pub channels: ChannelRelation,
    /// The owner's inbox knows the contact.
    pub owner_inbox: bool,
    /// The owner's invited list holds the contact.
    pub owner_invited: bool,
    /// The contact's inbox knows the owner.
    pub contact_inbox: bool,
    /// The owner disconnected an inbox.
    pub owner_disconnected_inbox: bool,
    /// One referred the other.
    pub referral: bool,
}

impl DirectionEvidence {
    /// The direction's class.
    pub fn class(&self) -> DirectionClass {
        if self.teammates {
            DirectionClass::Teammate
        } else if self.channels.shared_channel {
            DirectionClass::SharedChannel
        } else if self.channels.direct_message == Some(true) {
            DirectionClass::DmWithMessage
        } else if self.owner_inbox {
            DirectionClass::Inbox
        } else if self.owner_invited {
            DirectionClass::Invited
        } else if self.contact_inbox {
            DirectionClass::ReverseImport
        } else if self.channels.direct_message == Some(false) {
            DirectionClass::EmptyDm
        } else if self.channels.support_channel {
            DirectionClass::SupportChannel
        } else if self.referral {
            DirectionClass::Referral
        } else if self.owner_disconnected_inbox {
            DirectionClass::DisconnectedInbox
        } else {
            DirectionClass::NoSurvivingRecord
        }
    }
}

/// How many directions carry each piece of evidence, whatever their class.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct EvidenceCounts {
    /// Same team now.
    pub teammates: u64,
    /// Shared a channel.
    pub shared_channel: u64,
    /// DM with a message.
    pub dm_with_message: u64,
    /// Empty DM.
    pub empty_dm: u64,
    /// Signup support channel.
    pub support_channel: u64,
    /// Owner's inbox knows the contact.
    pub owner_inbox: u64,
    /// Owner's invited list holds the contact.
    pub owner_invited: u64,
    /// Contact's inbox knows the owner.
    pub contact_inbox: u64,
    /// One referred the other.
    pub referral: u64,
    /// Owner disconnected an inbox.
    pub owner_disconnected_inbox: u64,
}

/// The legacy graph's directions by class.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct LegacyAudit {
    /// Edges read.
    pub edges: u64,
    /// Directions classified (two per edge).
    pub directions: u64,
    /// Directions the new directory keeps.
    pub explained: u64,
    /// Directions it drops.
    pub unexplained: u64,
    /// Directions by class.
    pub classes: BTreeMap<DirectionClass, u64>,
    /// Directions by evidence, overlapping.
    pub evidence: EvidenceCounts,
}

impl LegacyAudit {
    /// Classify both directions of an edge.
    pub fn add_edge(&mut self, edge: &LegacyEdge, channels: &ChannelDirectory) {
        self.edges += 1;
        let ends = (
            MacroUserIdStr::try_from(edge.user1.clone()),
            MacroUserIdStr::try_from(edge.user2.clone()),
        );
        let (Ok(user1), Ok(user2)) = ends else {
            self.add_class(DirectionClass::InvalidId);
            self.add_class(DirectionClass::InvalidId);
            return;
        };

        let relation = channels.relation(&user1, &user2);
        let forward = DirectionEvidence {
            teammates: edge.teammates,
            channels: relation,
            owner_inbox: edge.user1_inbox_has_user2,
            owner_invited: edge.user1_invited_user2,
            contact_inbox: edge.user2_inbox_has_user1,
            owner_disconnected_inbox: edge.user1_disconnected_inbox,
            referral: edge.referral,
        };
        let backward = DirectionEvidence {
            owner_inbox: edge.user2_inbox_has_user1,
            owner_invited: edge.user2_invited_user1,
            contact_inbox: edge.user1_inbox_has_user2,
            owner_disconnected_inbox: edge.user2_disconnected_inbox,
            ..forward
        };
        self.add_direction(&forward);
        self.add_direction(&backward);
    }

    fn add_direction(&mut self, evidence: &DirectionEvidence) {
        let counts = &mut self.evidence;
        counts.teammates += u64::from(evidence.teammates);
        counts.shared_channel += u64::from(evidence.channels.shared_channel);
        counts.dm_with_message += u64::from(evidence.channels.direct_message == Some(true));
        counts.empty_dm += u64::from(evidence.channels.direct_message == Some(false));
        counts.support_channel += u64::from(evidence.channels.support_channel);
        counts.owner_inbox += u64::from(evidence.owner_inbox);
        counts.owner_invited += u64::from(evidence.owner_invited);
        counts.contact_inbox += u64::from(evidence.contact_inbox);
        counts.referral += u64::from(evidence.referral);
        counts.owner_disconnected_inbox += u64::from(evidence.owner_disconnected_inbox);
        self.add_class(evidence.class());
    }

    fn add_class(&mut self, class: DirectionClass) {
        self.directions += 1;
        if class.explained() {
            self.explained += 1;
        } else {
            self.unexplained += 1;
        }
        *self.classes.entry(class).or_default() += 1;
    }
}

/// Upper bounds of each channel-size bucket; the last bucket is open.
const SIZE_BUCKETS: [u64; 10] = [2, 5, 10, 25, 50, 100, 250, 500, 1000, 5000];

/// How many of the largest channels the projection names.
const LARGEST_CHANNELS: usize = 20;

/// Projected `interacted` rows from one bucket of channel sizes.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct SizeBucket {
    /// The bucket, by Macro members (`"3-5"`, `"5001+"`).
    pub members: String,
    /// Shared channels in it.
    pub channels: u64,
    /// Rows its participants produce.
    pub rows: u64,
    /// Further rows from people only the snapshot lists.
    pub snapshot_rows: u64,
}

/// One of the largest channels.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct LargeChannel {
    /// The channel id.
    pub channel_id: String,
    /// Its type.
    pub channel_type: String,
    /// Macro members.
    pub members: u64,
    /// Rows its participants produce.
    pub rows: u64,
}

/// Projected `interacted` rows, before anything is written. Rows are counted
/// per source, so a pair two channels share counts twice; the written count
/// is lower.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct InteractedProjection {
    /// Rows from shared channels' participants and snapshots.
    pub channel_rows: u64,
    /// Rows from DMs with a message: two per DM.
    pub dm_rows: u64,
    /// Shared channels and their rows by member count. Channels with fewer
    /// than two members are in `"0-1"`.
    pub by_channel_size: Vec<SizeBucket>,
    /// Rows by channel type.
    pub by_channel_type: BTreeMap<String, u64>,
    /// The channels with the most members.
    pub largest_channels: Vec<LargeChannel>,
}

impl InteractedProjection {
    /// Project rows from the loaded channels.
    pub fn new(channels: &ChannelDirectory) -> Self {
        let mut buckets: Vec<SizeBucket> = std::iter::once("0-1".to_owned())
            .chain(SIZE_BUCKETS.iter().enumerate().map(|(index, upper)| {
                let lower = if index == 0 {
                    2
                } else {
                    SIZE_BUCKETS[index - 1] + 1
                };
                if lower == *upper {
                    upper.to_string()
                } else {
                    format!("{lower}-{upper}")
                }
            }))
            .chain(std::iter::once(format!(
                "{}+",
                SIZE_BUCKETS[SIZE_BUCKETS.len() - 1] + 1
            )))
            .map(|members| SizeBucket {
                members,
                ..SizeBucket::default()
            })
            .collect();

        let mut projection = Self::default();
        let mut projections = channels.projections();
        for channel in &projections {
            let bucket = if channel.members < 2 {
                0
            } else {
                1 + SIZE_BUCKETS
                    .iter()
                    .position(|upper| channel.members <= *upper)
                    .unwrap_or(SIZE_BUCKETS.len())
            };
            buckets[bucket].channels += 1;
            buckets[bucket].rows += channel.rows;
            buckets[bucket].snapshot_rows += channel.snapshot_rows;

            let rows = channel.rows + channel.snapshot_rows;
            projection.channel_rows += rows;
            *projection
                .by_channel_type
                .entry(type_name(channel.channel_type))
                .or_default() += rows;
        }

        projections.sort_by(|a, b| {
            b.members
                .cmp(&a.members)
                .then(a.channel_id.cmp(&b.channel_id))
        });
        projection.largest_channels = projections
            .iter()
            .take(LARGEST_CHANNELS)
            .map(|channel: &ChannelProjection| LargeChannel {
                channel_id: channel.channel_id.to_string(),
                channel_type: type_name(channel.channel_type),
                members: channel.members,
                rows: channel.rows,
            })
            .collect();
        projection.by_channel_size = buckets;
        projection.dm_rows = channels.direct_message_writes().len() as u64 * 2;
        projection
    }
}

fn type_name(channel_type: ChannelType) -> String {
    channel_type.as_ref().to_owned()
}
