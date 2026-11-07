// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow user.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Not ported: bots (`GetBotListV2`, `GetBotProfiles`, the bot list in
// `UsyncQueryExtras`), business message and contact QR links, business
// profiles, `SetStatusMessage` (mex) and Messenger device lists
// (`getFBIDDevices`): a `msgr` JID passed to `get_user_devices` fails in
// `usync` as an unknown server.
//
// Errors leave out the JIDs Go formats into them, since `err` spans log
// them.

//! Users: names, verified business names, devices and usync queries.

use std::collections::HashMap;
use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use prost::Message;

use crate::binary::{AttributeValue, Attrs, Node, NodeContent};
use crate::client::{Client, DeviceCache};
use crate::errors::{ClientError, IqError, element_missing, wrap_iq_error};
use crate::proto::wa_history_sync::Pushname;
use crate::proto::wa_vname_cert::{VerifiedNameCertificate, verified_name_certificate};
use crate::request::{InfoQuery, IqType};
use crate::send::participant_list_hash_v2;
use crate::store::LidMapping;
use crate::types::events::{BlocklistChangeAction, BusinessName, Event, PushName};
use crate::types::{
    AddressingMode, Blocklist, BlocklistItem, DEFAULT_USER_SERVER, HIDDEN_USER_SERVER,
    HOSTED_LID_SERVER, HOSTED_SERVER, IsOnWhatsAppResponse, Jid, LEGACY_USER_SERVER, MessageInfo,
    ProfilePictureInfo, SERVER_JID, UserInfo, VerifiedName, new_jid, parse_jid,
};

/// Extra options for [`Client::usync`] (`UsyncQueryExtras`; the bot list
/// isn't ported).
#[derive(Clone, Copy, Debug, Default)]
pub struct UsyncQueryExtras {
    /// Send the stored privacy token of each user.
    pub include_privacy_token: bool,
}

/// Options for [`Client::get_profile_picture_info`].
#[derive(Clone, Debug, Default)]
pub struct GetProfilePictureParams {
    /// Get the small preview instead of the full image.
    pub preview: bool,
    /// The last known picture ID: an unchanged picture returns `None`.
    pub existing_id: String,
    /// Get a community's picture (others return 401 for communities).
    pub is_community: bool,
    /// A group shared with the target.
    pub common_gid: Jid,
    /// An invite code, for the picture of a group you haven't joined.
    pub invite_code: String,
    /// The persona ID of a Meta AI bot.
    pub persona_id: String,
}

fn strip_query(link: &str) -> &str {
    match link.find('?') {
        Some(index) if index > 0 => &link[..index],
        _ => link,
    }
}

/// Strips the first matching prefix and then the query string; a link
/// without any of the prefixes is returned as is.
pub(crate) fn strip_url_prefix<'link>(link: &'link str, prefixes: &[&str]) -> &'link str {
    for prefix in prefixes {
        if let Some(unprefixed) = link.strip_prefix(prefix) {
            return strip_query(unprefixed);
        }
    }
    link
}

fn user_node(attrs: Attrs, content: Option<NodeContent>) -> Node {
    Node {
        tag: "user".to_owned(),
        attrs,
        content,
    }
}

fn tag_node(tag: &str, attrs: Attrs, content: Option<NodeContent>) -> Node {
    Node {
        tag: tag.to_owned(),
        attrs,
        content,
    }
}

