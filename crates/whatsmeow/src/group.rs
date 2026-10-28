// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow group.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Not ported: community administration (`LinkGroup`, `UnlinkGroup`,
// `GetSubGroups`, `GetLinkedGroupsParticipants`) and the deprecated
// `SetGroupDescription`. Creating a community or a group inside one works
// through `ReqCreateGroup`.
//
// `parseGroupNode` returns the group along with the attribute errors; here
// it's a tuple of both. Errors leave out the JIDs and XML Go formats into
// them, since `err` spans log them.

//! Groups: info, membership and settings.

use std::collections::HashMap;
use std::sync::Arc;

use crate::binary::{AttrUtility, AttributeValue, Attrs, ErrorList, Node, NodeContent};
use crate::client::{Client, GroupMetaCache};
use crate::errors::{ClientError, IqError, element_missing, wrap_iq_error};
use crate::request::{InfoQuery, IqType};
use crate::store::{LidMapping, RedactedPhoneEntry};
use crate::types::events::{GroupInfo as GroupInfoEvent, JoinedGroup};
use crate::types::{
    AddressingMode, DEFAULT_USER_SERVER, GROUP_SERVER, GROUP_SERVER_JID, GroupAnnounce,
    GroupDelete, GroupEphemeral, GroupInfo, GroupLinkChange, GroupLinkChangeType, GroupLinkTarget,
    GroupLinkedParent, GroupLocked, GroupMemberAddMode, GroupMembershipApprovalMode, GroupName,
    GroupParent, GroupParticipant, GroupParticipantAddRequest, GroupParticipantRequest, GroupTopic,
    GroupUnlinkReason, HIDDEN_USER_SERVER, Jid, SERVER_JID, new_jid,
};
use crate::user::strip_url_prefix;

/// The prefix of group invite links.
pub const INVITE_LINK_PREFIX: &str = "https://chat.whatsapp.com/";

/// The request data for [`Client::create_group`].
#[derive(Clone, Debug, Default)]
pub struct ReqCreateGroup {
    /// The group name, up to 25 characters (longer names fail with 406).
    pub name: String,
    /// The participants; your own JID is added implicitly.
    pub participants: Vec<Jid>,
    /// Disappearing messages.
    pub ephemeral: GroupEphemeral,
    /// Whether only admins can send messages.
    pub announce: GroupAnnounce,
    /// Whether only admins can edit group info.
    pub locked: GroupLocked,
    /// Whether joining needs admin approval.
    pub membership_approval_mode: GroupMembershipApprovalMode,
    /// Who can add members (default all members).
    pub member_add_mode: GroupMemberAddMode,
    /// Set `is_parent` to create a community; the server creates its
    /// announcement group.
    pub parent: GroupParent,
    /// Set the parent to create a group inside a community.
    pub linked_parent: GroupLinkedParent,
}

/// A change to group participants (`ParticipantChange`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::Display, strum::AsRefStr)]
pub enum ParticipantChange {
    /// `add`.
    #[strum(serialize = "add")]
    Add,
    /// `remove`.
    #[strum(serialize = "remove")]
    Remove,
    /// `promote`.
    #[strum(serialize = "promote")]
    Promote,
    /// `demote`.
    #[strum(serialize = "demote")]
    Demote,
}

/// An answer to a join request (`ParticipantRequestChange`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::Display, strum::AsRefStr)]
pub enum ParticipantRequestChange {
    /// `approve`.
    #[strum(serialize = "approve")]
    Approve,
    /// `reject`.
    #[strum(serialize = "reject")]
    Reject,
}

/// A parsed `w:gp2` notification: joining a group or a change to one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum GroupNotification {
    Joined(Box<JoinedGroup>),
    Change(Box<GroupInfoEvent>),
}

fn node(tag: &str, attrs: Attrs, content: Option<NodeContent>) -> Node {
    Node {
        tag: tag.to_owned(),
        attrs,
        content,
    }
}

fn nodes(children: Vec<Node>) -> Option<NodeContent> {
    Some(NodeContent::Nodes(children))
}

