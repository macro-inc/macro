// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow types/group.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Go embeds the `GroupName`, `GroupTopic`, … structs in `GroupInfo`; here
// they are named fields. Go's zero `time.Time` is `None`.

use chrono::{DateTime, Utc};

use super::{AddressingMode, Jid};

string_enum! {
    /// Who can add members to a group.
    #[derive(Default)]
    pub enum GroupMemberAddMode {
        /// Only admins.
        Admin = "admin_add",
        /// Every member.
        AllMember = "all_member_add",
        /// Not set.
        #[default]
        Empty = "",
    }
}

/// Basic information about a group chat on WhatsApp.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupInfo {
    /// The group.
    pub jid: Jid,
    /// The owner.
    pub owner_jid: Jid,
    /// The owner's phone number JID.
    pub owner_pn: Jid,

    /// The name.
    pub name: GroupName,
    /// The topic (description).
    pub topic: GroupTopic,
    /// Whether only admins can edit group info.
    pub locked: GroupLocked,
    /// Whether only admins can send messages.
    pub announce: GroupAnnounce,
    /// Disappearing messages.
    pub ephemeral: GroupEphemeral,
    /// Incognito mode.
    pub incognito: GroupIncognito,

    /// Community parent settings.
    pub parent: GroupParent,
    /// The linked community.
    pub linked_parent: GroupLinkedParent,
    /// Whether this is the community's default subgroup.
    pub is_default_sub: GroupIsDefaultSub,
    /// Membership approval.
    pub membership_approval_mode: GroupMembershipApprovalMode,

    /// Whether members are addressed by phone number or LID.
    pub addressing_mode: AddressingMode,
    /// When the group was created.
    pub group_created: Option<DateTime<Utc>>,
    /// The creator's country code.
    pub creator_country_code: String,

    /// The participant list version.
    pub participant_version_id: String,
    /// The participants.
    pub participants: Vec<GroupParticipant>,
    /// The number of participants.
    pub participant_count: i64,

    /// Who can add members.
    pub member_add_mode: GroupMemberAddMode,

    /// Whether the group is currently paused/suspended.
    pub suspended: bool,
}

/// Whether joining needs admin approval.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupMembershipApprovalMode {
    /// Whether joining needs approval.
    pub is_join_approval_required: bool,
}

/// Community parent settings.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupParent {
    /// Whether the group is a community.
    pub is_parent: bool,
    /// The default membership approval mode (`request_required`).
    pub default_membership_approval_mode: String,
}

/// The community a group is linked to.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupLinkedParent {
    /// The community.
    pub linked_parent_jid: Jid,
}

/// Whether a group is a community's default subgroup.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupIsDefaultSub {
    /// Whether it is the default subgroup.
    pub is_default_sub_group: bool,
}

/// The name of a group along with who set it and when.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupName {
    /// The name.
    pub name: String,
    /// When it was set.
    pub name_set_at: Option<DateTime<Utc>>,
    /// Who set it.
    pub name_set_by: Jid,
    /// The phone number JID of who set it.
    pub name_set_by_pn: Jid,
}

/// The topic (description) of a group along with who set it and when.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupTopic {
    /// The topic.
    pub topic: String,
    /// The topic ID.
    pub topic_id: String,
    /// When it was set.
    pub topic_set_at: Option<DateTime<Utc>>,
    /// Who set it.
    pub topic_set_by: Jid,
    /// The phone number JID of who set it.
    pub topic_set_by_pn: Jid,
    /// Whether it was deleted.
    pub topic_deleted: bool,
}

/// Whether the group info can only be edited by admins.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupLocked {
    /// Whether it is locked.
    pub is_locked: bool,
}

/// Whether only admins can send messages in the group.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupAnnounce {
    /// Whether it is announce-only.
    pub is_announce: bool,
    /// The announce setting version.
    pub announce_version_id: String,
}

/// Incognito mode.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupIncognito {
    /// Whether it is incognito.
    pub is_incognito: bool,
}

/// A participant of a WhatsApp group chat.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupParticipant {
    /// The primary JID to send messages to this participant: either the LID
    /// or the phone number.
    pub jid: Jid,
    /// The phone number JID.
    pub phone_number: Jid,
    /// The LID.
    pub lid: Jid,

    /// Whether the participant is an admin.
    pub is_admin: bool,
    /// Whether the participant is the super admin.
    pub is_super_admin: bool,

    /// Only for anonymous users in announcement groups: an obfuscated phone number.
    pub display_name: String,

    /// When creating groups, adding some participants may fail with this code.
    pub error: i64,
    /// The invite sent instead of adding the participant.
    pub add_request: Option<GroupParticipantAddRequest>,
}

/// An invite sent instead of adding a participant directly.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupParticipantAddRequest {
    /// The invite code.
    pub code: String,
    /// When it expires.
    pub expiration: Option<DateTime<Utc>>,
}

/// The group's disappearing messages settings.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupEphemeral {
    /// Whether messages disappear.
    pub is_ephemeral: bool,
    /// The timer in seconds.
    pub disappearing_timer: u32,
}

/// A group deletion.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupDelete {
    /// Whether the group was deleted.
    pub deleted: bool,
    /// Why.
    pub delete_reason: String,
}

string_enum! {
    /// How a group was linked to another.
    #[derive(Default)]
    pub enum GroupLinkChangeType {
        /// To a parent community.
        Parent = "parent_group",
        /// To a subgroup.
        Sub = "sub_group",
        /// To a sibling.
        Sibling = "sibling_group",
        /// Not set.
        #[default]
        Empty = "",
    }
}

string_enum! {
    /// Why a group was unlinked.
    #[derive(Default)]
    pub enum GroupUnlinkReason {
        /// Unlinked.
        Default = "unlink_group",
        /// The parent was deleted.
        Delete = "delete_parent",
        /// Not set.
        #[default]
        Empty = "",
    }
}

/// The other group of a link change.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupLinkTarget {
    /// The group.
    pub jid: Jid,
    /// Its name.
    pub name: GroupName,
    /// Whether it is the default subgroup.
    pub is_default_sub: GroupIsDefaultSub,
}

/// A group link change.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupLinkChange {
    /// How the groups are linked.
    pub r#type: GroupLinkChangeType,
    /// Why they were unlinked.
    pub unlink_reason: GroupUnlinkReason,
    /// The other group.
    pub group: GroupLinkTarget,
}

/// A request to join a group.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GroupParticipantRequest {
    /// Who asked.
    pub jid: Jid,
    /// When.
    pub requested_at: Option<DateTime<Utc>>,
}