impl Client {
    /// Checks whether the phone numbers (international format with the `+`)
    /// are registered on WhatsApp, storing the LID mappings it learns.
    ///
    /// Go returns the results along with a failure to store the mappings;
    /// here that failure is the error.
    #[tracing::instrument(name = "whatsmeow.is_on_whatsapp", skip_all, fields(phones = phones.len()), err)]
    pub async fn is_on_whatsapp(
        &self,
        phones: &[&str],
    ) -> Result<Vec<IsOnWhatsAppResponse>, ClientError> {
        let jids: Vec<Jid> = phones
            .iter()
            .map(|phone| new_jid(phone, LEGACY_USER_SERVER))
            .collect();
        let list = self
            .usync(
                &jids,
                "query",
                "interactive",
                vec![
                    tag_node(
                        "contact",
                        Attrs::from([("addressing_mode".to_owned(), "lid".into())]),
                        None,
                    ),
                    tag_node(
                        "business",
                        Attrs::new(),
                        Some(NodeContent::Nodes(vec![tag_node(
                            "verified_name",
                            Attrs::new(),
                            None,
                        )])),
                    ),
                    tag_node("disappearing_mode", Attrs::new(), None),
                    tag_node("username", Attrs::new(), None),
                ],
                UsyncQueryExtras::default(),
            )
            .await?;
        let mut output = Vec::with_capacity(jids.len());
        let mut lid_entries = Vec::with_capacity(jids.len());
        let query_suffix = format!("@{LEGACY_USER_SERVER}");
        for child in list.get_children() {
            let mut attrs = child.attr_getter();
            let jid = attrs.optional_jid_or_empty("jid");
            let pn_jid = attrs.optional_jid_or_empty("pn_jid");
            if child.tag != "user" || (jid.is_empty() && pn_jid.is_empty()) {
                continue;
            }
            let mut info = IsOnWhatsAppResponse {
                jid: if jid.is_empty() { pn_jid.clone() } else { jid },
                phone_number: pn_jid,
                ..IsOnWhatsAppResponse::default()
            };
            if info.jid.server == HIDDEN_USER_SERVER
                && info.phone_number.server == DEFAULT_USER_SERVER
            {
                lid_entries.push(LidMapping {
                    lid: info.jid.clone(),
                    pn: info.phone_number.clone(),
                });
            }
            match parse_verified_name(child.get_child_by_tag(&["business"])) {
                Ok(verified_name) => info.verified_name = verified_name,
                Err(error) => {
                    tracing::warn!(error = %error, "failed to parse verified name details");
                }
            }
            let contact_node = child.get_child_by_tag(&["contact"]);
            info.is_in = contact_node.attr_getter().string("type") == "in";
            let contact_query = match &contact_node.content {
                Some(NodeContent::Bytes(query)) => String::from_utf8_lossy(query).into_owned(),
                _ => String::new(),
            };
            info.query = contact_query
                .strip_suffix(&query_suffix)
                .unwrap_or(&contact_query)
                .to_owned();
            output.push(info);
        }
        if !lid_entries.is_empty() {
            let lids = Arc::clone(&self.store.read().await.lids);
            lids.put_many_lid_mappings(&lid_entries)
                .await
                .map_err(|error| ClientError::from(error).wrap("failed to store LID mappings"))?;
        }
        Ok(output)
    }

