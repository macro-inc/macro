use std::time::{Duration, SystemTime};

use reqwest::{Method, RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::Value;
use url::Url;

use super::{IMMUTABLE_ID_PREFERENCE, OutlookApiClientRepository};
use crate::domain::models::{AccessToken, EmailApiError, RateLimitOrigin, StreamToken};

impl OutlookApiClientRepository {
    pub(super) fn endpoint(&self, segments: &[&str]) -> Result<Url, EmailApiError> {
        let mut url = self.root.clone();
        url.path_segments_mut()
            .map_err(|_| invalid_response())?
            .pop_if_empty()
            .extend(segments.iter().copied());
        Ok(url)
    }

    pub(super) fn continuation(&self, token: &StreamToken) -> Result<Url, EmailApiError> {
        let url = Url::parse(token.expose()).map_err(|_| invalid_response())?;
        // Never send a bearer to a host or API root supplied by a provider cursor.
        // Redirects are disabled as well. Opaque query parameters remain unchanged.
        if url.origin() != self.root.origin()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
            || !url.path().starts_with(self.root.path())
        {
            return Err(EmailApiError::Permanent {
                message: "Microsoft Graph continuation is outside the configured API".into(),
            });
        }
        Ok(url)
    }

    pub(super) async fn request(
        &self,
        token: &AccessToken,
        method: Method,
        url: Url,
        body: Option<&Value>,
    ) -> Result<Response, EmailApiError> {
        self.conditional_request(token, method, url, body, None)
            .await
    }

    pub(super) async fn conditional_request(
        &self,
        token: &AccessToken,
        method: Method,
        url: Url,
        body: Option<&Value>,
        expected_version: Option<&str>,
    ) -> Result<Response, EmailApiError> {
        let refreshed = self
            .refreshed_token
            .lock()
            .map_err(|_| invalid_response())?
            .clone();
        let token = refreshed.as_ref().unwrap_or(token);
        let mut request = self
            .client
            .request(method, url)
            .bearer_auth(token.expose_secret())
            .header("Prefer", IMMUTABLE_ID_PREFERENCE);
        if let Some(version) = expected_version {
            request = request.header("If-Match", version);
        }
        if let Some(body) = body {
            request = request.json(body);
        }
        let retry = self
            .rejected_token_refresh
            .as_ref()
            .and_then(|_| request.try_clone());
        match self.gated_request(request).await {
            Err(EmailApiError::AuthRequired) => {
                if let (Some(refresh), Some(retry), Some(mailbox)) =
                    (&self.rejected_token_refresh, retry, self.mailbox)
                {
                    let fresh = refresh.refresh(mailbox).await?;
                    *self
                        .refreshed_token
                        .lock()
                        .map_err(|_| invalid_response())? = Some(fresh.clone());
                    // A 401 explicitly rejected this request. Every network,
                    // timeout, and non-401 response is returned without replay.
                    let mut headers = reqwest::header::HeaderMap::new();
                    let mut authorization = reqwest::header::HeaderValue::from_str(&format!(
                        "Bearer {}",
                        fresh.expose_secret()
                    ))
                    .map_err(|_| invalid_response())?;
                    authorization.set_sensitive(true);
                    headers.insert(reqwest::header::AUTHORIZATION, authorization);
                    self.gated_request(retry.headers(headers)).await
                } else {
                    Err(EmailApiError::AuthRequired)
                }
            }
            result => result,
        }
    }

    /// Includes anonymous, preauthorized attachment uploads in mailbox accounting.
    pub(super) async fn gated_request(
        &self,
        request: RequestBuilder,
    ) -> Result<Response, EmailApiError> {
        let permit = if let Some(gate) = &self.gate {
            let mailbox = self.mailbox.ok_or_else(invalid_response)?;
            Some((mailbox, gate.acquire(mailbox).await?))
        } else {
            None
        };
        let result = Self::send_request(request).await;
        if let (Some(gate), Some((mailbox, permit))) = (&self.gate, permit) {
            let retry_after = match &result {
                Err(EmailApiError::RateLimited { retry_after, .. }) => {
                    Some(retry_after.unwrap_or(Duration::from_secs(30)))
                }
                _ => None,
            };
            gate.finish(mailbox, permit, retry_after).await;
        }
        result
    }

    async fn send_request(request: RequestBuilder) -> Result<Response, EmailApiError> {
        let response = request.send().await.map_err(|_| EmailApiError::Transient {
            message: "Microsoft Graph transport failed".into(),
        })?;
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status();
        let retry_after = response
            .headers()
            .get("Retry-After")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| {
                v.parse::<u64>().ok().map(Duration::from_secs).or_else(|| {
                    httpdate::parse_http_date(v)
                        .ok()
                        .map(|date| date.duration_since(SystemTime::now()).unwrap_or_default())
                })
            });
        let body: Value = response.json().await.unwrap_or(Value::Null);
        let code = body.pointer("/error/code").and_then(Value::as_str);
        // Do not propagate provider messages, bodies, request URLs, or cursor tokens.
        Err(match status {
            StatusCode::UNAUTHORIZED => EmailApiError::AuthRequired,
            StatusCode::FORBIDDEN => EmailApiError::Forbidden,
            StatusCode::GONE => EmailApiError::OutdatedCursor,
            StatusCode::NOT_FOUND
                if matches!(
                    code,
                    Some("SyncStateNotFound" | "ErrorInvalidSyncStateData")
                ) =>
            {
                EmailApiError::OutdatedCursor
            }
            StatusCode::NOT_FOUND => EmailApiError::NotFound,
            StatusCode::CONFLICT | StatusCode::PRECONDITION_FAILED => EmailApiError::Conflict,
            StatusCode::TOO_MANY_REQUESTS => EmailApiError::RateLimited {
                retry_after,
                origin: RateLimitOrigin::Provider,
            },
            status if status.is_server_error() || status == StatusCode::REQUEST_TIMEOUT => {
                EmailApiError::Transient {
                    message: format!("Microsoft Graph returned HTTP {}", status.as_u16()),
                }
            }
            status => EmailApiError::Permanent {
                message: format!("Microsoft Graph returned HTTP {}", status.as_u16()),
            },
        })
    }

    pub(super) async fn get<T: DeserializeOwned>(
        &self,
        token: &AccessToken,
        url: Url,
    ) -> Result<T, EmailApiError> {
        self.request(token, Method::GET, url, None)
            .await?
            .json()
            .await
            .map_err(|_| invalid_response())
    }
}

pub(super) fn invalid_response() -> EmailApiError {
    EmailApiError::Permanent {
        message: "invalid Microsoft Graph response".into(),
    }
}
