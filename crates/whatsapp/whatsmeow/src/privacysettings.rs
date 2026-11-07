// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow privacysettings.go (MPL-2.0, Copyright (c) Tulir Asokan)

//! The user's privacy settings: fetching, caching and changing them.

use std::sync::Arc;
use std::time::Duration;

use crate::binary::{Attrs, Node, NodeContent};
use crate::client::{Client, lock};
use crate::errors::{ClientError, element_missing};
use crate::request::{InfoQuery, IqType};
use crate::types::events::{Event, PrivacySettings as PrivacySettingsEvent};
use crate::types::{PrivacySetting, PrivacySettingType, PrivacySettings, SERVER_JID};

fn privacy_query(content: Vec<Node>) -> Option<NodeContent> {
    Some(NodeContent::Nodes(vec![Node {
        tag: "privacy".to_owned(),
        attrs: Attrs::new(),
        content: (!content.is_empty()).then_some(NodeContent::Nodes(content)),
    }]))
}

/// Applies the `<category>` children of a `<privacy>` node to the settings
/// and returns which ones changed.
pub fn parse_privacy_settings(
    privacy_node: &Node,
    settings: &mut PrivacySettings,
) -> PrivacySettingsEvent {
    let mut event = PrivacySettingsEvent::default();
    for child in privacy_node.get_children() {
        if child.tag != "category" {
            continue;
        }
        let mut attrs = child.attr_getter();
        let name = PrivacySettingType::from(attrs.string("name"));
        let value = PrivacySetting::from(attrs.string("value"));
        match name {
            PrivacySettingType::GroupAdd => {
                settings.group_add = value;
                event.group_add_changed = true;
            }
            PrivacySettingType::LastSeen => {
                settings.last_seen = value;
                event.last_seen_changed = true;
            }
            PrivacySettingType::Status => {
                settings.status = value;
                event.status_changed = true;
            }
            PrivacySettingType::Profile => {
                settings.profile = value;
                event.profile_changed = true;
            }
            PrivacySettingType::ReadReceipts => {
                settings.read_receipts = value;
                event.read_receipts_changed = true;
            }
            PrivacySettingType::Online => {
                settings.online = value;
                event.online_changed = true;
            }
            PrivacySettingType::CallAdd => {
                settings.call_add = value;
                event.call_add_changed = true;
            }
            PrivacySettingType::Messages => {
                settings.messages = value;
                event.messages_changed = true;
            }
            PrivacySettingType::Defense => {
                settings.defense = value;
                event.defense_changed = true;
            }
            PrivacySettingType::Stickers => {
                settings.stickers = value;
                event.stickers_changed = true;
            }
            PrivacySettingType::Other(_) => {}
        }
    }
    event
}

impl Client {
    /// The privacy settings, from the cache or the server
    /// (`TryFetchPrivacySettings`).
    #[tracing::instrument(name = "whatsmeow.privacy.fetch", skip_all, err)]
    pub async fn try_fetch_privacy_settings(
        &self,
        ignore_cache: bool,
    ) -> Result<PrivacySettings, ClientError> {
        if !ignore_cache && let Some(settings) = lock(&self.privacy_settings_cache).clone() {
            return Ok(settings);
        }
        let response = self
            .send_iq(InfoQuery {
                namespace: "privacy",
                r#type: IqType::Get,
                to: SERVER_JID.clone(),
                content: privacy_query(Vec::new()),
                ..Default::default()
            })
            .await?;
        let privacy_node = response
            .get_optional_child_by_tag(&["privacy"])
            .ok_or_else(|| element_missing("privacy", "response to privacy settings query"))?;
        let mut settings = PrivacySettings::default();
        parse_privacy_settings(privacy_node, &mut settings);
        *lock(&self.privacy_settings_cache) = Some(settings.clone());
        Ok(settings)
    }

    /// The privacy settings, or the defaults if fetching fails (the error is
    /// logged) (`GetPrivacySettings`).
    pub async fn get_privacy_settings(&self) -> PrivacySettings {
        self.try_fetch_privacy_settings(false)
            .await
            .inspect_err(
                |error| tracing::error!(error = %error, "failed to fetch privacy settings"),
            )
            .unwrap_or_default()
    }

    /// Changes one privacy setting and returns the updated settings
    /// (`SetPrivacySetting`).
    pub async fn set_privacy_setting(
        &self,
        name: PrivacySettingType,
        value: PrivacySetting,
    ) -> Result<PrivacySettings, ClientError> {
        let mut settings = self.try_fetch_privacy_settings(false).await?;
        self.send_iq(InfoQuery {
            namespace: "privacy",
            r#type: IqType::Set,
            to: SERVER_JID.clone(),
            content: privacy_query(vec![Node {
                tag: "category".to_owned(),
                attrs: Attrs::from([
                    ("name".to_owned(), name.as_str().into()),
                    ("value".to_owned(), value.as_str().into()),
                ]),
                content: None,
            }]),
            ..Default::default()
        })
        .await?;
        match name {
            PrivacySettingType::GroupAdd => settings.group_add = value,
            PrivacySettingType::LastSeen => settings.last_seen = value,
            PrivacySettingType::Status => settings.status = value,
            PrivacySettingType::Profile => settings.profile = value,
            PrivacySettingType::ReadReceipts => settings.read_receipts = value,
            PrivacySettingType::Online => settings.online = value,
            PrivacySettingType::CallAdd => settings.call_add = value,
            _ => {}
        }
        *lock(&self.privacy_settings_cache) = Some(settings.clone());
        Ok(settings)
    }

    /// Sets the default disappearing message timer.
    pub async fn set_default_disappearing_timer(&self, timer: Duration) -> Result<(), ClientError> {
        self.send_iq(InfoQuery {
            namespace: "disappearing_mode",
            r#type: IqType::Set,
            to: SERVER_JID.clone(),
            content: Some(NodeContent::Nodes(vec![Node {
                tag: "disappearing_mode".to_owned(),
                attrs: Attrs::from([("duration".to_owned(), timer.as_secs().to_string().into())]),
                content: None,
            }])),
            ..Default::default()
        })
        .await
        .map(|_| ())
    }

    pub(crate) async fn handle_privacy_settings_notification(
        self: &Arc<Self>,
        privacy_node: &Node,
    ) {
        tracing::debug!("parsing privacy settings change notification");
        let mut settings = match self.try_fetch_privacy_settings(false).await {
            Ok(settings) => settings,
            Err(error) => {
                tracing::error!(error = %error, "failed to fetch privacy settings when handling change");
                return;
            }
        };
        let event = parse_privacy_settings(privacy_node, &mut settings);
        *lock(&self.privacy_settings_cache) = Some(settings.clone());
        self.dispatch_event(Event::PrivacySettings(event)).await;
    }
}

#[cfg(test)]
mod test;