    /// Gets basic user info (picture ID, about text, devices and LID),
    /// storing the LID mappings and verified business names it learns.
    ///
    /// Like Go, the parsed verified name only updates the contact store; it
    /// isn't set on [`UserInfo::verified_name`].
    #[tracing::instrument(name = "whatsmeow.get_user_info", skip_all, fields(jids = jids.len()), err)]
    pub async fn get_user_info(&self, jids: &[Jid]) -> Result<HashMap<Jid, UserInfo>, ClientError> {
        let list = self
            .usync(
                jids,
                "full",
                "background",
                vec![
                    tag_node(
                        "business",
                        Attrs::new(),
                        Some(NodeContent::Nodes(vec![tag_node(
                            "verified_name",
                            Attrs::new(),
                            None,
                        )])),
                    ),
                    tag_node("status", Attrs::new(), None),
                    tag_node("picture", Attrs::new(), None),
                    tag_node(
                        "devices",
                        Attrs::from([("version".to_owned(), "2".into())]),
                        None,
                    ),
                    tag_node("lid", Attrs::new(), None),
                ],
                UsyncQueryExtras {
                    include_privacy_token: true,
                },
            )
            .await?;
        let mut response = HashMap::with_capacity(jids.len());
        let mut mappings = Vec::with_capacity(jids.len());
        for child in list.get_children() {
            let Some(AttributeValue::Jid(jid)) = child.attrs.get("jid") else {
                continue;
            };
            if child.tag != "user" {
                continue;
            }
            let verified_name = match parse_verified_name(child.get_child_by_tag(&["business"])) {
                Ok(verified_name) => verified_name,
                Err(error) => {
                    tracing::warn!(error = %error, "failed to parse verified name details");
                    None
                }
            };
            let status = match &child.get_child_by_tag(&["status"]).content {
                Some(NodeContent::Bytes(status)) => String::from_utf8_lossy(status).into_owned(),
                _ => String::new(),
            };
            let picture_id = match child.get_child_by_tag(&["picture"]).attrs.get("id") {
                Some(AttributeValue::String(id)) => id.clone(),
                _ => String::new(),
            };
            let info = UserInfo {
                verified_name: None,
                status,
                picture_id,
                devices: parse_device_list(jid, child.get_child_by_tag(&["devices"])),
                lid: child
                    .get_child_by_tag(&["lid"])
                    .attr_getter()
                    .optional_jid_or_empty("val"),
            };
            if !info.lid.is_empty() {
                mappings.push(LidMapping {
                    lid: info.lid.clone(),
                    pn: jid.clone(),
                });
            }
            if let Some(verified_name) = &verified_name {
                let name = verified_name
                    .details
                    .as_ref()
                    .and_then(|details| details.verified_name.clone())
                    .unwrap_or_default();
                self.update_business_name(jid, &info.lid, None, &name).await;
            }
            response.insert(jid.clone(), info);
        }
        let lids = Arc::clone(&self.store.read().await.lids);
        if let Err(error) = lids.put_many_lid_mappings(&mappings).await {
            // Not worth failing the call over.
            tracing::error!(error = %error, "failed to place LID mappings from usync call");
        }
        Ok(response)
    }

    /// Same as [`Client::get_user_devices`] (Go keeps both names).
    pub async fn get_user_devices_context(&self, jids: &[Jid]) -> Result<Vec<Jid>, ClientError> {
        self.get_user_devices(jids).await
    }

