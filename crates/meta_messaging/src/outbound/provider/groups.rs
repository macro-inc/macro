//! Official v26 group contract; mutating calls are made once, without retries.
use super::*;
use crate::domain::groups::{GroupCreateResult, ports::GroupProvider};

impl HttpMetaProvider {
    /// Verify required callbacks before each create attempt. A transient failure
    /// fails closed for this attempt and can recover on the next user request.
    #[tracing::instrument(skip_all, err)]
    async fn check_group_configuration(&self) -> PortResult<()> {
        let Some(app) = self.whatsapp.as_ref() else {
            return Err(MessagingError::GroupIneligible.into());
        };
        let app_token = AccessToken::new(format!("{}|{}", app.app_id, app.app_secret.expose()))?;
        let subscriptions = self
            .graph(
                Provider::Whatsapp,
                &app_token,
                Method::GET,
                &[&app.app_id, "subscriptions"],
                &[],
                None,
            )
            .await?;
        let subscribed = subscriptions["data"].as_array().is_some_and(|entries| {
            entries.iter().any(|entry| {
                entry["object"] == "whatsapp_business_account"
                    && [
                        "messages",
                        "group_lifecycle_update",
                        "group_participants_update",
                        "group_settings_update",
                        "group_status_update",
                    ]
                    .iter()
                    .all(|field| {
                        entry["fields"]
                            .as_array()
                            .is_some_and(|fields| fields.iter().any(|f| f["name"] == *field))
                    })
            })
        });
        if !subscribed {
            return Err(MessagingError::GroupIneligible.into());
        }
        Ok(())
    }
}

#[async_trait]
impl GroupProvider for HttpMetaProvider {
    #[tracing::instrument(skip_all, fields(connection_id=%c.id), err)]
    async fn require_group_eligibility(
        &self,
        c: &Connection,
        token: &AccessToken,
    ) -> PortResult<()> {
        self.check_group_configuration().await?;
        let phone = self
            .graph(
                Provider::Whatsapp,
                token,
                Method::GET,
                &[c.account_id.as_str()],
                &[(
                    "fields",
                    "id,status,platform_type,is_on_biz_app,is_official_business_account",
                )],
                None,
            )
            .await?;
        if phone["id"].as_str() != Some(c.account_id.as_str())
            || phone["status"] != "CONNECTED"
            || phone["platform_type"] != "CLOUD_API"
            || phone["is_on_biz_app"] != false
            || phone["is_official_business_account"] != true
        {
            return Err(MessagingError::GroupIneligible.into());
        }
        // Probe the documented read-only Groups capability, including Meta's
        // exclusion of Multi-solution Conversations. Never adopt returned IDs.
        let groups = self
            .graph(
                Provider::Whatsapp,
                token,
                Method::GET,
                &[c.account_id.as_str(), "groups"],
                &[("limit", "1")],
                None,
            )
            .await?;
        if !groups["data"].is_array() {
            return Err(MessagingError::GroupIneligible.into());
        }
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(connection_id=%c.id))]
    async fn create_group(
        &self,
        c: &Connection,
        token: &AccessToken,
        subject: &str,
    ) -> GroupCreateResult {
        let request = self.client.post(self.endpoint(Provider::Whatsapp, &[c.account_id.as_str(), "groups"]))
            .bearer_auth(token.expose()).json(&json!({"messaging_product":"whatsapp", "subject":subject, "join_approval_mode":"auto_approve"}));
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = match request.headers(headers).send().await {
            Ok(response) => response,
            Err(_) => return GroupCreateResult::Unknown,
        };
        let status = response.status();
        if status.is_server_error() || status == reqwest::StatusCode::REQUEST_TIMEOUT {
            return GroupCreateResult::Unknown;
        }
        let body = match bounded_bytes(response, 1024 * 1024).await {
            Ok(bytes) => serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null),
            Err(_) => return GroupCreateResult::Unknown,
        };
        if status.is_client_error() || body.get("error").is_some() {
            return GroupCreateResult::Rejected(
                body["error"]["code"]
                    .as_i64()
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "provider_rejected".into()),
            );
        }
        if status.is_success()
            && let Some(request_id) = body["request_id"]
                .as_str()
                .and_then(|s| ProviderId::try_from(s.to_owned()).ok())
        {
            return GroupCreateResult::Pending(request_id);
        }
        GroupCreateResult::Unknown
    }

    #[tracing::instrument(skip_all, fields(connection_id=%c.id), err)]
    async fn delete_group(
        &self,
        c: &Connection,
        token: &AccessToken,
        group: &ProviderId,
    ) -> PortResult<()> {
        let response = self
            .graph(
                Provider::Whatsapp,
                token,
                Method::DELETE,
                &[group.as_str()],
                &[],
                None,
            )
            .await?;
        if response["success"] != true {
            return Err(MessagingError::GroupUnconfirmed.into());
        }
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(connection_id=%c.id), err)]
    async fn remove_group_participant(
        &self,
        c: &Connection,
        token: &AccessToken,
        group: &ProviderId,
        participant: &ProviderId,
    ) -> PortResult<()> {
        let person = if participant.is_whatsapp_bsuid() {
            json!({"user_id":participant.as_str()})
        } else {
            json!({"user":participant.as_str()})
        };
        self.graph(
            Provider::Whatsapp,
            token,
            Method::DELETE,
            &[group.as_str(), "participants"],
            &[],
            Some(&json!({"messaging_product":"whatsapp", "participants":[person]})),
        )
        .await?;
        // Membership remains unchanged until the signed successful participant fact.
        Ok(())
    }
}

#[cfg(all(test, feature = "axum"))]
mod test;
