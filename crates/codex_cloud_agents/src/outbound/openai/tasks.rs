//! Source-derived task HTTP endpoints, isolated from the OAuth lifecycle.

use super::{OpenAi, decode};
use crate::domain::Credentials;
use crate::domain::cloud::{
    CloudId, CloudTasks, CreatedTask, Launch, TaskSnapshot, TurnId, TurnSnapshot,
};
use serde::Deserialize;

mod conversation;
mod stream;

#[cfg(test)]
mod test;
use serde_json::Value;

impl CloudTasks for OpenAi {
    async fn create(
        &self,
        auth: &Credentials,
        request: &Launch,
    ) -> Result<CreatedTask, rootcause::Report> {
        let response = self.client.post(format!("{}/wham/tasks", self.cloud))
            .bearer_auth(auth.access_token.expose())
            .header("ChatGPT-Account-Id", &auth.account_id)
            .header("originator", "macro-codex-probe")
            .json(&serde_json::json!({
                "new_task": {"environment_id": request.environment.as_str(), "branch": request.branch, "run_environment_in_qa_mode": false},
                "input_items": [{"type":"message", "role":"user", "content":[{"content_type":"text", "text":request.prompt}]}],
            })).send().await
            .map_err(|_| rootcause::report!("task submission outcome unknown (network/timeout); inspect Codex web before retrying"))?;
        let body: CreateResponse = decode(
            response,
            "create task; acceptance may be unknown, inspect Codex web before retrying",
        )
        .await?;
        receipt(body)
    }

    async fn snapshot(
        &self,
        auth: &Credentials,
        task: &CloudId,
    ) -> Result<TaskSnapshot, rootcause::Report> {
        let response = self
            .client
            .get(format!("{}/wham/tasks/{}", self.cloud, task.as_str()))
            .bearer_auth(auth.access_token.expose())
            .header("ChatGPT-Account-Id", &auth.account_id)
            .header("originator", "macro-codex-probe")
            .send()
            .await
            .map_err(|_| {
                rootcause::report!(
                    "task observation failed (network/timeout); remote work may still be running"
                )
            })?;
        let body: Value = decode(response, "read task details").await?;
        project(task, &body)
    }
}

#[derive(Deserialize)]
struct TaskIdentity {
    id: String,
}
#[derive(Deserialize)]
struct CreateResponse {
    task: Option<TaskIdentity>,
    id: Option<String>,
    assistant_turn: Option<TaskIdentity>,
    turn: Option<TaskIdentity>,
    assistant_turn_id: Option<String>,
}

fn project(task: &CloudId, body: &Value) -> Result<TaskSnapshot, rootcause::Report> {
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

fn receipt(body: CreateResponse) -> Result<CreatedTask, rootcause::Report> {
    let id = body.task.map(|task| task.id).or(body.id).ok_or_else(|| {
        rootcause::report!(
            "creation returned no task ID; acceptance unknown, inspect Codex web before retrying"
        )
    })?;
    let task_id = CloudId::new(id)?;
    let assistant_turn_id = body
        .turn
        .or(body.assistant_turn)
        .map(|turn| turn.id)
        .or(body.assistant_turn_id)
        .map(TurnId::new)
        .transpose()?;
    Ok(CreatedTask {
        url: format!("https://chatgpt.com/codex/tasks/{}", task_id.as_str()),
        task_id,
        assistant_turn_id,
    })
}
