use crate::{
    AuthServiceClient,
    error::{AuthServiceClientError, GenericErrorResponse},
};

/// Secret-bearing response intentionally does not implement Debug.
#[derive(serde::Deserialize)]
pub struct MicrosoftAccessToken {
    pub access_token: String,
    pub scopes: Vec<String>,
}

/// Non-secret, owner-bound result of a completed Microsoft OAuth attempt.
#[derive(Debug, serde::Deserialize)]
pub struct CompletedMicrosoftGrant {
    pub calendar_requested: bool,
    pub grant_id: uuid::Uuid,
    pub generation: i64,
    pub owner: uuid::Uuid,
    pub email: String,
    pub tenant_id: String,
    pub mailbox_id: String,
    pub scopes: Vec<String>,
}

impl AuthServiceClient {
    /// Revoke an exact released credential without touching a replacement grant.
    pub async fn revoke_microsoft_grant(
        &self,
        grant_id: uuid::Uuid,
        generation: i64,
        owner: &str,
    ) -> Result<(), AuthServiceClientError> {
        #[derive(serde::Serialize)]
        struct Request<'a> {
            grant_id: uuid::Uuid,
            generation: i64,
            owner: &'a str,
        }
        let response = self
            .client
            .post(format!("{}/internal/revoke_microsoft_grant", self.url))
            .timeout(std::time::Duration::from_secs(30))
            .json(&Request {
                grant_id,
                generation,
                owner,
            })
            .send()
            .await
            .map_err(|_| unavailable())?;
        if response.status() == reqwest::StatusCode::NO_CONTENT {
            Ok(())
        } else {
            Err(unavailable())
        }
    }
    pub async fn completed_microsoft_grant(
        &self,
        attempt_id: uuid::Uuid,
        owner: uuid::Uuid,
    ) -> Result<CompletedMicrosoftGrant, AuthServiceClientError> {
        let response = self
            .client
            .get(format!("{}/internal/microsoft_grant", self.url))
            .query(&[("attempt_id", attempt_id), ("owner", owner)])
            .send()
            .await
            .map_err(|_| unavailable())?;
        match response.status() {
            reqwest::StatusCode::OK => response.json().await.map_err(|_| unavailable()),
            reqwest::StatusCode::FORBIDDEN => Err(AuthServiceClientError::Forbidden),
            reqwest::StatusCode::NOT_FOUND => Err(AuthServiceClientError::NotFound),
            _ => Err(unavailable()),
        }
    }
    /// Obtain a token exclusively for cleaning up an already-frozen inbox.
    pub async fn get_microsoft_disconnect_token(
        &self,
        link_id: uuid::Uuid,
        generation: i64,
        sync_generation: i64,
    ) -> Result<MicrosoftAccessToken, AuthServiceClientError> {
        let response = self
            .client
            .get(format!("{}/internal/microsoft_disconnect_token", self.url))
            .timeout(std::time::Duration::from_secs(60))
            .query(&[
                ("link_id", link_id.to_string()),
                ("generation", generation.to_string()),
                ("sync_generation", sync_generation.to_string()),
            ])
            .send()
            .await
            .map_err(|_| unavailable())?;
        match response.status() {
            reqwest::StatusCode::OK => {
                let token: MicrosoftAccessToken =
                    response.json().await.map_err(|_| unavailable())?;
                if token.access_token.is_empty() {
                    return Err(unavailable());
                }
                Ok(token)
            }
            reqwest::StatusCode::UNAUTHORIZED => Err(AuthServiceClientError::Unauthorized),
            reqwest::StatusCode::FORBIDDEN => Err(AuthServiceClientError::Forbidden),
            reqwest::StatusCode::NOT_FOUND => Err(AuthServiceClientError::NotFound),
            _ => Err(unavailable()),
        }
    }
    /// Fetch a token bound to an existing Outlook link and its current grant
    /// generation. Owner and mailbox address are resolved by authentication.
    pub async fn get_microsoft_access_token(
        &self,
        link_id: uuid::Uuid,
        generation: i64,
        sync_generation: i64,
        force_refresh: bool,
    ) -> Result<MicrosoftAccessToken, AuthServiceClientError> {
        let response = self
            .client
            .get(format!("{}/internal/microsoft_access_token", self.url))
            .timeout(std::time::Duration::from_secs(60))
            .query(&[
                ("link_id", link_id.to_string()),
                ("generation", generation.to_string()),
                ("sync_generation", sync_generation.to_string()),
                ("force_refresh", force_refresh.to_string()),
            ])
            .send()
            .await
            .map_err(|_| unavailable())?;
        match response.status() {
            reqwest::StatusCode::OK => {
                let token: MicrosoftAccessToken =
                    response.json().await.map_err(|_| unavailable())?;
                if token.access_token.is_empty() {
                    return Err(unavailable());
                }
                Ok(token)
            }
            reqwest::StatusCode::UNAUTHORIZED => Err(AuthServiceClientError::Unauthorized),
            reqwest::StatusCode::FORBIDDEN => Err(AuthServiceClientError::Forbidden),
            reqwest::StatusCode::NOT_FOUND => Err(AuthServiceClientError::NotFound),
            _ => Err(unavailable()),
        }
    }
}

fn unavailable() -> AuthServiceClientError {
    AuthServiceClientError::Generic(GenericErrorResponse {
        message: "Microsoft access token is temporarily unavailable".into(),
    })
}
