//! Translate Slack response facts, without choosing import candidates.

use serde_json::{Map, Value};

use super::source_error;
use crate::domain::models::{
    SlackConversation, SlackConversationId, SlackConversationKind, SlackConversationPage,
    SlackMemberPage, SlackUser, SlackUserId, SlackUserPage,
};
use crate::domain::ports::SlackSourceError;

pub(super) fn parse_slack_channel_page(
    result: Value,
) -> Result<SlackConversationPage, SlackSourceError> {
    let (conversations, next_cursor) = parse_page(
        result,
        &["channels", "results", "items", "matches", "data", "ret"],
        parse_slack_channel,
        0,
    )?;
    Ok(SlackConversationPage {
        conversations,
        next_cursor,
    })
}

pub(super) fn parse_member_page(result: Value) -> Result<SlackMemberPage, SlackSourceError> {
    let (members, next_cursor) = parse_page(
        result,
        &["members", "users", "data", "ret"],
        |value| {
            value
                .as_str()
                .or_else(|| value.get("id").and_then(Value::as_str))
                .or_else(|| value.get("user").and_then(Value::as_str))
                .and_then(SlackUserId::new)
        },
        0,
    )?;
    Ok(SlackMemberPage {
        members,
        next_cursor,
    })
}

pub(super) fn parse_user_page(result: Value) -> Result<SlackUserPage, SlackSourceError> {
    let (users, next_cursor) = parse_page(
        result,
        &["members", "users", "results", "items", "data", "ret"],
        parse_user,
        0,
    )?;
    Ok(SlackUserPage { users, next_cursor })
}

/// Preserve valid empty pages and reject unknown/malformed responses rather than
/// reporting that a failed directory lookup found no members.
fn parse_page<T>(
    result: Value,
    wrappers: &[&str],
    parse_row: fn(&Value) -> Option<T>,
    depth: u8,
) -> Result<(Vec<T>, Option<String>), SlackSourceError> {
    if depth >= 32 {
        return Err(source_error("Slack result nesting limit exceeded".into()));
    }
    match result {
        Value::String(text) => {
            let value = serde_json::from_str(&text)
                .map_err(|_| source_error("Slack tool returned invalid JSON".into()))?;
            parse_page(value, wrappers, parse_row, depth + 1)
        }
        Value::Array(items) => Ok((items.iter().filter_map(parse_row).collect(), None)),
        Value::Object(map) => {
            if map.get("ok") == Some(&Value::Bool(false)) {
                return Err(source_error(Value::Object(map).to_string()));
            }
            if map.get("truncated") == Some(&Value::Bool(true)) {
                return Err(source_error("Slack tool returned truncated data".into()));
            }
            let next_cursor = slack_next_cursor(&map);
            for key in wrappers {
                if let Some(value) = map.get(*key) {
                    let (rows, inner_cursor) =
                        parse_page(value.clone(), wrappers, parse_row, depth + 1)?;
                    return Ok((rows, inner_cursor.or(next_cursor)));
                }
            }
            if let Some(row) = parse_row(&Value::Object(map)) {
                return Ok((vec![row], next_cursor));
            }
            Err(source_error("Unrecognized Slack response object".into()))
        }
        _ => Err(source_error("Unrecognized Slack response value".into())),
    }
}

fn slack_next_cursor(map: &Map<String, Value>) -> Option<String> {
    [
        map.get("next_cursor"),
        map.get("nextCursor"),
        map.get("cursor"),
        map.get("response_metadata")
            .and_then(|metadata| metadata.get("next_cursor")),
    ]
    .into_iter()
    .flatten()
    .filter_map(Value::as_str)
    .map(str::trim)
    .find(|cursor| !cursor.is_empty())
    .map(str::to_string)
}

fn parse_slack_channel(value: &Value) -> Option<SlackConversation> {
    let map = value.as_object()?;
    let id = map
        .get("id")
        .or_else(|| map.get("channel_id"))
        .and_then(Value::as_str)
        .and_then(SlackConversationId::new)?;
    let kind = if map.get("is_im") == Some(&Value::Bool(true)) {
        SlackConversationKind::DirectMessage
    } else if map.get("is_mpim") == Some(&Value::Bool(true)) {
        SlackConversationKind::GroupDirectMessage
    } else if ["is_private", "is_group"]
        .iter()
        .any(|key| map.get(*key) == Some(&Value::Bool(true)))
    {
        SlackConversationKind::PrivateChannel
    } else {
        SlackConversationKind::PublicChannel
    };
    let name = map
        .get("name")
        .or_else(|| map.get("channel_name"))
        .and_then(Value::as_str)
        .map(|name| name.trim().trim_start_matches('#'))
        .filter(|name| !name.is_empty())
        // IMs may not have names. Keep their identity/kind for the domain.
        .unwrap_or(id.as_str())
        .to_owned();
    let purpose = slack_channel_text(map, "purpose")
        .or_else(|| slack_channel_text(map, "topic"))
        .or_else(|| slack_channel_text(map, "description"));
    let member_count = map
        .get("num_members")
        .or_else(|| map.get("member_count"))
        .and_then(Value::as_u64);
    let archived = map.get("is_archived") == Some(&Value::Bool(true));
    Some(SlackConversation {
        id,
        name,
        kind,
        archived,
        member_count,
        purpose,
    })
}

fn slack_channel_text(map: &Map<String, Value>, key: &str) -> Option<String> {
    let value = map.get(key)?;
    value
        .as_str()
        .or_else(|| value.get("value").and_then(Value::as_str))
        .and_then(nonempty_text)
        .map(str::to_string)
}

fn nonempty_text(text: &str) -> Option<&str> {
    let text = text.trim();
    (!text.is_empty()).then_some(text)
}

fn parse_user(value: &Value) -> Option<SlackUser> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .and_then(SlackUserId::new)?;
    let profile = &value["profile"];
    let display_name = [
        profile.get("display_name"),
        value.get("real_name"),
        value.get("name"),
    ]
    .into_iter()
    .flatten()
    .filter_map(Value::as_str)
    .find_map(nonempty_text)
    .unwrap_or(id.as_str())
    .to_owned();
    let email = profile
        .get("email")
        .and_then(Value::as_str)
        .and_then(nonempty_text)
        .map(str::to_owned);
    Some(SlackUser {
        id,
        display_name,
        email,
        is_bot: value.get("is_bot") == Some(&Value::Bool(true)),
        deleted: value.get("deleted") == Some(&Value::Bool(true)),
    })
}
