//! The channel-list row: what the Chat sidebar's three channel lists read of a
//! channel, shaped from its complete `ChannelListItemFields` record.
//!
//! Field names and meanings are the web's `ChannelEntity`, as today's
//! `mapGraphqlSoupItem` then `mapChannelToEntity` produce them. A value they
//! turn into `undefined` is left out here; the web fills in only the name's
//! fallback and the own-touch and notified floors. `channelListRow` in
//! `apps/web/src/lib/queries/soup/graphql/channel-list-row.ts` is the same
//! function in TypeScript, for hosts without this shape, and the committed
//! corpus pins the two to the same rows.

use cache_core::engine::live_query::RowShape;

use crate::live_query::LiveRowName;
use serde_json::{Map, Value as Json};

/// The name a live-view request selects this row by.
pub const CHANNEL_LIST_ROW: &str = "channel-list";

/// Shapes a channel-list row for a live view.
pub const CHANNEL_LIST_ROW_SHAPE: RowShape = RowShape::new(CHANNEL_LIST_ROW, channel_list_row);

/// The row a complete `ChannelListItemFields` record shows. A record of another
/// Soup type is sent as selected, for the web's general mapper.
pub fn channel_list_row(record: &Json) -> Json {
    if record.get("__typename").and_then(Json::as_str) != Some("GraphqlSoupChannel") {
        return record.clone();
    }
    let mut row = Map::new();
    let field = |name: &str| record.get(name).unwrap_or(&Json::Null);
    let present = |name: &str| record.get(name).filter(|value| !value.is_null());
    row.insert("__typename".into(), field("__typename").clone());
    row.insert("id".into(), field("id").clone());
    row.insert("name".into(), field("channelName").clone());
    row.insert(
        "channelType".into(),
        match field("channelType") {
            Json::String(kind) => Json::String(kind.to_lowercase()),
            other => other.clone(),
        },
    );
    if let Some(team) = present("channelTeamId") {
        row.insert("teamId".into(), team.clone());
    }
    row.insert("ownerId".into(), field("ownerId").clone());
    row.insert("createdAt".into(), field("createdAt").clone());
    row.insert("updatedAt".into(), field("updatedAt").clone());
    row.insert(
        "participantIds".into(),
        Json::Array(
            field("participants")
                .as_array()
                .into_iter()
                .flatten()
                .map(|participant| participant.get("userId").cloned().unwrap_or(Json::Null))
                .collect(),
        ),
    );
    row.insert(
        "isParticipant".into(),
        present("isParticipant")
            .cloned()
            .unwrap_or(Json::Bool(true)),
    );
    if let Some(viewed) = present("viewedAt").or_else(|| present("interactedAt")) {
        row.insert("viewedAt".into(), viewed.clone());
    }
    if let Some(interacted) = present("interactedAt") {
        row.insert("interactedAt".into(), interacted.clone());
    }
    for (from, to) in [
        ("latestMessage", "latestMessage"),
        ("latestNonThreadMessage", "latestRootMessage"),
    ] {
        if let Some(message) = record.get(from) {
            row.insert(to.into(), channel_message(message));
        }
    }
    row.insert(
        "frecencyScore".into(),
        present("frecencyScore")
            .cloned()
            .unwrap_or_else(|| Json::from(0)),
    );
    if let Some(favorited) = record.get("isFavorited") {
        row.insert("isFavorited".into(), favorited.clone());
    }
    if let Some(Json::Array(notifications)) = record.get("unreadNotifications") {
        row.insert(
            "unreadNotifications".into(),
            notifications
                .iter()
                .map(|notification| notification_edge(notification, &["id", "state", "createdAt"]))
                .collect(),
        );
    }
    if let Some(Json::Array(mentions)) = record.get("unreadMentions") {
        row.insert(
            "unreadMentions".into(),
            mentions
                .iter()
                .map(|mention| notification_edge(mention, &["id", "state"]))
                .collect(),
        );
    }
    Json::Object(row)
}

/// A channel's latest message as the entity holds it. A null message stays
/// null, which the web reads as no message.
fn channel_message(message: &Json) -> Json {
    let Json::Object(message) = message else {
        return message.clone();
    };
    let field = |name: &str| message.get(name).cloned().unwrap_or(Json::Null);
    let mut out = Map::new();
    out.insert("messageId".into(), field("messageId"));
    if let Some(thread) = message.get("threadId").filter(|value| !value.is_null()) {
        out.insert("threadId".into(), thread.clone());
    }
    out.insert("content".into(), field("content"));
    out.insert(
        "mentions".into(),
        message
            .get("mentions")
            .filter(|value| !value.is_null())
            .cloned()
            .unwrap_or_else(|| Json::Array(Vec::new())),
    );
    out.insert("senderId".into(), field("senderId"));
    out.insert("createdAt".into(), field("createdAt"));
    Json::Object(out)
}

/// An unread edge's notification, its state lowercased as
/// `notificationStateFromGraphql` does (an unknown state reads as seen).
fn notification_edge(notification: &Json, fields: &[&str]) -> Json {
    let mut out = Map::new();
    for name in fields {
        let value = notification.get(*name).cloned().unwrap_or(Json::Null);
        let value = if *name == "state" {
            Json::String(
                match value.as_str() {
                    Some("UNSEEN") => "unseen",
                    Some("DONE") => "done",
                    _ => "seen",
                }
                .into(),
            )
        } else {
            value
        };
        out.insert((*name).into(), value);
    }
    Json::Object(out)
}

/// The shape of the live-view row a request names.
pub fn live_row_shape(name: Option<LiveRowName>) -> Option<RowShape> {
    name.map(|name| match name {
        LiveRowName::ChannelList => CHANNEL_LIST_ROW_SHAPE,
    })
}

#[cfg(test)]
mod test;
