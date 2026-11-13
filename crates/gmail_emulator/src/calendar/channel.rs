//! Push channels: `events.watch`, `channels.stop`, and the notifications a
//! watched calendar owes its channels.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{Calendar, not_found};
use crate::error::ApiError;
use crate::state::State;

/// A channel lasts a week unless the request asks for less.
const CHANNEL_LIFETIME_MS: i64 = 7 * 24 * 60 * 60 * 1000;
const WEB_HOOK: &str = "web_hook";

/// Why a notification is sent.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, strum::Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ResourceState {
    /// The channel was just opened.
    Sync,
    /// Something on the calendar changed.
    Exists,
}

/// An open `events.watch` channel.
#[derive(Clone, Debug)]
pub(crate) struct Channel {
    pub(crate) id: String,
    pub(crate) resource_id: String,
    pub(crate) resource_uri: String,
    pub(crate) token: Option<String>,
    pub(crate) address: String,
    pub(crate) expires_at_ms: i64,
    messages_sent: u64,
}

/// A notification waiting to be posted to a channel's webhook.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ChannelNotification {
    pub(crate) mailbox: String,
    pub(crate) calendar_id: String,
    pub(crate) channel_id: String,
    pub(crate) resource_id: String,
    pub(crate) resource_uri: String,
    pub(crate) token: Option<String>,
    pub(crate) address: String,
    pub(crate) expires_at_ms: i64,
    pub(crate) state: ResourceState,
    pub(crate) message_number: u64,
}

impl Channel {
    fn notification(
        &mut self,
        mailbox: &str,
        calendar_id: &str,
        state: ResourceState,
    ) -> ChannelNotification {
        self.messages_sent += 1;
        ChannelNotification {
            mailbox: mailbox.to_string(),
            calendar_id: calendar_id.to_string(),
            channel_id: self.id.clone(),
            resource_id: self.resource_id.clone(),
            resource_uri: self.resource_uri.clone(),
            token: self.token.clone(),
            address: self.address.clone(),
            expires_at_ms: self.expires_at_ms,
            state,
            message_number: self.messages_sent,
        }
    }
}

impl Calendar {
    /// The notifications owed to live channels, when the calendar changed
    /// since they were last notified.
    pub(crate) fn take_notifications(
        &mut self,
        mailbox: &str,
        now_ms: i64,
    ) -> Vec<ChannelNotification> {
        if self.revision == self.notified_revision {
            return Vec::new();
        }
        self.notified_revision = self.revision;

        let calendar_id = self.id.clone();
        self.channels
            .iter_mut()
            .filter(|channel| channel.expires_at_ms > now_ms)
            .map(|channel| channel.notification(mailbox, &calendar_id, ResourceState::Exists))
            .collect()
    }
}

impl State {
    /// `events.watch`: opens a channel and queues its `sync` notification.
    pub(crate) fn watch_events(
        &mut self,
        email: &str,
        calendar_id: &str,
        resource_uri: String,
        body: &Value,
    ) -> Result<Value, ApiError> {
        let required = |name: &str| {
            body.get(name)
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .ok_or_else(|| ApiError::calendar(400, "required", &format!("Missing {name}")))
        };
        let id = required("id")?;
        let address = required("address")?;
        if required("type")? != WEB_HOOK {
            return Err(ApiError::calendar(
                400,
                "push.channelUnknownType",
                "Unknown channel type",
            ));
        }
        if !address.starts_with("https://") && !address.starts_with("http://") {
            return Err(ApiError::calendar(
                400,
                "push.webhookUrlNotHttps",
                "WebHook callback must be HTTPS",
            ));
        }
        let in_use = self
            .mailboxes
            .values()
            .flat_map(|mailbox| mailbox.calendars.values())
            .flat_map(|calendar| &calendar.channels)
            .any(|channel| channel.id == id);
        if in_use {
            return Err(ApiError::calendar(
                400,
                "channelIdNotUnique",
                &format!("Channel id {id} not unique"),
            ));
        }

        let now_ms = self.now_ms();
        let ttl_ms = body
            .get("params")
            .and_then(|params| params.get("ttl"))
            .and_then(Value::as_str)
            .and_then(|seconds| seconds.parse::<i64>().ok())
            .map(|seconds| seconds * 1000);
        let lifetime_ms =
            ttl_ms.map_or(CHANNEL_LIFETIME_MS, |ttl| ttl.clamp(0, CHANNEL_LIFETIME_MS));
        let calendar = self.calendar(email, calendar_id)?;
        if !calendar.push_supported {
            return Err(ApiError::calendar(
                400,
                "pushNotSupportedForRequestedResource",
                "Push notifications are not supported by this resource.",
            ));
        }

        let mut channel = Channel {
            id,
            // Google names the watched resource, not the channel.
            resource_id: format!("emulator-resource-{}", calendar.id),
            resource_uri,
            token: body
                .get("token")
                .and_then(Value::as_str)
                .map(str::to_string),
            address,
            expires_at_ms: now_ms + lifetime_ms,
            messages_sent: 0,
        };
        let opened = channel.notification(email, &calendar.id, ResourceState::Sync);
        let mut response = json!({
            "kind": "api#channel",
            "id": channel.id,
            "resourceId": channel.resource_id,
            "resourceUri": channel.resource_uri,
            "expiration": channel.expires_at_ms.to_string(),
        });
        if let Some(token) = &channel.token {
            response["token"] = json!(token);
        }

        calendar.channels.push(channel);
        self.channel_notifications.push(opened);
        Ok(response)
    }

    /// `channels.stop`.
    pub(crate) fn stop_channel(&mut self, email: &str, body: &Value) -> Result<(), ApiError> {
        let id = body.get("id").and_then(Value::as_str);
        let resource_id = body.get("resourceId").and_then(Value::as_str);
        let mailbox = self.mailboxes.get_mut(email).ok_or_else(not_found)?;

        for calendar in mailbox.calendars.values_mut() {
            let before = calendar.channels.len();
            calendar.channels.retain(|channel| {
                Some(channel.id.as_str()) != id || Some(channel.resource_id.as_str()) != resource_id
            });
            if calendar.channels.len() != before {
                return Ok(());
            }
        }
        Err(ApiError::calendar(
            404,
            "notFound",
            &format!("Channel '{}' not found for project", id.unwrap_or_default()),
        ))
    }
}
