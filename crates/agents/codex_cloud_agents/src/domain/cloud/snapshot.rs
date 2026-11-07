//! One native task/turn projection shared by transport reads and journal replay.
use super::{CloudId, ExternalPullRequest, TaskSnapshot, TurnId, TurnSnapshot};
use serde_json::Value;

impl TaskSnapshot {
    /// Interpret the original provider response while preserving it for later replay.
    pub fn from_native(task: &CloudId, data: &str) -> Result<Self, rootcause::Report> {
        let body: Value = serde_json::from_str(data)
            .map_err(|_| rootcause::report!("invalid cloud snapshot JSON (body withheld)"))?;
        let normalized = if body.get("turn").is_some() {
            serde_json::json!({"task":body.get("task"), "current_assistant_turn":body.get("turn"), "current_user_turn":body.get("user_turn")})
        } else {
            body
        };
        let mut snapshot = project(task, &normalized)?;
        snapshot.native = Some(data.to_owned());
        Ok(snapshot)
    }
}

pub(super) fn project(task: &CloudId, body: &Value) -> Result<TaskSnapshot, rootcause::Report> {
    if body.pointer("/task/id").and_then(Value::as_str) != Some(task.as_str()) {
        return Err(rootcause::report!(
            "task details identity mismatch or unexpected response shape"
        ));
    }
    let turns = [
        "current_user_turn",
        "current_assistant_turn",
        "current_diff_task_turn",
    ]
    .into_iter()
    .filter_map(|source| {
        let turn = body.get(source)?.as_object()?;
        let items = turn.get("output_items").and_then(Value::as_array);
        let messages = items
            .into_iter()
            .flatten()
            .filter(|item| item.get("type").and_then(Value::as_str) == Some("message"))
            .flat_map(|item| {
                item.get("content")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
            })
            .filter(|block| block.get("content_type").and_then(Value::as_str) == Some("text"))
            .filter_map(|block| block.get("text").and_then(Value::as_str).map(str::to_owned))
            .collect();
        let output_types = items
            .into_iter()
            .flatten()
            .filter_map(|item| item.get("type").and_then(Value::as_str).map(str::to_owned))
            .collect();
        let has_diff = items
            .into_iter()
            .flatten()
            .any(|item| item.get("diff").is_some() || item.get("output_diff").is_some());
        Some(TurnSnapshot {
            source: source.to_owned(),
            id: turn.get("id").and_then(Value::as_str).map(str::to_owned),
            messages,
            output_types,
            has_diff,
        })
    })
    .collect();
    Ok(TaskSnapshot {
        native: None,
        task_id: task.clone(),
        title: body
            .pointer("/task/title")
            .and_then(Value::as_str)
            .map(str::to_owned),
        assistant_status: body
            .pointer("/current_assistant_turn/turn_status")
            .and_then(Value::as_str)
            .map(str::to_owned),
        turns,
        pull_requests: body
            .pointer("/task/external_pull_requests")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(project_pull_request)
            .collect(),
    })
}

// Accept exactly GitHub's canonical PR URL shape. Restricting every path segment
// excludes URL userinfo, queries, fragments, encoded separators and other origins.
fn project_pull_request(value: &Value) -> Option<ExternalPullRequest> {
    let assistant_turn_id =
        TurnId::new(value.get("assistant_turn_id")?.as_str()?.to_owned()).ok()?;
    let url = value.pointer("/pull_request/url")?.as_str()?;
    let path = url.strip_prefix("https://github.com/")?;
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() != 4
        || parts[2] != "pull"
        || parts[..2].iter().any(|part| {
            part.is_empty()
                || *part == "."
                || *part == ".."
                || !part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        })
        || !parts[3].bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let number = parts[3].parse::<u64>().ok()?;
    if number == 0 {
        return None;
    }
    Some(ExternalPullRequest {
        assistant_turn_id,
        url: format!("https://github.com/{}/{}/pull/{number}", parts[0], parts[1]),
    })
}

#[cfg(test)]
mod test;
