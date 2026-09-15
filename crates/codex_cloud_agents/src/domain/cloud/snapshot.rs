//! One native task/turn projection shared by transport reads and journal replay.
use super::{CloudId, TaskSnapshot, TurnSnapshot};
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
    })
}