    /// Gets the devices of the given users: non-AD JIDs (phone numbers or
    /// LIDs) in, AD JIDs out, in input order. Lists are cached per user with
    /// their participant hash; device notifications update or drop them.
    ///
    /// Like Go, the local device is not filtered out here (despite Go's doc
    /// comment); the send path drops it. Bots have no devices and are
    /// returned as they are.
    #[tracing::instrument(
        name = "whatsmeow.get_user_devices",
        skip_all,
        fields(jids = jids.len(), cached = tracing::field::Empty, synced = tracing::field::Empty),
        err
    )]
    pub async fn get_user_devices(&self, jids: &[Jid]) -> Result<Vec<Jid>, ClientError> {
        let mut cache = self.user_devices_cache.lock().await;
        let mut devices = Vec::new();
        let mut jids_to_sync = Vec::new();
        let mut cached_count = 0;
        for jid in jids {
            match cache.get(jid) {
                Some(cached) if !cached.devices.is_empty() => {
                    cached_count += 1;
                    devices.extend(cached.devices.iter().cloned());
                }
                // Bot JIDs don't have devices; the usync query is empty.
                _ if jid.is_bot() => devices.push(jid.clone()),
                _ => jids_to_sync.push(jid.clone()),
            }
        }
        let span = tracing::Span::current();
        span.record("cached", cached_count);
        span.record("synced", jids_to_sync.len());
        if !jids_to_sync.is_empty() {
            let list = self
                .usync(
                    &jids_to_sync,
                    "query",
                    "message",
                    vec![tag_node(
                        "devices",
                        Attrs::from([("version".to_owned(), "2".into())]),
                        None,
                    )],
                    UsyncQueryExtras::default(),
                )
                .await?;
            for user in list.get_children() {
                let Some(AttributeValue::Jid(jid)) = user.attrs.get("jid") else {
                    continue;
                };
                if user.tag != "user" {
                    continue;
                }
                let user_devices = parse_device_list(jid, user.get_child_by_tag(&["devices"]));
                cache.insert(
                    jid.clone(),
                    DeviceCache {
                        dhash: participant_list_hash_v2(&user_devices),
                        devices: user_devices.clone(),
                    },
                );
                devices.extend(user_devices);
            }
        }
        Ok(devices)
    }

    /// Gets the URL of a user's profile picture or a group's photo.
    ///
    /// With `existing_id`, an unchanged picture returns `None`. Communities
    /// need `is_community`, otherwise the server may answer 401. When the
    /// picture's attributes don't parse, Go returns the partial info with the
    /// error; here only the error.
    #[tracing::instrument(name = "whatsmeow.get_profile_picture_info", skip_all, err)]
    pub async fn get_profile_picture_info(
        &self,
        jid: &Jid,
        params: &GetProfilePictureParams,
    ) -> Result<Option<ProfilePictureInfo>, ClientError> {
        let mut attrs = Attrs::from([
            ("query".to_owned(), "url".into()),
            (
                "type".to_owned(),
                if params.preview { "preview" } else { "image" }.into(),
            ),
        ]);
        if !params.existing_id.is_empty() {
            attrs.insert("id".to_owned(), params.existing_id.as_str().into());
        }
        if !params.invite_code.is_empty() {
            attrs.insert("invite".to_owned(), params.invite_code.as_str().into());
        }
        let namespace;
        let to;
        let target;
        let content;
        if params.is_community {
            target = Jid::default();
            namespace = "w:g2";
            to = jid.clone();
            attrs.insert("parent_group_jid".to_owned(), jid.into());
            content = vec![tag_node(
                "pictures",
                Attrs::new(),
                Some(NodeContent::Nodes(vec![tag_node("picture", attrs, None)])),
            )];
        } else {
            namespace = "w:profile:picture";
            to = SERVER_JID.clone();
            target = jid.clone();
            if !params.common_gid.is_empty() {
                attrs.insert("common_gid".to_owned(), (&params.common_gid).into());
            }
            if !params.persona_id.is_empty() {
                attrs.insert("persona_id".to_owned(), params.persona_id.as_str().into());
            }
            let picture_content = match self.ensure_tc_token(jid).await {
                Ok(Some(token)) => Some(NodeContent::Nodes(vec![tag_node(
                    "tctoken",
                    Attrs::new(),
                    Some(NodeContent::Bytes(token)),
                )])),
                _ => None,
            };
            content = vec![tag_node("picture", attrs, picture_content)];
        }
        let response = self
            .send_iq(InfoQuery {
                namespace,
                r#type: IqType::Get,
                to,
                target,
                content: Some(NodeContent::Nodes(content)),
                ..InfoQuery::default()
            })
            .await;
        let mut response = match response {
            Err(error) if error.is(&ClientError::iq_status(IqError::NOT_AUTHORIZED)) => {
                return Err(wrap_iq_error(
                    ClientError::ProfilePictureUnauthorized,
                    error,
                ));
            }
            Err(error) if error.is(&ClientError::iq_status(IqError::NOT_FOUND)) => {
                return Err(wrap_iq_error(ClientError::ProfilePictureNotSet, error));
            }
            Err(error) => return Err(error),
            Ok(response) => response,
        };
        if params.is_community {
            response = response
                .get_optional_child_by_tag(&["pictures"])
                .ok_or_else(|| element_missing("pictures", "response to profile picture query"))?
                .clone();
        }
        let Some(picture) = response.get_optional_child_by_tag(&["picture"]) else {
            if !params.existing_id.is_empty() {
                return Ok(None);
            }
            return Err(element_missing(
                "picture",
                "response to profile picture query",
            ));
        };
        let mut attrs = picture.attr_getter();
        match attrs.optional_int("status") {
            304 => return Ok(None),
            204 => return Err(ClientError::ProfilePictureNotSet),
            _ => {}
        }
        let info = ProfilePictureInfo {
            id: attrs.string("id"),
            url: attrs.string("url"),
            r#type: attrs.string("type"),
            direct_path: attrs.string("direct_path"),
            hash: STANDARD
                .decode(attrs.optional_string("hash"))
                .unwrap_or_default(),
        };
        attrs.error()?;
        Ok(Some(info))
    }

    fn parse_blocklist(node: &Node) -> (Blocklist, Vec<LidMapping>) {
        let mut output = Blocklist {
            d_hash: node.attr_getter().string("dhash"),
            addressing_mode: AddressingMode::from(node.attr_getter().string("addressing_mode")),
            items: Vec::new(),
        };
        let mut lid_mappings = Vec::new();
        for child in node.get_children() {
            let mut attrs = child.attr_getter();
            let blocked_jid = attrs.jid("jid");
            if !attrs.ok() {
                tracing::debug!(error = ?attrs.error().err(), "ignoring contact blocked data with unexpected attributes");
                continue;
            }
            let item = BlocklistItem {
                lid: blocked_jid,
                pn: attrs.optional_jid_or_empty("pn_jid"),
                active: attrs.optional_bool("active"),
            };
            if item.active
                && item.lid.server == HIDDEN_USER_SERVER
                && item.pn.server == DEFAULT_USER_SERVER
            {
                lid_mappings.push(LidMapping {
                    pn: item.pn.clone(),
                    lid: item.lid.clone(),
                });
            }
            output.items.push(item);
        }
        (output, lid_mappings)
    }

    /// Gets the list of users this user has blocked. With a `dhash` that
    /// matches the server's, there's no list (`None`).
    #[tracing::instrument(name = "whatsmeow.get_blocklist", skip_all, err)]
    pub async fn get_blocklist(&self, dhash: &str) -> Result<Option<Blocklist>, ClientError> {
        let content = (!dhash.is_empty()).then(|| {
            NodeContent::Nodes(vec![tag_node(
                "item",
                Attrs::from([("dhash".to_owned(), dhash.into())]),
                None,
            )])
        });
        let response = self
            .send_iq(InfoQuery {
                namespace: "blocklist",
                r#type: IqType::Get,
                to: SERVER_JID.clone(),
                content,
                ..InfoQuery::default()
            })
            .await?;
        let Some(list) = response.get_optional_child_by_tag(&["list"]) else {
            if !dhash.is_empty() {
                return Ok(None);
            }
            return Err(element_missing("list", "response to blocklist query"));
        };
        let (blocklist, mappings) = Self::parse_blocklist(list);
        if !mappings.is_empty() {
            let lids = Arc::clone(&self.store.read().await.lids);
            if let Err(error) = lids.put_many_lid_mappings(&mappings).await {
                tracing::error!(error = %error, "failed to store LID mappings from blocklist query");
            }
        }
        Ok(Some(blocklist))
    }

    /// Blocks or unblocks a user and returns the updated list. A phone
    /// number is blocked by its LID (looked up with [`Client::get_user_info`]
    /// when unknown). With a `dhash` that matches the server's, there's no
    /// list (`None`).
    #[tracing::instrument(name = "whatsmeow.update_blocklist", skip_all, fields(action = %action), err)]
    pub async fn update_blocklist(
        &self,
        jid: &Jid,
        action: BlocklistChangeAction,
        dhash: &str,
    ) -> Result<Option<Blocklist>, ClientError> {
        let mut lid_jid = Jid::default();
        let mut pn_jid = Jid::default();
        let lids = Arc::clone(&self.store.read().await.lids);
        if jid.server == DEFAULT_USER_SERVER {
            pn_jid = jid.clone();
            let mut lid = lids
                .get_lid_for_pn(jid)
                .await
                .map_err(|error| ClientError::from(error).wrap("failed to get LID for PN"))?
                .unwrap_or_default();
            if lid.is_empty() {
                let info = self
                    .get_user_info(std::slice::from_ref(jid))
                    .await
                    .map_err(|error| error.wrap("failed to get user info to fill LID cache"))?;
                lid = info
                    .get(jid)
                    .map(|info| info.lid.clone())
                    .unwrap_or_default();
                if lid.is_empty() {
                    return Err(ClientError::Other("no LID found from server".to_owned()));
                }
            }
            lid_jid = lid;
        } else if jid.server == HIDDEN_USER_SERVER {
            lid_jid = jid.clone();
            if action == BlocklistChangeAction::Block {
                pn_jid = lids
                    .get_pn_for_lid(jid)
                    .await
                    .map_err(|error| ClientError::from(error).wrap("failed to resolve PN"))?
                    .unwrap_or_default();
            }
        }
        let mut item_attrs = Attrs::from([
            ("jid".to_owned(), lid_jid.into()),
            ("action".to_owned(), action.as_str().into()),
        ]);
        if action == BlocklistChangeAction::Block && !pn_jid.is_empty() {
            item_attrs.insert("pn_jid".to_owned(), pn_jid.into());
        }
        if !dhash.is_empty() {
            item_attrs.insert("dhash".to_owned(), dhash.into());
        }
        let response = self
            .send_iq(InfoQuery {
                namespace: "blocklist",
                r#type: IqType::Set,
                to: SERVER_JID.clone(),
                content: Some(NodeContent::Nodes(vec![tag_node("item", item_attrs, None)])),
                ..InfoQuery::default()
            })
            .await?;
        let list = response
            .get_optional_child_by_tag(&["list"])
            .ok_or_else(|| element_missing("list", "response to blocklist update"))?;
        if !dhash.is_empty() && list.attr_getter().bool("matched") {
            return Ok(None);
        }
        Ok(Some(Self::parse_blocklist(list).0))
    }

    /// Runs a usync query for the users: `mode` and `context` (`query` /
    /// `message`, `full` / `background`, …) go on the `<usync>` node and
    /// `query` lists what to fetch. Returns the response's `<list>`.
    pub(crate) async fn usync(
        &self,
        jids: &[Jid],
        mode: &str,
        context: &str,
        query: Vec<Node>,
        extras: UsyncQueryExtras,
    ) -> Result<Node, ClientError> {
        let mut user_list = Vec::with_capacity(jids.len());
        for jid in jids {
            let jid = jid.to_non_ad();
            let user = match jid.server.as_str() {
                LEGACY_USER_SERVER => user_node(
                    Attrs::new(),
                    Some(NodeContent::Nodes(vec![tag_node(
                        "contact",
                        Attrs::new(),
                        Some(NodeContent::String(jid.to_string())),
                    )])),
                ),
                DEFAULT_USER_SERVER | HIDDEN_USER_SERVER => {
                    // An LID can go in the jid attribute (works for <devices>
                    // queries at least).
                    let mut content = None;
                    if jid.is_bot() {
                        // The bot list (persona IDs) isn't ported.
                        content = Some(NodeContent::Nodes(vec![tag_node(
                            "bot",
                            Attrs::new(),
                            Some(NodeContent::Nodes(vec![tag_node(
                                "profile",
                                Attrs::from([("persona_id".to_owned(), "".into())]),
                                None,
                            )])),
                        )]));
                    } else if extras.include_privacy_token {
                        match self.ensure_tc_token(&jid).await {
                            Err(error) => {
                                tracing::warn!(error = %error, "failed to get privacy token for usync status query")
                            }
                            Ok(Some(token)) if !token.is_empty() => {
                                content = Some(NodeContent::Nodes(vec![tag_node(
                                    "tctoken",
                                    Attrs::new(),
                                    Some(NodeContent::Bytes(token)),
                                )]));
                            }
                            Ok(_) => {}
                        }
                    }
                    user_node(Attrs::from([("jid".to_owned(), jid.into())]), content)
                }
                server => {
                    return Err(ClientError::Other(format!(
                        "unknown user server '{server}'"
                    )));
                }
            };
            user_list.push(user);
        }
        let response = self
            .send_iq(InfoQuery {
                namespace: "usync",
                r#type: IqType::Get,
                to: SERVER_JID.clone(),
                content: Some(NodeContent::Nodes(vec![tag_node(
                    "usync",
                    Attrs::from([
                        ("sid".to_owned(), self.generate_request_id().into()),
                        ("mode".to_owned(), mode.into()),
                        ("last".to_owned(), "true".into()),
                        ("index".to_owned(), "0".into()),
                        ("context".to_owned(), context.into()),
                    ]),
                    Some(NodeContent::Nodes(vec![
                        tag_node("query", Attrs::new(), Some(NodeContent::Nodes(query))),
                        tag_node("list", Attrs::new(), Some(NodeContent::Nodes(user_list))),
                    ])),
                )])),
                ..InfoQuery::default()
            })
            .await
            .map_err(|error| error.wrap("failed to send usync query"))?;
        response
            .get_optional_child_by_tag(&["usync", "list"])
            .cloned()
            .ok_or_else(|| element_missing("list", "response to usync query"))
    }
}