fn iq_is(error: &ClientError, status: (i64, &'static str)) -> bool {
    error.is(&ClientError::iq_status(status))
}

impl Client {
    async fn send_group_iq(
        &self,
        iq_type: IqType,
        jid: &Jid,
        content: Node,
    ) -> Result<Node, ClientError> {
        self.send_iq(InfoQuery {
            namespace: "w:g2",
            r#type: iq_type,
            to: jid.clone(),
            content: nodes(vec![content]),
            ..InfoQuery::default()
        })
        .await
    }

    /// Creates a group with the given name and participants.
    #[tracing::instrument(
        name = "whatsmeow.create_group",
        skip_all,
        fields(participants = request.participants.len()),
        err
    )]
    pub async fn create_group(
        &self,
        mut request: ReqCreateGroup,
    ) -> Result<GroupInfo, ClientError> {
        let mut participant_nodes = Vec::with_capacity(request.participants.len() + 8);
        let lids = Arc::clone(&self.store.read().await.lids);
        for participant in &request.participants {
            let participant = participant.to_non_ad();
            let mut participant_pn = Jid::default();
            if participant.server == HIDDEN_USER_SERVER {
                participant_pn = lids
                    .get_pn_for_lid(&participant)
                    .await
                    .map_err(|error| {
                        ClientError::Other(format!(
                            "failed to get phone number for participant: {error}"
                        ))
                    })?
                    .unwrap_or_default();
            }
            let mut attrs = Attrs::from([("jid".to_owned(), (&participant).into())]);
            if !participant_pn.is_empty() {
                attrs.insert("phone_number".to_owned(), participant_pn.into());
            }
            let token = self.ensure_tc_token(&participant).await.map_err(|error| {
                ClientError::Other(format!(
                    "failed to get privacy token for participant: {error}"
                ))
            })?;
            let content = token.filter(|token| !token.is_empty()).map(|token| {
                NodeContent::Nodes(vec![node(
                    "privacy",
                    Attrs::new(),
                    Some(NodeContent::Bytes(token)),
                )])
            });
            participant_nodes.push(node("participant", attrs, content));
        }
        // TODO member_share_group_history_mode
        let member_add_mode = if request.member_add_mode == GroupMemberAddMode::Empty {
            GroupMemberAddMode::AllMember
        } else {
            request.member_add_mode.clone()
        };
        participant_nodes.push(node(
            "member_add_mode",
            Attrs::new(),
            Some(NodeContent::String(member_add_mode.as_str().to_owned())),
        ));
        if request.parent.is_parent {
            if request.parent.default_membership_approval_mode.is_empty() {
                request.parent.default_membership_approval_mode = "request_required".to_owned();
            }
            participant_nodes.push(node(
                "parent",
                Attrs::from([(
                    "default_membership_approval_mode".to_owned(),
                    request
                        .parent
                        .default_membership_approval_mode
                        .as_str()
                        .into(),
                )]),
                None,
            ));
        } else if !request.linked_parent.linked_parent_jid.is_empty() {
            participant_nodes.push(node(
                "linked_parent",
                Attrs::from([(
                    "jid".to_owned(),
                    (&request.linked_parent.linked_parent_jid).into(),
                )]),
                None,
            ));
        }
        if request.locked.is_locked {
            participant_nodes.push(node("locked", Attrs::new(), None));
        }
        if request.announce.is_announce {
            participant_nodes.push(node("announcement", Attrs::new(), None));
        }
        if request.ephemeral.is_ephemeral {
            participant_nodes.push(node(
                "ephemeral",
                Attrs::from([
                    (
                        "expiration".to_owned(),
                        request.ephemeral.disappearing_timer.into(),
                    ),
                    // TODO what's this?
                    ("trigger".to_owned(), "1".into()),
                ]),
                None,
            ));
        } else {
            participant_nodes.push(node(
                "ephemeral",
                Attrs::from([("expiration".to_owned(), 0.into())]),
                None,
            ));
        }
        let approval_state = if request.membership_approval_mode.is_join_approval_required {
            "on"
        } else {
            "off"
        };
        participant_nodes.push(node(
            "membership_approval_mode",
            Attrs::new(),
            nodes(vec![node(
                "group_join",
                Attrs::from([("state".to_owned(), approval_state.into())]),
                None,
            )]),
        ));
        let mut create_attrs = Attrs::new();
        if !request.name.is_empty() {
            create_attrs.insert("subject".to_owned(), request.name.as_str().into());
        }
        let response = self
            .send_group_iq(
                IqType::Set,
                &GROUP_SERVER_JID,
                node("create", create_attrs, nodes(participant_nodes)),
            )
            .await?;
        let group_node = response
            .get_optional_child_by_tag(&["group"])
            .ok_or_else(|| element_missing("group", "response to create group query"))?;
        let (info, result) = parse_group_node(group_node);
        result?;
        Ok(info)
    }

    /// Leaves the group.
    #[tracing::instrument(name = "whatsmeow.leave_group", skip_all, err)]
    pub async fn leave_group(&self, jid: &Jid) -> Result<(), ClientError> {
        self.send_group_iq(
            IqType::Set,
            &GROUP_SERVER_JID,
            node(
                "leave",
                Attrs::new(),
                nodes(vec![node(
                    "group",
                    Attrs::from([("id".to_owned(), jid.into())]),
                    None,
                )]),
            ),
        )
        .await
        .map(|_| ())
    }

    /// Adds, removes, promotes or demotes members of a group; returns the
    /// affected participants (with an error code for those that failed).
    #[tracing::instrument(
        name = "whatsmeow.update_group_participants",
        skip_all,
        fields(action = %action, participants = participant_changes.len()),
        err
    )]
    pub async fn update_group_participants(
        &self,
        jid: &Jid,
        participant_changes: &[Jid],
        action: ParticipantChange,
    ) -> Result<Vec<GroupParticipant>, ClientError> {
        let lids = Arc::clone(&self.store.read().await.lids);
        let mut content = Vec::with_capacity(participant_changes.len());
        for participant_jid in participant_changes {
            let mut attrs = Attrs::from([("jid".to_owned(), participant_jid.into())]);
            if participant_jid.server == HIDDEN_USER_SERVER && action == ParticipantChange::Add {
                let pn = lids
                    .get_pn_for_lid(participant_jid)
                    .await
                    .map_err(|error| {
                        ClientError::Other(format!("failed to get phone number for LID: {error}"))
                    })?;
                if let Some(pn) = pn.filter(|pn| !pn.is_empty()) {
                    attrs.insert("phone_number".to_owned(), pn.into());
                }
            }
            let mut participant_content = None;
            if action == ParticipantChange::Add {
                let token = self
                    .ensure_tc_token(participant_jid)
                    .await
                    .map_err(|error| {
                        ClientError::Other(format!(
                            "failed to get privacy token for participant: {error}"
                        ))
                    })?;
                if let Some(token) = token.filter(|token| !token.is_empty()) {
                    participant_content = nodes(vec![node(
                        "privacy",
                        Attrs::new(),
                        Some(NodeContent::Bytes(token)),
                    )]);
                }
            }
            content.push(node("participant", attrs, participant_content));
        }
        let response = self
            .send_group_iq(
                IqType::Set,
                jid,
                node(action.as_ref(), Attrs::new(), nodes(content)),
            )
            .await?;
        let request_action = response
            .get_optional_child_by_tag(&[action.as_ref()])
            .ok_or_else(|| {
                element_missing(action.as_ref(), "response to group participants update")
            })?;
        Ok(request_action
            .get_children_by_tag("participant")
            .map(|child| parse_participant(&mut child.attr_getter(), child))
            .collect())
    }

    /// Gets the users that asked to join the group.
    #[tracing::instrument(name = "whatsmeow.get_group_request_participants", skip_all, err)]
    pub async fn get_group_request_participants(
        &self,
        jid: &Jid,
    ) -> Result<Vec<GroupParticipantRequest>, ClientError> {
        let response = self
            .send_group_iq(
                IqType::Get,
                jid,
                node("membership_approval_requests", Attrs::new(), None),
            )
            .await?;
        let request = response
            .get_optional_child_by_tag(&["membership_approval_requests"])
            .ok_or_else(|| {
                element_missing(
                    "membership_approval_requests",
                    "response to group request participants query",
                )
            })?;
        Ok(request
            .get_children_by_tag("membership_approval_request")
            .map(|request| GroupParticipantRequest {
                jid: request.attr_getter().jid("jid"),
                requested_at: request.attr_getter().unix_time("request_time"),
            })
            .collect())
    }

    /// Approves or rejects requests to join the group.
    #[tracing::instrument(
        name = "whatsmeow.update_group_request_participants",
        skip_all,
        fields(action = %action, participants = participant_changes.len()),
        err
    )]
    pub async fn update_group_request_participants(
        &self,
        jid: &Jid,
        participant_changes: &[Jid],
        action: ParticipantRequestChange,
    ) -> Result<Vec<GroupParticipant>, ClientError> {
        let content = participant_changes
            .iter()
            .map(|participant| {
                node(
                    "participant",
                    Attrs::from([("jid".to_owned(), participant.into())]),
                    None,
                )
            })
            .collect();
        let response = self
            .send_group_iq(
                IqType::Set,
                jid,
                node(
                    "membership_requests_action",
                    Attrs::new(),
                    nodes(vec![node(action.as_ref(), Attrs::new(), nodes(content))]),
                ),
            )
            .await?;
        let request = response
            .get_optional_child_by_tag(&["membership_requests_action"])
            .ok_or_else(|| {
                element_missing(
                    "membership_requests_action",
                    "response to group request participants update",
                )
            })?;
        let request_action = request
            .get_optional_child_by_tag(&[action.as_ref()])
            .ok_or_else(|| {
                element_missing(
                    action.as_ref(),
                    "response to group request participants update",
                )
            })?;
        Ok(request_action
            .get_children_by_tag("participant")
            .map(|child| parse_participant(&mut child.attr_getter(), child))
            .collect())
    }

    /// Sets the group's picture (a JPEG; other formats may fail with
    /// [`ClientError::InvalidImageFormat`]) or removes it with `None`.
    /// Returns the new picture ID, or `remove`.
    #[tracing::instrument(name = "whatsmeow.set_group_photo", skip_all, err)]
    pub async fn set_group_photo(
        &self,
        jid: &Jid,
        avatar: Option<Vec<u8>>,
    ) -> Result<String, ClientError> {
        let removing = avatar.is_none();
        let content = avatar.map(|avatar| {
            NodeContent::Nodes(vec![node(
                "picture",
                Attrs::from([("type".to_owned(), "image".into())]),
                Some(NodeContent::Bytes(avatar)),
            )])
        });
        let response = match self
            .send_iq(InfoQuery {
                namespace: "w:profile:picture",
                r#type: IqType::Set,
                to: SERVER_JID.clone(),
                target: jid.clone(),
                content,
                ..InfoQuery::default()
            })
            .await
        {
            Err(error) if iq_is(&error, IqError::NOT_ACCEPTABLE) => {
                return Err(wrap_iq_error(ClientError::InvalidImageFormat, error));
            }
            result => result?,
        };
        if removing {
            return Ok("remove".to_owned());
        }
        match response.get_child_by_tag(&["picture"]).attrs.get("id") {
            Some(AttributeValue::String(id)) => Ok(id.clone()),
            _ => Err(ClientError::Other(
                "didn't find picture ID in response".to_owned(),
            )),
        }
    }

    /// Sets the group's name (subject).
    #[tracing::instrument(name = "whatsmeow.set_group_name", skip_all, err)]
    pub async fn set_group_name(&self, jid: &Jid, name: &str) -> Result<(), ClientError> {
        self.send_group_iq(
            IqType::Set,
            jid,
            node(
                "subject",
                Attrs::new(),
                Some(NodeContent::Bytes(name.as_bytes().to_vec())),
            ),
        )
        .await
        .map(|_| ())
    }

    /// Sets the group's topic (description); an empty topic deletes it.
    ///
    /// Without `previous_id`, the current topic ID is fetched with
    /// [`Client::get_group_info`]; without `new_id`, one is generated with
    /// [`Client::generate_message_id`].
    #[tracing::instrument(name = "whatsmeow.set_group_topic", skip_all, err)]
    pub async fn set_group_topic(
        &self,
        jid: &Jid,
        previous_id: &str,
        new_id: &str,
        topic: &str,
    ) -> Result<(), ClientError> {
        let previous_id = if previous_id.is_empty() {
            let old_info = self.get_group_info(jid).await.map_err(|error| {
                ClientError::Other(format!(
                    "failed to get old group info to update topic: {error}"
                ))
            })?;
            old_info.topic.topic_id
        } else {
            previous_id.to_owned()
        };
        let new_id = if new_id.is_empty() {
            self.generate_message_id().await
        } else {
            new_id.to_owned()
        };
        let mut attrs = Attrs::from([("id".to_owned(), new_id.into())]);
        if !previous_id.is_empty() {
            attrs.insert("prev".to_owned(), previous_id.into());
        }
        let content = if topic.is_empty() {
            attrs.insert("delete".to_owned(), "true".into());
            None
        } else {
            nodes(vec![node(
                "body",
                Attrs::new(),
                Some(NodeContent::Bytes(topic.as_bytes().to_vec())),
            )])
        };
        self.send_group_iq(IqType::Set, jid, node("description", attrs, content))
            .await
            .map(|_| ())
    }

    /// Sets whether only admins can edit group info.
    #[tracing::instrument(name = "whatsmeow.set_group_locked", skip_all, err)]
    pub async fn set_group_locked(&self, jid: &Jid, locked: bool) -> Result<(), ClientError> {
        let tag = if locked { "locked" } else { "unlocked" };
        self.send_group_iq(IqType::Set, jid, node(tag, Attrs::new(), None))
            .await
            .map(|_| ())
    }

    /// Sets whether only admins can send messages.
    #[tracing::instrument(name = "whatsmeow.set_group_announce", skip_all, err)]
    pub async fn set_group_announce(&self, jid: &Jid, announce: bool) -> Result<(), ClientError> {
        let tag = if announce {
            "announcement"
        } else {
            "not_announcement"
        };
        self.send_group_iq(IqType::Set, jid, node(tag, Attrs::new(), None))
            .await
            .map(|_| ())
    }

    /// Gets the group's invite link; `reset` revokes the old link and makes a
    /// new one.
    #[tracing::instrument(name = "whatsmeow.get_group_invite_link", skip_all, fields(reset), err)]
    pub async fn get_group_invite_link(
        &self,
        jid: &Jid,
        reset: bool,
    ) -> Result<String, ClientError> {
        let iq_type = if reset { IqType::Set } else { IqType::Get };
        let response = match self
            .send_group_iq(iq_type, jid, node("invite", Attrs::new(), None))
            .await
        {
            Err(error) if iq_is(&error, IqError::NOT_AUTHORIZED) => {
                return Err(wrap_iq_error(
                    ClientError::GroupInviteLinkUnauthorized,
                    error,
                ));
            }
            Err(error) if iq_is(&error, IqError::NOT_FOUND) => {
                return Err(wrap_iq_error(ClientError::GroupNotFound, error));
            }
            Err(error) if iq_is(&error, IqError::FORBIDDEN) => {
                return Err(wrap_iq_error(ClientError::NotInGroup, error));
            }
            result => result?,
        };
        match response.get_child_by_tag(&["invite"]).attrs.get("code") {
            Some(AttributeValue::String(code)) => Ok(format!("{INVITE_LINK_PREFIX}{code}")),
            _ => Err(ClientError::Other(
                "didn't find invite code in response".to_owned(),
            )),
        }
    }

    /// Gets the group info from an invite message (not an invite link; see
    /// [`Client::get_group_info_from_link`]).
    #[tracing::instrument(name = "whatsmeow.get_group_info_from_invite", skip_all, err)]
    pub async fn get_group_info_from_invite(
        &self,
        jid: &Jid,
        inviter: &Jid,
        code: &str,
        expiration: i64,
    ) -> Result<GroupInfo, ClientError> {
        let response = self
            .send_group_iq(
                IqType::Get,
                jid,
                node(
                    "query",
                    Attrs::new(),
                    nodes(vec![node(
                        "add_request",
                        Attrs::from([
                            ("code".to_owned(), code.into()),
                            ("expiration".to_owned(), expiration.into()),
                            ("admin".to_owned(), inviter.into()),
                        ]),
                        None,
                    )]),
                ),
            )
            .await?;
        let group_node = response
            .get_optional_child_by_tag(&["group"])
            .ok_or_else(|| element_missing("group", "response to invite group info query"))?;
        let (info, result) = parse_group_node(group_node);
        result?;
        Ok(info)
    }

    /// Joins a group with an invite message (not an invite link; see
    /// [`Client::join_group_with_link`]).
    #[tracing::instrument(name = "whatsmeow.join_group_with_invite", skip_all, err)]
    pub async fn join_group_with_invite(
        &self,
        jid: &Jid,
        inviter: &Jid,
        code: &str,
        expiration: i64,
    ) -> Result<(), ClientError> {
        self.send_group_iq(
            IqType::Set,
            jid,
            node(
                "accept",
                Attrs::from([
                    ("code".to_owned(), code.into()),
                    ("expiration".to_owned(), expiration.into()),
                    ("admin".to_owned(), inviter.into()),
                ]),
                None,
            ),
        )
        .await
        .map(|_| ())
    }

    /// Resolves an invite link (or just its code) to the group's info
    /// without joining.
    #[tracing::instrument(name = "whatsmeow.get_group_info_from_link", skip_all, err)]
    pub async fn get_group_info_from_link(&self, code: &str) -> Result<GroupInfo, ClientError> {
        let response = self.send_invite_link_iq(IqType::Get, code).await?;
        let group_node = response
            .get_optional_child_by_tag(&["group"])
            .ok_or_else(|| element_missing("group", "response to group link info query"))?;
        let (info, result) = parse_group_node(group_node);
        result?;
        Ok(info)
    }

    /// Joins a group with an invite link (or just its code). Returns the
    /// group, or the JID of the pending membership request when joining
    /// needs approval.
    #[tracing::instrument(name = "whatsmeow.join_group_with_link", skip_all, err)]
    pub async fn join_group_with_link(&self, code: &str) -> Result<Jid, ClientError> {
        let response = self.send_invite_link_iq(IqType::Set, code).await?;
        if let Some(membership_request) =
            response.get_optional_child_by_tag(&["membership_approval_request"])
        {
            return Ok(membership_request.attr_getter().jid("jid"));
        }
        let group_node = response
            .get_optional_child_by_tag(&["group"])
            .ok_or_else(|| element_missing("group", "response to group link join query"))?;
        Ok(group_node.attr_getter().jid("jid"))
    }

    async fn send_invite_link_iq(&self, iq_type: IqType, code: &str) -> Result<Node, ClientError> {
        match self
            .send_group_iq(
                iq_type,
                &GROUP_SERVER_JID,
                node(
                    "invite",
                    Attrs::from([(
                        "code".to_owned(),
                        strip_url_prefix(code, &[INVITE_LINK_PREFIX]).into(),
                    )]),
                    None,
                ),
            )
            .await
        {
            Err(error) if iq_is(&error, IqError::GONE) => {
                Err(wrap_iq_error(ClientError::InviteLinkRevoked, error))
            }
            Err(error) if iq_is(&error, IqError::NOT_ACCEPTABLE) => {
                Err(wrap_iq_error(ClientError::InviteLinkInvalid, error))
            }
            result => result,
        }
    }

    /// Lists the groups the user participates in, with participants and
    /// descriptions; caches them and stores the LID mappings and redacted
    /// phones they carry. Groups whose attributes don't fully parse are
    /// returned anyway, like Go.
    #[tracing::instrument(
        name = "whatsmeow.get_joined_groups",
        skip_all,
        fields(groups = tracing::field::Empty),
        err
    )]
    pub async fn get_joined_groups(&self) -> Result<Vec<GroupInfo>, ClientError> {
        let response = self
            .send_group_iq(
                IqType::Get,
                &GROUP_SERVER_JID,
                node(
                    "participating",
                    Attrs::new(),
                    nodes(vec![
                        node("participants", Attrs::new(), None),
                        node("description", Attrs::new(), None),
                    ]),
                ),
            )
            .await?;
        let groups = response
            .get_optional_child_by_tag(&["groups"])
            .ok_or_else(|| element_missing("groups", "response to group list query"))?;
        let children = groups.get_children();
        let mut infos = Vec::with_capacity(children.len());
        let mut all_lid_pairs = Vec::new();
        let mut all_redacted_phones = Vec::new();
        for child in children {
            if child.tag != "group" {
                tracing::debug!(tag = %child.tag, "unexpected child in group list response");
                continue;
            }
            let (parsed, result) = parse_group_node(child);
            if let Err(error) = result {
                tracing::warn!(error = %error, "error parsing group");
            }
            let (lid_pairs, redacted_phones) = self.cache_group_info(&parsed, None).await;
            all_lid_pairs.extend(lid_pairs);
            all_redacted_phones.extend(redacted_phones);
            infos.push(parsed);
        }
        tracing::Span::current().record("groups", infos.len());
        let (lids, contacts) = {
            let store = self.store.read().await;
            (Arc::clone(&store.lids), Arc::clone(&store.contacts))
        };
        if let Err(error) = lids.put_many_lid_mappings(&all_lid_pairs).await {
            tracing::warn!(error = %error, "failed to store LID mappings from joined groups");
        }
        if let Err(error) = contacts
            .put_many_redacted_phones(&all_redacted_phones)
            .await
        {
            tracing::warn!(error = %error, "failed to store redacted phones from joined groups");
        }
        Ok(infos)
    }

    /// Gets a group's info from the server and caches it, storing the LID
    /// mappings and redacted phones of its participants.
    #[tracing::instrument(name = "whatsmeow.get_group_info", skip_all, err)]
    pub async fn get_group_info(&self, jid: &Jid) -> Result<GroupInfo, ClientError> {
        self.get_group_info_inner(jid, None).await
    }

    /// Caches what the send path needs to know about the group. With
    /// `locked_cache`, the caller already holds the cache lock (Go's
    /// `lock == false`). Returns the participants' LID mappings (one per
    /// participant, empty for those without both, as Go) and redacted phones.
    pub(crate) async fn cache_group_info(
        &self,
        group_info: &GroupInfo,
        locked_cache: Option<&mut HashMap<Jid, GroupMetaCache>>,
    ) -> (Vec<LidMapping>, Vec<RedactedPhoneEntry>) {
        let mut participants = Vec::with_capacity(group_info.participants.len());
        let mut lid_pairs = Vec::with_capacity(group_info.participants.len());
        let mut redacted_phones = Vec::new();
        let mut admins = Vec::new();
        for participant in &group_info.participants {
            participants.push(participant.jid.clone());
            if participant.is_admin || participant.is_super_admin {
                admins.push(participant.jid.clone());
            }
            if !participant.phone_number.is_empty() && !participant.lid.is_empty() {
                lid_pairs.push(LidMapping {
                    lid: participant.lid.clone(),
                    pn: participant.phone_number.clone(),
                });
            } else {
                lid_pairs.push(LidMapping {
                    lid: Jid::default(),
                    pn: Jid::default(),
                });
            }
            if !participant.display_name.is_empty() && !participant.lid.is_empty() {
                redacted_phones.push(RedactedPhoneEntry {
                    jid: participant.lid.clone(),
                    redacted_phone: participant.display_name.clone(),
                });
            }
        }
        let meta = GroupMetaCache {
            addressing_mode: group_info.addressing_mode.clone(),
            read_only: group_info.announce.is_announce,
            community_announcement_group: group_info.announce.is_announce
                && group_info.is_default_sub.is_default_sub_group,
            members: participants,
            admins,
        };
        match locked_cache {
            Some(cache) => {
                cache.insert(group_info.jid.clone(), meta);
            }
            None => {
                self.group_cache
                    .lock()
                    .await
                    .insert(group_info.jid.clone(), meta);
            }
        }
        (lid_pairs, redacted_phones)
    }

    /// Go's `getGroupInfo`: `locked_cache` is the cache when the caller
    /// already holds its lock.
    pub(crate) async fn get_group_info_inner(
        &self,
        jid: &Jid,
        locked_cache: Option<&mut HashMap<Jid, GroupMetaCache>>,
    ) -> Result<GroupInfo, ClientError> {
        let response = match self
            .send_group_iq(
                IqType::Get,
                jid,
                node(
                    "query",
                    Attrs::from([("request".to_owned(), "interactive".into())]),
                    None,
                ),
            )
            .await
        {
            Err(error) if iq_is(&error, IqError::NOT_FOUND) => {
                return Err(wrap_iq_error(ClientError::GroupNotFound, error));
            }
            Err(error) if iq_is(&error, IqError::FORBIDDEN) => {
                return Err(wrap_iq_error(ClientError::NotInGroup, error));
            }
            result => result?,
        };
        let group_node = response
            .get_optional_child_by_tag(&["group"])
            .ok_or_else(|| element_missing("groups", "response to group info query"))?;
        let (group_info, result) = parse_group_node(group_node);
        result?;
        let (lid_pairs, redacted_phones) = self.cache_group_info(&group_info, locked_cache).await;
        let (lids, contacts) = {
            let store = self.store.read().await;
            (Arc::clone(&store.lids), Arc::clone(&store.contacts))
        };
        if let Err(error) = lids.put_many_lid_mappings(&lid_pairs).await {
            tracing::warn!(error = %error, "failed to store LID mappings for group members");
        }
        if let Err(error) = contacts.put_many_redacted_phones(&redacted_phones).await {
            tracing::warn!(error = %error, "failed to store redacted phones for group members");
        }
        Ok(group_info)
    }

    /// The cached group metadata, fetching the group info when it isn't
    /// cached. The cache lock is held across the query, like Go.
    pub(crate) async fn get_cached_group_data(
        &self,
        jid: &Jid,
    ) -> Result<GroupMetaCache, ClientError> {
        let mut cache = self.group_cache.lock().await;
        if let Some(cached) = cache.get(jid) {
            return Ok(cached.clone());
        }
        self.get_group_info_inner(jid, Some(&mut cache)).await?;
        // `cache_group_info` just inserted it.
        Ok(cache.get(jid).cloned().unwrap_or_default())
    }

    async fn parse_group_create(
        &self,
        parent_node: &Node,
        node: &Node,
    ) -> Result<(JoinedGroup, Vec<LidMapping>, Vec<RedactedPhoneEntry>), ClientError> {
        let group_node = node.get_optional_child_by_tag(&["group"]).ok_or_else(|| {
            ClientError::Other("group create notification didn't contain group info".to_owned())
        })?;
        let mut parent_attrs = parent_node.attr_getter();
        let mut attrs = node.attr_getter();
        let (mut info, result) = parse_group_node(group_node);
        result.map_err(|error| {
            ClientError::from(error).wrap("failed to parse group info in create notification")
        })?;
        if info.addressing_mode == AddressingMode::Empty {
            info.addressing_mode =
                AddressingMode::from(parent_attrs.optional_string("addressing_mode"));
        }
        let (lid_pairs, redacted_phones) = self.cache_group_info(&info, None).await;
        let event = JoinedGroup {
            reason: attrs.optional_string("reason"),
            create_key: attrs.optional_string("key"),
            r#type: attrs.optional_string("type"),
            sender: parent_attrs.optional_jid("participant"),
            sender_pn: parent_attrs.optional_jid("participant_pn"),
            notify: parent_attrs.optional_string("notify"),
            group_info: info,
        };
        Ok((event, lid_pairs, redacted_phones))
    }

    async fn update_group_participant_cache(&self, event: &GroupInfoEvent) {
        // TODO can the addressing mode change here?
        if event.join.is_empty()
            && event.leave.is_empty()
            && event.promote.is_empty()
            && event.demote.is_empty()
            && event.announce.is_none()
        {
            return;
        }
        let mut cache = self.group_cache.lock().await;
        let Some(cached) = cache.get_mut(&event.jid) else {
            return;
        };
        if let Some(announce) = &event.announce {
            cached.read_only = announce.is_announce;
        }
        for jid in &event.join {
            if !cached.members.contains(jid) {
                cached.members.push(jid.clone());
            }
        }
        for jid in &event.leave {
            fast_delete_item(&mut cached.members, jid);
            fast_delete_item(&mut cached.admins, jid);
        }
        for jid in &event.promote {
            if !cached.admins.contains(jid) {
                cached.admins.push(jid.clone());
            }
        }
        for jid in &event.demote {
            fast_delete_item(&mut cached.admins, jid);
        }
    }

    /// Parses a `w:gp2` notification: a lone `<create>` is joining a group,
    /// anything else a change, which also updates the participant cache.
    pub(crate) async fn parse_group_notification(
        &self,
        node: &Node,
    ) -> Result<(GroupNotification, Vec<LidMapping>, Vec<RedactedPhoneEntry>), ClientError> {
        let children = node.get_children();
        if children.len() == 1 && children[0].tag == "create" {
            let (event, lid_pairs, redacted_phones) =
                self.parse_group_create(node, &children[0]).await?;
            Ok((
                GroupNotification::Joined(Box::new(event)),
                lid_pairs,
                redacted_phones,
            ))
        } else {
            let (group_change, lid_pairs) = parse_group_change(node)?;
            self.update_group_participant_cache(&group_change).await;
            Ok((
                GroupNotification::Change(Box::new(group_change)),
                lid_pairs,
                Vec::new(),
            ))
        }
    }

    /// Turns join approval on or off.
    #[tracing::instrument(name = "whatsmeow.set_group_join_approval_mode", skip_all, err)]
    pub async fn set_group_join_approval_mode(
        &self,
        jid: &Jid,
        mode: bool,
    ) -> Result<(), ClientError> {
        let state = if mode { "on" } else { "off" };
        self.send_group_iq(
            IqType::Set,
            jid,
            node(
                "membership_approval_mode",
                Attrs::new(),
                nodes(vec![node(
                    "group_join",
                    Attrs::from([("state".to_owned(), state.into())]),
                    None,
                )]),
            ),
        )
        .await
        .map(|_| ())
    }

    /// Sets who can add members: [`GroupMemberAddMode::Admin`] or
    /// [`GroupMemberAddMode::AllMember`].
    #[tracing::instrument(name = "whatsmeow.set_group_member_add_mode", skip_all, err)]
    pub async fn set_group_member_add_mode(
        &self,
        jid: &Jid,
        mode: GroupMemberAddMode,
    ) -> Result<(), ClientError> {
        if mode != GroupMemberAddMode::Admin && mode != GroupMemberAddMode::AllMember {
            return Err(ClientError::Other(
                "invalid mode, must be 'admin_add' or 'all_member_add'".to_owned(),
            ));
        }
        self.send_group_iq(
            IqType::Set,
            jid,
            node(
                "member_add_mode",
                Attrs::new(),
                Some(NodeContent::Bytes(mode.as_str().as_bytes().to_vec())),
            ),
        )
        .await
        .map(|_| ())
    }
}

