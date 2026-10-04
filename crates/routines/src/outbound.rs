//! Authenticated, bounded HTTP calls to the scheduled-action service.
use crate::domain::{
    RoutineConfiguration, RoutineDetails, RoutineInfo, RoutineService, RoutineTarget,
};
use anyhow::{Context, Result, bail, ensure};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use macro_authorization::{INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER};
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::{Client, Method, Url, header::HeaderValue};
use serde::Deserialize;
use serde_json::Value;
use std::{sync::Arc, time::Duration};
use uuid::Uuid;

/// Reusable client; internal credentials never come from model arguments.
pub struct RoutineClient {
    client: Client,
    base: Url,
    key: HeaderValue,
}
impl RoutineClient {
    /// Build with a trusted service URL and internal key from application configuration.
    pub fn new(base: &str, key: &str) -> Result<Arc<Self>> {
        let base = Url::parse(&format!("{}/", base.trim_end_matches('/')))?;
        ensure!(
            matches!(base.scheme(), "http" | "https")
                && base.host_str().is_some()
                && base.username().is_empty()
                && base.password().is_none()
                && base.query().is_none()
                && base.fragment().is_none(),
            "Invalid routine service URL"
        );
        ensure!(
            !key.trim().is_empty(),
            "Routine service credentials are required"
        );
        let mut key = HeaderValue::from_str(key)?;
        key.set_sensitive(true);
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()?;
        Ok(Arc::new(Self { client, base, key }))
    }
    async fn request<T: serde::de::DeserializeOwned>(
        &self,
        user: &MacroUserIdStr<'static>,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<T> {
        let mut request = self
            .client
            .request(method, self.base.join(path)?)
            .header(INTERNAL_API_KEY_HEADER, self.key.clone())
            .header(INTERNAL_MACRO_USER_ID_HEADER, user.as_ref());
        if let Some(body) = body {
            request = request.json(&body);
        }
        let mut response = request.send().await.context("Routine request failed. Check ListRoutines before retrying a creation; the write may have succeeded.")?;
        match response.status().as_u16() {
            200..=299 => {
                const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
                ensure!(
                    response
                        .content_length()
                        .is_none_or(|length| length <= MAX_RESPONSE_BYTES as u64),
                    "Routine response is too large."
                );
                let mut body = Vec::new();
                while let Some(chunk) = response.chunk().await? {
                    ensure!(
                        body.len() + chunk.len() <= MAX_RESPONSE_BYTES,
                        "Routine response is too large."
                    );
                    body.extend_from_slice(&chunk);
                }
                serde_json::from_slice(&body).context("Invalid routine service response")
            }
            400 | 422 => bail!(
                "Invalid routine configuration or unavailable model/agent. Check the schedule and select an accessible agent from ListBots."
            ),
            401 | 403 | 404 => bail!("Routine or target is unavailable to this user."),
            409 => bail!("Routine is running or changed. Read it again before editing."),
            _ => bail!(
                "Routine service is unavailable. Check ListRoutines before retrying a creation."
            ),
        }
    }
}
#[derive(Deserialize)]
struct WireRoutine {
    id: Uuid,
    name: String,
    enabled: bool,
    trigger: Value,
    task: Value,
    next_run_at: Option<DateTime<Utc>>,
}
impl From<WireRoutine> for RoutineInfo {
    fn from(r: WireRoutine) -> Self {
        Self {
            id: r.id,
            name: r.name,
            enabled: r.enabled,
            trigger: r.trigger,
            task: r.task,
            next_run_at: r.next_run_at,
        }
    }
}
#[async_trait]
impl RoutineService for RoutineClient {
    async fn create(
        &self,
        user: &MacroUserIdStr<'static>,
        config: &RoutineConfiguration,
    ) -> Result<RoutineInfo> {
        let mut body = configuration_body(config, Utc::now())?;
        body["enabled"] = true.into();
        Ok(self
            .request::<WireRoutine>(user, Method::POST, "scheduled-actions", Some(body))
            .await?
            .into())
    }
    async fn list(&self, user: &MacroUserIdStr<'static>) -> Result<Vec<RoutineInfo>> {
        Ok(self
            .request::<Vec<WireRoutine>>(
                user,
                Method::GET,
                "scheduled-actions?include_events=true",
                None,
            )
            .await?
            .into_iter()
            .rev()
            .map(Into::into)
            .collect())
    }
    async fn read(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<RoutineDetails> {
        let routine = self
            .request::<WireRoutine>(user, Method::GET, &format!("scheduled-actions/{id}"), None)
            .await?
            .into();
        let runs = self
            .request::<Vec<Value>>(
                user,
                Method::GET,
                &format!("scheduled-actions/{id}/history"),
                None,
            )
            .await?
            .into_iter()
            .take(50)
            .collect();
        Ok(RoutineDetails { routine, runs })
    }
    async fn update(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        config: &RoutineConfiguration,
    ) -> Result<RoutineInfo> {
        Ok(self
            .request::<WireRoutine>(
                user,
                Method::PUT,
                &format!("scheduled-actions/{id}"),
                Some(configuration_body(config, Utc::now())?),
            )
            .await?
            .into())
    }
    async fn set_enabled(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        enabled: bool,
    ) -> Result<RoutineInfo> {
        Ok(self
            .request::<WireRoutine>(
                user,
                Method::PUT,
                &format!("scheduled-actions/{id}/enabled"),
                Some(serde_json::json!({ "enabled": enabled })),
            )
            .await?
            .into())
    }
}

fn configuration_body(config: &RoutineConfiguration, now: DateTime<Utc>) -> Result<Value> {
    config.validate(now)?;
    let (schedule, timezone) = config.schedule.cron(now)?;
    let mut task = serde_json::json!({ "prompt": "", "user_prompt": config.instructions });
    match &config.target {
        RoutineTarget::Model { model } => task["model"] = model.clone().into(),
        RoutineTarget::Agent { agent_id } => {
            task["agent"] = serde_json::json!({ "bot_id": agent_id })
        }
    }
    Ok(
        serde_json::json!({ "name": config.name, "kind": "Agent", "trigger": { "type": "cron", "schedule": schedule, "timezone": timezone }, "task": task }),
    )
}
#[cfg(test)]
mod test;