impl Client {
    /// Stores the push names from a push name history sync.
    pub(crate) async fn handle_historical_push_names(&self, names: &[Pushname]) {
        let contacts = Arc::clone(&self.store.read().await.contacts);
        tracing::info!(
            count = names.len(),
            "updating contact store with push names from history sync"
        );
        for user in names {
            let push_name = user.pushname.as_deref().unwrap_or_default();
            if push_name == "-" {
                continue;
            }
            let id = user.id.as_deref().unwrap_or_default();
            match parse_jid(id) {
                Err(error) => {
                    tracing::warn!(error = %error, "failed to parse user ID in push name history sync")
                }
                Ok(jid) => {
                    if let Err(error) = contacts.put_push_name(&jid, push_name).await {
                        tracing::warn!(error = %error, "failed to store push name from history sync");
                    }
                }
            }
        }
    }

    /// Stores a push name seen in a message and emits [`Event::PushName`] if
    /// it changed.
    pub(crate) async fn update_push_name(
        &self,
        user: &Jid,
        user_alt: &Jid,
        message_info: &MessageInfo,
        name: &str,
    ) {
        let user = user.to_non_ad();
        let contacts = Arc::clone(&self.store.read().await.contacts);
        match contacts.put_push_name(&user, name).await {
            Err(error) => {
                tracing::error!(error = %error, "failed to save push name in device store")
            }
            Ok((false, _)) => {}
            Ok((true, previous_name)) => {
                let user_alt = self.alt_jid_or_lookup(&user, user_alt).await;
                if !user_alt.is_empty()
                    && let Err(error) = contacts.put_push_name(&user_alt, name).await
                {
                    tracing::error!(error = %error, "failed to save push name of alternate JID in device store");
                }
                tracing::debug!("push name changed, dispatching event");
                self.dispatch_event(Event::PushName(Box::new(PushName {
                    jid: user,
                    jid_alt: user_alt,
                    message: Some(message_info.clone()),
                    old_push_name: previous_name,
                    new_push_name: name.to_owned(),
                })))
                .await;
            }
        }
    }