/// `exslices.FastDeleteItem`: removes the first match by swapping in the last
/// element.
fn fast_delete_item(items: &mut Vec<Jid>, item: &Jid) {
    if let Some(index) = items.iter().position(|existing| existing == item) {
        items.swap_remove(index);
    }
}

/// Parses a `<participant>`. Attribute errors land in `attrs`, which the
/// caller owns (Go passes the caller's `AttrUtility`).
pub(crate) fn parse_participant(attrs: &mut AttrUtility<'_>, child: &Node) -> GroupParticipant {
    let participant_type = attrs.optional_string("type");
    let mut participant = GroupParticipant {
        is_admin: participant_type == "admin" || participant_type == "superadmin",
        is_super_admin: participant_type == "superadmin",
        jid: attrs.jid("jid"),
        display_name: attrs.optional_string("display_name"),
        ..GroupParticipant::default()
    };
    if participant.jid.server == HIDDEN_USER_SERVER {
        participant.lid = participant.jid.clone();
        participant.phone_number = attrs.optional_jid_or_empty("phone_number");
    } else if participant.jid.server == DEFAULT_USER_SERVER {
        participant.phone_number = participant.jid.clone();
        participant.lid = attrs.optional_jid_or_empty("lid");
    }
    let error_code = attrs.optional_int("error");
    if error_code != 0 {
        participant.error = error_code;
        if let Some(add_request) = child.get_optional_child_by_tag(&["add_request"]) {
            let mut add_attrs = add_request.attr_getter();
            participant.add_request = Some(GroupParticipantAddRequest {
                code: add_attrs.string("code"),
                expiration: add_attrs.unix_time("expiration"),
            });
        }
    }
    participant
}

