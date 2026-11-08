//! Per-node wire normalization; state import remains the one ImportPolicy mechanism.
use super::*;
use crate::policy::import_with_policy;
/// Apply host-dependent constructor defaults before the shared importer.
pub(super) fn import_node<T: ImportPolicy>(
    tx: &mut Transaction<'_>,
    json: &SerializedNode,
) -> crate::ModelResult<NodeKey> {
    let mut json = json.clone();
    match T::TYPE {
        "document-mention" if json.get("createdAt").is_none_or(Value::is_null) => {
            json.insert("createdAt".into(), crate::now_ms(tx)?.into());
        }
        "snapshot" if !json.get("snapshotDate").is_some_and(js_truthy) => {
            json.insert("snapshotDate".into(), crate::now_iso(tx)?.into());
        }
        "await" if json.get("awaitId").is_none_or(Value::is_null) => {
            json.insert("awaitId".into(), crate::nanoid(tx, 21)?.into());
        }
        "database-query" => {
            if parse_database_query_data(&Value::Object(json.clone())).is_none() {
                let node = tx.create(UnknownMentionNode {
                    name: Maybe::Value("Unavailable database question".into()),
                })?;
                return if json.get("displayMode").and_then(Value::as_str) == Some("scalar") {
                    Ok(node.key())
                } else {
                    let paragraph = tx.create(Paragraph {})?;
                    tx.append(paragraph, &[node.key()])?;
                    Ok(paragraph.key())
                };
            }
        }
        _ => {}
    }
    let key = import_with_policy::<T>(tx, &json)?;
    if T::TYPE == "custom-code"
        && json
            .get("children")
            .and_then(Value::as_array)
            .is_none_or(Vec::is_empty)
    {
        let legacy = if json.get("version").and_then(Value::as_u64) != Some(2) {
            json.get("code")
                .filter(|v| v.is_string())
                .or(json.get("text"))
        } else {
            json.get("text")
        };
        if let Some(text) = legacy.and_then(Value::as_str) {
            let text = tx.create_text(text)?;
            tx.append(key, &[text.key()])?;
            let mut code = tx.get_mut::<CustomCodeNode>(key)?;
            if code
                .code
                .language()
                .is_none_or(|lang| lang.to_lowercase() != "svg")
            {
                code.preview_enabled = false;
            }
        }
    }
    Ok(key)
}
fn null_default(json: &mut SerializedNode, name: &str, value: Value) {
    if json.get(name).is_none_or(Value::is_null) {
        json.insert(name.into(), value);
    }
}
fn falsy_default(json: &mut SerializedNode, name: &str, value: Value) {
    if !json.get(name).is_some_and(js_truthy) {
        json.insert(name.into(), value);
    }
}
/// Normalize own fields as the TS constructor/updateFromJSON does, without retaining framework keys.
pub(super) fn own_json(ty: &str, source: &SerializedNode) -> crate::ModelResult<SerializedNode> {
    let mut json = source.clone();
    match ty {
        "agent-activity" => {
            json = ["agentSessionId", "turn", "segment", "rows", "sealed"]
                .into_iter()
                .filter_map(|name| {
                    source
                        .get(name)
                        .map(|value| (name.to_owned(), value.clone()))
                })
                .collect();
        }
        "agent-context" => {
            if source.get("version").and_then(Value::as_u64) != Some(1)
                || !source.get("text").is_some_and(Value::is_string)
            {
                return Err(Error::Invariant("invalid agent context data"));
            }
        }
        "agent-session-mention" => null_default(&mut json, "expanded", false.into()),
        "await" => null_default(&mut json, "inline", true.into()),
        "booking-link-mention" => {
            let profile = source
                .get("profileId")
                .map(js_string)
                .unwrap_or_else(|| "undefined".into());
            falsy_default(
                &mut json,
                "url",
                format!("https://macro.com/app/book/{profile}").into(),
            );
        }
        "classed-block" => {
            json.shift_remove("attributes");
            if !matches!(
                source.get("tag").and_then(Value::as_str),
                Some("div" | "p" | "span" | "blockquote")
            ) {
                json.insert("tag".into(), "div".into());
            }
            falsy_default(&mut json, "classes", Value::Array(Vec::new()));
        }
        "comment-mark" => {
            null_default(&mut json, "isDraft", false.into());
        }
        "connect-app" => {
            if source.get("target").and_then(Value::as_str) != Some("harness") {
                json.insert("target".into(), "connections".into());
            }
        }
        "system-notification" => {
            if source.get("version").and_then(Value::as_u64) != Some(1) {
                return Err(Error::Invariant("invalid system notification data"));
            }
        }
        "custom-code" => null_default(&mut json, "previewEnabled", false.into()),
        "database-query" => {
            let value = parse_database_query_data(&Value::Object(source.clone()))
                .ok_or(Error::Invariant("Invalid database query"))?;
            json = serde_json::to_value(value)?
                .as_object()
                .cloned()
                .ok_or(Error::NodePayloadNotObject)?;
        }
        "diff" => {
            if source.get("label").is_none_or(Value::is_null) {
                json.insert("label".into(), default_diff_label().into());
            }
        }
        "document-card" => {
            falsy_default(&mut json, "blockParams", Value::Object(Map::new()));
            falsy_default(
                &mut json,
                "previewBox",
                serde_json::to_value(default_preview_box())?,
            );
        }
        "document-mention" => {
            null_default(&mut json, "collapsed", false.into());
            falsy_default(&mut json, "blockParams", Value::Object(Map::new()));
        }
        "equation" => {
            if source.get("equation").is_none() {
                json.insert("equation".into(), "".into());
            }
            null_default(&mut json, "inline", false.into());
        }
        "image" | "video" => {
            falsy_default(&mut json, "scale", 1.into());
            if ty == "image" {
                null_default(&mut json, "alt", "".into());
            } else {
                null_default(&mut json, "controls", true.into());
            }
        }
        "paste" => {
            if source.get("origin").and_then(Value::as_str) != Some("referenced") {
                json.insert("origin".into(), "pasted".into());
            }
        }
        "pr-mention" => {
            let id = source.get("id").and_then(Value::as_str).unwrap_or("");
            if is_github_pull_request_url(id) {
                json.insert("id".into(), "".into());
                falsy_default(&mut json, "url", id.into());
            } else if !source.get("url").is_some_and(js_truthy) {
                json.shift_remove("url");
            }
        }
        "reply-target" => {
            if !source.contains_key("parent")
                && let Some(channel) = source.get("channelId").and_then(Value::as_str)
            {
                json.insert(
                    "parent".into(),
                    serde_json::json!({"type":"channel", "id":channel}),
                );
            }
            if json
                .get("parent")
                .and_then(|p| p.get("id"))
                .and_then(Value::as_str)
                .is_none_or(|id| id.is_empty())
            {
                return Err(Error::Invariant("invalid reply-target data"));
            }
        }
        "search-match" => {
            json.insert("ids".into(), Value::Array(Vec::new()));
        }
        "user-mention" => {
            if !source.get("displayName").is_some_and(js_truthy) {
                let email = source
                    .get("email")
                    .and_then(Value::as_str)
                    .ok_or(Error::Invariant("email.split is not a function"))?;
                let display = email
                    .split('@')
                    .next()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(email);
                json.insert("displayName".into(), display.into());
            }
        }
        _ => {}
    }
    Ok(json)
}
pub(super) use lexical_model::js_string;