    /// Stores a verified business name seen in a message (or a usync
    /// response, without message) and emits [`Event::BusinessName`] if it
    /// changed.
    pub(crate) async fn update_business_name(
        &self,
        user: &Jid,
        user_alt: &Jid,
        message_info: Option<&MessageInfo>,
        name: &str,
    ) {
        let contacts = Arc::clone(&self.store.read().await.contacts);
        match contacts.put_business_name(user, name).await {
            Err(error) => {
                tracing::error!(error = %error, "failed to save business name in device store")
            }
            Ok((false, _)) => {}
            Ok((true, previous_name)) => {
                let user_alt = self.alt_jid_or_lookup(user, user_alt).await;
                if !user_alt.is_empty()
                    && let Err(error) = contacts.put_business_name(&user_alt, name).await
                {
                    tracing::error!(error = %error, "failed to save business name of alternate JID in device store");
                }
                tracing::debug!("business name changed, dispatching event");
                self.dispatch_event(Event::BusinessName(Box::new(BusinessName {
                    jid: user.clone(),
                    message: message_info.cloned(),
                    old_business_name: previous_name,
                    new_business_name: name.to_owned(),
                })))
                .await;
            }
        }
    }

    async fn alt_jid_or_lookup(&self, user: &Jid, user_alt: &Jid) -> Jid {
        let user_alt = user_alt.to_non_ad();
        if !user_alt.is_empty() {
            return user_alt;
        }
        self.store
            .read()
            .await
            .get_alt_jid(user)
            .await
            .ok()
            .flatten()
            .unwrap_or_default()
    }
}