/// Parses a `<group>` node. The group comes back even when its attributes
/// didn't fully parse, with the errors next to it.
pub(crate) fn parse_group_node(group_node: &Node) -> (GroupInfo, Result<(), ErrorList>) {
    let mut group = GroupInfo::default();
    let mut attrs = group_node.attr_getter();

    group.jid = new_jid(&attrs.string("id"), GROUP_SERVER);
    group.owner_jid = attrs.optional_jid_or_empty("creator");
    group.owner_pn = attrs.optional_jid_or_empty("creator_pn");

    group.name.name = attrs.optional_string("subject");
    group.name.name_set_at = attrs.optional_unix_time("s_t");
    group.name.name_set_by = attrs.optional_jid_or_empty("s_o");
    group.name.name_set_by_pn = attrs.optional_jid_or_empty("s_o_pn");

    group.group_created = attrs.optional_unix_time("creation");
    group.creator_country_code = attrs.optional_string("creator_country_code");

    group.announce.announce_version_id = attrs.optional_string("a_v_id");
    group.participant_version_id = attrs.optional_string("p_v_id");
    group.participant_count = attrs.optional_int("size");
    group.addressing_mode = AddressingMode::from(attrs.optional_string("addressing_mode"));

    for child in group_node.get_children() {
        let mut child_attrs = child.attr_getter();
        match child.tag.as_str() {
            "participant" => group
                .participants
                .push(parse_participant(&mut child_attrs, child)),
            "description" => {
                if let Some(body) = child.get_optional_child_by_tag(&["body"]) {
                    group.topic.topic = match &body.content {
                        Some(NodeContent::Bytes(topic)) => {
                            String::from_utf8_lossy(topic).into_owned()
                        }
                        _ => String::new(),
                    };
                    group.topic.topic_id = child_attrs.string("id");
                    group.topic.topic_set_by = child_attrs.optional_jid_or_empty("participant");
                    // TODO confirm field name
                    group.topic.topic_set_by_pn =
                        child_attrs.optional_jid_or_empty("participant_pn");
                    group.topic.topic_set_at = child_attrs.unix_time("t");
                }
            }
            "announcement" => group.announce.is_announce = true,
            "locked" => group.locked.is_locked = true,
            "ephemeral" => {
                group.ephemeral.is_ephemeral = true;
                group.ephemeral.disappearing_timer = child_attrs.uint64("expiration") as u32;
            }
            "member_add_mode" => {
                group.member_add_mode = match &child.content {
                    Some(NodeContent::Bytes(mode)) => {
                        GroupMemberAddMode::from(String::from_utf8_lossy(mode).as_ref())
                    }
                    _ => GroupMemberAddMode::Empty,
                };
            }
            "linked_parent" => group.linked_parent.linked_parent_jid = child_attrs.jid("jid"),
            "default_sub_group" => group.is_default_sub.is_default_sub_group = true,
            "parent" => {
                group.parent.is_parent = true;
                group.parent.default_membership_approval_mode =
                    child_attrs.optional_string("default_membership_approval_mode");
            }
            "incognito" => group.incognito.is_incognito = true,
            "membership_approval_mode" => {
                group.membership_approval_mode.is_join_approval_required = true;
            }
            "suspended" => group.suspended = true,
            other => tracing::debug!(tag = other, "unknown element in group node"),
        }
        if !child_attrs.ok() {
            tracing::warn!(tag = %child.tag, errors = ?child_attrs.errors, "possibly failed to parse element in group node");
        }
    }
    (group, attrs.error())
}

