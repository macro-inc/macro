//! Source-derived task HTTP endpoints, isolated from the OAuth lifecycle.

use super::{OpenAi, decode};
use crate::domain::Credentials;
use crate::domain::cloud::{CloudId, CloudTasks, CreatedTask, Launch, TaskSnapshot, TurnId};
use serde::Deserialize;

mod conversation;
mod stream;

#[cfg(test)]
mod test;
#[cfg(test)]
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
        let body = super::native_body(response, "read task details").await?;
        TaskSnapshot::from_native(task, &body)
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

#[cfg(test)]
fn project(task: &CloudId, body: &Value) -> Result<TaskSnapshot, rootcause::Report> {
    TaskSnapshot::from_native(task, &body.to_string())
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
