//! Dispatch source node helpers to the portable Macro implementation.
use crate::replay::*;
use lexical_model::*;
use macro_document_model::nodes::*;
use serde_json::{Value, json};
fn optional<T: serde::Serialize>(value: Option<T>) -> Result<Value> {
    value
        .map(serde_json::to_value)
        .transpose()
        .map(|value| value.unwrap_or_else(undefined))
        .map_err(Into::into)
}
pub(crate) fn call(
    r: &mut Replayer,
    tx: &mut Transaction<'_>,
    name: &str,
    args: &[Value],
) -> Result<Value> {
    let first = args.first().unwrap_or(&Value::Null);
    let text = || {
        first
            .as_str()
            .ok_or_else(|| fail("Macro helper requires text"))
    };
    if let Some(class) = name.rsplit('.').next().and_then(|name| name.strip_prefix("$is"))
        && let Some(ty) = super::wire::class_type(class)
    {
        let first = args.first().unwrap_or(&Value::Null);
        return Ok(json!(first.get("$node").is_some() && first["type"] == ty));
    }
    match name.rsplit('.').next().unwrap_or(name) {
        "isGithubPullRequestUrl" => Ok(json!(
            first.as_str().is_some_and(is_github_pull_request_url)
        )),
        "parseDatabaseQueryChart" => optional(parse_database_query_chart(first)),
        "parseDatabaseQueryData" => optional(parse_database_query_data(first)),
        "parseDatabaseQueryJson" => optional(parse_database_query_json(text()?)),
        "databaseQueryMarkdown" => Ok(json!(database_query_markdown(first)?)),
        "isReplyTargetData" => Ok(json!(is_reply_target_data(first))),
        "readReplyTargetData" => Ok(read_reply_target_data(first).unwrap_or_else(undefined)),
        "buildReplyTargetMarkdown" => Ok(json!(build_reply_target_markdown(first))),
        "stripLeadingReplyTargetMarkdown" => {
            Ok(json!(strip_leading_reply_target_markdown(text()?)))
        }
        "buildAgentSessionMentionMarkdown" => {
            Ok(json!(build_agent_session_mention_markdown(first)))
        }
        "$isCursorSystemNotificationNode"
        | "$isUnknownMentionNode"
        | "$isAccountManagerRequestNode" => {
            let snapshot = r.read_state.clone();
            let view = snapshot
                .as_ref()
                .map(EditorState::view)
                .unwrap_or(tx.view());
            let is = if first.get("$node").is_some() {
                let key = node_key(first)?;
                match name.rsplit('.').next().unwrap_or(name) {
                    "$isCursorSystemNotificationNode" => {
                        view.is::<CursorSystemNotificationNode>(key)
                    }
                    "$isUnknownMentionNode" => view.is::<UnknownMentionNode>(key),
                    _ => view.is::<AccountManagerRequestNode>(key),
                }
            } else {
                false
            };
            Ok(json!(is))
        }
        _ => Err(fail(format!("unmapped Macro API: {name}"))),
    }
}
pub(crate) fn node_method(view: StateRef<'_>, key: NodeKey, method: &str) -> Result<Option<Value>> {
    if let Some(node) = view.get::<CursorSystemNotificationNode>(key) {
        return Ok(match method {
            "getText" => Some(json!(node.text)),
            "getSource" => Some(json!(node.source)),
            "getAttributes" => Some(serde_json::to_value(&node.attributes)?),
            _ => None,
        });
    }
    if let Some(node) = view.get::<ConnectAppNode>(key) {
        return Ok(match method {
            "getAppSlug" => Some(serde_json::to_value(&node.app_slug)?),
            "getName" => Some(serde_json::to_value(&node.name)?),
            "getTarget" => Some(serde_json::to_value(node.target)?),
            _ => None,
        });
    }
    Ok(None)
}