/// The verified name inside a `<business>` node, if any.
pub fn parse_verified_name(
    business_node: &Node,
) -> Result<Option<VerifiedName>, prost::DecodeError> {
    if business_node.tag != "business" {
        return Ok(None);
    }
    match business_node.get_optional_child_by_tag(&["verified_name"]) {
        Some(verified_name_node) => parse_verified_name_content(verified_name_node),
        None => Ok(None),
    }
}

/// Parses a `<verified_name>` node; `None` when it has no certificate bytes.
pub fn parse_verified_name_content(
    verified_name_node: &Node,
) -> Result<Option<VerifiedName>, prost::DecodeError> {
    let Some(NodeContent::Bytes(raw_cert)) = &verified_name_node.content else {
        return Ok(None);
    };
    let certificate = VerifiedNameCertificate::decode(raw_cert.as_slice())?;
    let details = verified_name_certificate::Details::decode(
        certificate.details.as_deref().unwrap_or_default(),
    )?;
    let mut attrs = verified_name_node.attr_getter();
    Ok(Some(VerifiedName {
        certificate: Some(certificate),
        details: Some(details),
        verified_level: attrs.string("verified_level"),
        version: attrs.int("v"),
        host_storage: attrs.int("host_storage"),
        actual_actors: attrs.int("actual_actors"),
        privacy_mode_ts: attrs.unix_time("privacy_mode_ts"),
    }))
}

/// The device JIDs in a usync `<devices>` node of the user. Hosted devices
/// get the hosted server; device IDs past `u16` truncate like Go's
/// `uint16()` conversion.
pub(crate) fn parse_device_list(user: &Jid, device_node: &Node) -> Vec<Jid> {
    let device_list = device_node.get_child_by_tag(&["device-list"]);
    if device_node.tag != "devices" || device_list.tag != "device-list" {
        return Vec::new();
    }
    let children = device_list.get_children();
    let mut devices = Vec::with_capacity(children.len());
    let mut user = user.clone();
    for device in children {
        let device_id = device.attr_getter().get_int64("id", true);
        let is_hosted = device.attr_getter().bool("is_hosted");
        let Some(device_id) = device_id else { continue };
        if device.tag != "device" {
            continue;
        }
        user.device = device_id as u16;
        if is_hosted {
            let mut hosted_user = user.clone();
            hosted_user.server = if user.server == HIDDEN_USER_SERVER {
                HOSTED_LID_SERVER
            } else {
                HOSTED_SERVER
            }
            .to_owned();
            devices.push(hosted_user);
        } else {
            devices.push(user.clone());
        }
    }
    devices
}

#[cfg(test)]
mod test;
