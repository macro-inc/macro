//! Desktop 26.908.70816 WHAM continuation, cancellation and turn subscription.

use super::{CreateResponse, receipt, stream};
use crate::domain::Credentials;
use crate::domain::cloud::{
    CloudConversation, CloudEventStream, CloudId, CreatedTask, TaskSnapshot, TurnId,
};
use crate::outbound::openai::{OpenAi, decode};
use serde_json::Value;
use std::time::Duration;

impl CloudConversation for OpenAi {
    async fn follow_up(
        &self,
        auth: &Credentials,
        task: &CloudId,
        turn: &TurnId,
        prompt: &str,
    ) -> Result<CreatedTask, rootcause::Report> {
        let response = self.client.post(format!("{}/wham/tasks", self.cloud))
            .bearer_auth(auth.access_token.expose())
            .header("ChatGPT-Account-Id", &auth.account_id)
            .header("originator", "macro-codex-probe")
            .json(&serde_json::json!({
                "follow_up": {"task_id":task.as_str(), "turn_id":turn.as_str(), "environment_mode":"code"},
                "input_items":[{"type":"message","role":"user","content":[{"content_type":"text","text":prompt}]}]
            })).send().await.map_err(|_| rootcause::report!("follow-up acceptance unknown (network/timeout); inspect Codex web before retrying"))?;
        let body: CreateResponse = decode(
            response,
            "follow-up; acceptance may be unknown, inspect Codex web before retrying",
        )
        .await?;
        let created = receipt(body)?;
        if created.task_id != *task {
            return Err(rootcause::report!(
                "follow-up task identity mismatch; acceptance unknown, inspect Codex web"
            ));
        }
        Ok(created)
    }

    async fn cancel(&self, auth: &Credentials, task: &CloudId) -> Result<(), rootcause::Report> {
        let response = self
            .client
            .post(format!(
                "{}/wham/tasks/{}/cancel",
                self.cloud,
                task.as_str()
            ))
            .bearer_auth(auth.access_token.expose())
            .header("ChatGPT-Account-Id", &auth.account_id)
            .header("originator", "macro-codex-probe")
            .send()
            .await
            .map_err(|_| {
                rootcause::report!("remote cancellation outcome unknown (network/timeout)")
            })?;
        let body: Value = decode(response, "cancel task").await?;
        if body.get("success").and_then(Value::as_bool) != Some(true) {
            return Err(rootcause::report!(
                "provider did not confirm cancellation request; inspect remote task state"
            ));
        }
        Ok(())
    }

    async fn turn(
        &self,
        auth: &Credentials,
        task: &CloudId,
        turn: &TurnId,
    ) -> Result<TaskSnapshot, rootcause::Report> {
        let response = self
            .client
            .get(format!(
                "{}/wham/tasks/{}/turns/{}",
                self.cloud,
                task.as_str(),
                turn.as_str()
            ))
            .bearer_auth(auth.access_token.expose())
            .header("ChatGPT-Account-Id", &auth.account_id)
            .header("originator", "macro-codex-probe")
            .send()
            .await
            .map_err(|_| rootcause::report!("turn observation failed (network/timeout)"))?;
        let body = crate::outbound::openai::native_body(response, "read turn").await?;
        let snapshot = TaskSnapshot::from_native(task, &body)?;
        if !snapshot.turns.iter().any(|item| {
            item.source == "current_assistant_turn" && item.id.as_deref() == Some(turn.as_str())
        }) {
            return Err(rootcause::report!(
                "turn identity mismatch or unexpected response shape"
            ));
        }
        Ok(snapshot)
    }

    async fn stream(
        &self,
        auth: &Credentials,
        task: &CloudId,
        turn: &TurnId,
    ) -> Result<CloudEventStream, rootcause::Report> {
        let response = self
            .client
            .get(format!(
                "{}/wham/tasks/{}/turns/{}/stream?item_type=thread_event&item_type=log",
                self.cloud,
                task.as_str(),
                turn.as_str()
            ))
            .bearer_auth(auth.access_token.expose())
            .header("ChatGPT-Account-Id", &auth.account_id)
            .header("originator", "macro-codex-probe")
            .header("Accept", "text/event-stream")
            .timeout(Duration::from_secs(30 * 60))
            .send()
            .await
            .map_err(|_| rootcause::report!("event subscription failed (network/timeout)"))?;
        if !response.status().is_success() {
            let status = response.status();
            return Err(rootcause::report!(
                "event subscription HTTP {status}; remote work may still be running"
            ));
        }
        if response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .map(str::trim)
            != Some("text/event-stream")
        {
            return Err(rootcause::report!(
                "event subscription returned an unexpected content type"
            ));
        }
        Ok(stream::subscribe(response))
    }
}