/// Parses a linked group (`<group>` in link changes and subgroup lists).
pub(crate) fn parse_group_link_target_node(
    group_node: &Node,
) -> Result<GroupLinkTarget, ErrorList> {
    let mut attrs = group_node.attr_getter();
    let mut jid = attrs.optional_jid_or_empty("jid");
    if jid.is_empty() {
        jid = new_jid(&attrs.string("id"), GROUP_SERVER);
    }
    let target = GroupLinkTarget {
        jid,
        name: GroupName {
            name: attrs.optional_string("subject"),
            name_set_at: attrs.optional_unix_time("s_t"),
            ..GroupName::default()
        },
        is_default_sub: crate::types::GroupIsDefaultSub {
            is_default_sub_group: group_node.get_child_by_tag(&["default_sub_group"]).tag
                == "default_sub_group",
        },
    };
    attrs.error()?;
    Ok(target)
}

/// The JIDs of the `<participant>` children, with the LID mappings their
/// `phone_number` / `lid` attributes give.
pub(crate) fn parse_participant_list(node: &Node) -> (Vec<Jid>, Vec<LidMapping>) {
    let children = node.get_children();
    let mut participants = Vec::with_capacity(children.len());
    let mut lid_pairs = Vec::new();
    for child in children {
        let Some(AttributeValue::Jid(jid)) = child.attrs.get("jid") else {
            continue;
        };
        if child.tag != "participant" {
            continue;
        }
        participants.push(jid.clone());
        if jid.server == HIDDEN_USER_SERVER {
            if let Some(AttributeValue::Jid(phone_number)) = child.attrs.get("phone_number")
                && !phone_number.is_empty()
            {
                lid_pairs.push(LidMapping {
                    lid: jid.clone(),
                    pn: phone_number.clone(),
                });
            }
        } else if jid.server == DEFAULT_USER_SERVER
            && let Some(AttributeValue::Jid(lid)) = child.attrs.get("lid")
            && !lid.is_empty()
        {
            lid_pairs.push(LidMapping {
                lid: lid.clone(),
                pn: jid.clone(),
            });
        }
    }
    (participants, lid_pairs)
}

/// Parses a group change notification. The LID mappings are those of the
/// last participant list in it, as in Go.
pub(crate) fn parse_group_change(
    node: &Node,
) -> Result<(GroupInfoEvent, Vec<LidMapping>), ClientError> {
    let mut event = GroupInfoEvent::default();
    let mut attrs = node.attr_getter();
    event.jid = attrs.jid("from");
    event.notify = attrs.optional_string("notify");
    event.sender = attrs.optional_jid("participant");
    event.sender_pn = attrs.optional_jid("participant_pn");
    event.timestamp = attrs.unix_time("t");
    attrs.error().map_err(|error| {
        ClientError::from(error).wrap("group change doesn't contain required attributes")
    })?;

    let mut lid_pairs = Vec::new();
    for child in node.get_children() {
        let mut child_attrs = child.attr_getter();
        if matches!(child.tag.as_str(), "add" | "remove" | "promote" | "demote") {
            event.prev_participant_version_id = child_attrs.optional_string("prev_v_id");
            event.participant_version_id = child_attrs.optional_string("v_id");
        }
        match child.tag.as_str() {
            "add" => {
                event.join_reason = child_attrs.optional_string("reason");
                (event.join, lid_pairs) = parse_participant_list(child);
            }
            "remove" => (event.leave, lid_pairs) = parse_participant_list(child),
            "promote" => (event.promote, lid_pairs) = parse_participant_list(child),
            "demote" => (event.demote, lid_pairs) = parse_participant_list(child),
            "locked" => event.locked = Some(GroupLocked { is_locked: true }),
            "unlocked" => event.locked = Some(GroupLocked { is_locked: false }),
            "delete" => {
                event.delete = Some(GroupDelete {
                    deleted: true,
                    delete_reason: child_attrs.optional_string("reason"),
                });
            }
            "subject" => {
                event.name = Some(GroupName {
                    name: child_attrs.string("subject"),
                    name_set_at: child_attrs.unix_time("s_t"),
                    name_set_by: child_attrs.optional_jid_or_empty("s_o"),
                    name_set_by_pn: child_attrs.optional_jid_or_empty("s_o_pn"),
                });
            }
            "description" => {
                let is_delete = child.get_optional_child_by_tag(&["delete"]).is_some();
                let mut topic = String::new();
                if !is_delete {
                    let Some(NodeContent::Bytes(topic_bytes)) =
                        &child.get_child_by_tag(&["body"]).content
                    else {
                        return Err(ClientError::Other(
                            "group change description has unexpected body".to_owned(),
                        ));
                    };
                    topic = String::from_utf8_lossy(topic_bytes).into_owned();
                }
                event.topic = Some(GroupTopic {
                    topic,
                    topic_id: child_attrs.string("id"),
                    topic_set_at: event.timestamp,
                    topic_set_by: event.sender.clone().unwrap_or_default(),
                    topic_deleted: is_delete,
                    ..GroupTopic::default()
                });
            }
            "announcement" => {
                event.announce = Some(GroupAnnounce {
                    is_announce: true,
                    announce_version_id: child_attrs.string("v_id"),
                });
            }
            "not_announcement" => {
                event.announce = Some(GroupAnnounce {
                    is_announce: false,
                    announce_version_id: child_attrs.string("v_id"),
                });
            }
            "invite" => {
                event.new_invite_link = Some(format!(
                    "{INVITE_LINK_PREFIX}{}",
                    child_attrs.string("code")
                ));
            }
            "ephemeral" => {
                event.ephemeral = Some(GroupEphemeral {
                    is_ephemeral: true,
                    disappearing_timer: child_attrs.uint64("expiration") as u32,
                });
            }
            "not_ephemeral" => {
                event.ephemeral = Some(GroupEphemeral {
                    is_ephemeral: false,
                    disappearing_timer: 0,
                });
            }
            "link" => {
                let r#type = GroupLinkChangeType::from(child_attrs.string("link_type"));
                let group_node = child
                    .get_optional_child_by_tag(&["group"])
                    .ok_or_else(|| element_missing("group", "group link"))?;
                let group = parse_group_link_target_node(group_node).map_err(|error| {
                    ClientError::from(error).wrap("failed to parse group link node in group change")
                })?;
                event.link = Some(GroupLinkChange {
                    r#type,
                    group,
                    ..GroupLinkChange::default()
                });
            }
            "unlink" => {
                let r#type = GroupLinkChangeType::from(child_attrs.string("unlink_type"));
                let unlink_reason = GroupUnlinkReason::from(child_attrs.string("unlink_reason"));
                let group_node = child
                    .get_optional_child_by_tag(&["group"])
                    .ok_or_else(|| element_missing("group", "group unlink"))?;
                let group = parse_group_link_target_node(group_node).map_err(|error| {
                    ClientError::from(error)
                        .wrap("failed to parse group unlink node in group change")
                })?;
                event.unlink = Some(GroupLinkChange {
                    r#type,
                    unlink_reason,
                    group,
                });
            }
            "membership_approval_mode" => {
                event.membership_approval_mode = Some(GroupMembershipApprovalMode {
                    is_join_approval_required: true,
                });
            }
            "suspended" => event.suspended = true,
            "unsuspended" => event.unsuspended = true,
            _ => event.unknown_changes.push(child.clone()),
        }
        if let Err(error) = child_attrs.error() {
            return Err(ClientError::from(error).wrap(format!(
                "group change {} element doesn't contain required attributes",
                child.tag
            )));
        }
    }
    Ok((event, lid_pairs))
}

#[cfg(test)]
mod test;
