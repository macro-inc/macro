//! [`CaptchaSolver`] over CapSolver's `createTask` / `getTaskResult`
//! (<https://docs.capsolver.com/en/guide/api-createtask/>). The key travels
//! in the JSON body as `clientKey`; only the fields the task type documents
//! are sent, never cookies, a proxy or a user agent.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::solves::{
    CaptchaSolver, CaptchaTask, CaptchaToken, Challenge, Created, Polled, Solution, SolverError,
    TaskId, VendorErrorKind,
};

#[cfg(test)]
mod test;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// One call; polling is bounded by the gateway's own deadline.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Largest response read; a token response is a few kilobytes.
const MAX_RESPONSE_BYTES: usize = 256 * 1024;

/// CapSolver's account key; its `Debug` never shows it.
struct ClientKey(String);

impl std::fmt::Debug for ClientKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ClientKey(..)")
    }
}

/// CapSolver's task API.
#[derive(Debug)]
pub(crate) struct Capsolver {
    client: reqwest::Client,
    base_url: String,
    key: ClientKey,
}

impl Capsolver {
    pub(crate) fn new(key: &str, base_url: &str) -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: reqwest::Client::builder()
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(REQUEST_TIMEOUT)
                .build()?,
            base_url: base_url.trim_end_matches('/').to_owned(),
            key: ClientKey(key.to_owned()),
        })
    }

    async fn call<Body: Serialize>(
        &self,
        method: &'static str,
        body: &Body,
    ) -> Result<WireResponse, SolverError> {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = self
            .client
            .post(format!("{}/{method}", self.base_url))
            .headers(headers)
            .json(body)
            .send()
            .await
            .inspect_err(|error| tracing::warn!(error = ?error, method, "capsolver request failed"))
            .map_err(|_| SolverError::Vendor(VendorErrorKind::Unavailable))?;

        // Errors come back as 400/401 with the same body shape, so the body
        // decides, not the status.
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|_| SolverError::Vendor(VendorErrorKind::Unavailable))?;
        if bytes.len() > MAX_RESPONSE_BYTES {
            return Err(SolverError::Vendor(VendorErrorKind::Unavailable));
        }
        let wire: WireResponse = serde_json::from_slice(&bytes).map_err(|_| {
            tracing::warn!(
                method,
                status = status.as_u16(),
                "unreadable capsolver response"
            );
            SolverError::Vendor(VendorErrorKind::Unavailable)
        })?;

        if wire.error_id != 0 {
            let code = wire.error_code.as_deref().unwrap_or_default();
            // The code is CapSolver's fixed vocabulary; its description is
            // free text and stays out of logs.
            tracing::warn!(method, error_code = code, "capsolver refused a call");
            return Err(error_for_code(code));
        }
        Ok(wire)
    }
}

impl CaptchaSolver for Capsolver {
    async fn create_task(&self, task: &CaptchaTask) -> Result<Created, SolverError> {
        let body = CreateTask {
            client_key: &self.key.0,
            task: WireTask::from(task),
        };
        let wire = self.call("createTask", &body).await?;
        let task_id = wire
            .task_id
            .map(TaskId::new)
            .ok_or(SolverError::Vendor(VendorErrorKind::Unavailable))?;
        match wire.status.as_deref() {
            Some("ready") => Ok(Created::Ready(task_id, solution(wire.solution)?)),
            _ => Ok(Created::Pending(task_id)),
        }
    }

    async fn task_result(&self, task_id: &TaskId) -> Result<Polled, SolverError> {
        let body = GetTaskResult {
            client_key: &self.key.0,
            task_id: task_id.as_str(),
        };
        let wire = self.call("getTaskResult", &body).await?;
        match wire.status.as_deref() {
            Some("ready") => Ok(Polled::Ready(solution(wire.solution)?)),
            Some("failed") => Err(SolverError::Unsolvable),
            _ => Ok(Polled::Pending),
        }
    }
}

/// What a CapSolver error code means for the caller
/// (<https://docs.capsolver.com/en/guide/api-error/>).
fn error_for_code(code: &str) -> SolverError {
    match code {
        "ERROR_CAPTCHA_UNSOLVABLE" => SolverError::Unsolvable,
        "ERROR_TASK_TIMEOUT" => SolverError::TimedOut,
        "ERROR_RATE_LIMIT" => SolverError::Vendor(VendorErrorKind::RateLimited),
        "ERROR_ZERO_BALANCE" | "ERROR_SETTLEMENT_FAILED" => {
            SolverError::Vendor(VendorErrorKind::OutOfBalance)
        }
        "ERROR_KEY_DENIED_ACCESS" | "ERROR_KEY_TEMP_BLOCKED" | "ERROR_IP_BANNED" => {
            SolverError::Vendor(VendorErrorKind::KeyBlocked)
        }
        "ERROR_INVALID_TASK_DATA" | "ERROR_BAD_REQUEST" | "ERROR_TASKID_INVALID" => {
            SolverError::Vendor(VendorErrorKind::InvalidTask)
        }
        "ERROR_TASK_NOT_SUPPORTED" => SolverError::Vendor(VendorErrorKind::Unsupported),
        // ERROR_SERVICE_UNAVALIABLE (sic) and anything new.
        _ => SolverError::Vendor(VendorErrorKind::Unavailable),
    }
}

fn solution(wire: Option<WireSolution>) -> Result<Solution, SolverError> {
    let wire = wire.ok_or(SolverError::Vendor(VendorErrorKind::Unavailable))?;
    // reCAPTCHA answers `gRecaptchaResponse`, Turnstile `token`.
    let token = wire
        .g_recaptcha_response
        .or(wire.token)
        .filter(|token| !token.is_empty())
        .ok_or(SolverError::Vendor(VendorErrorKind::Unavailable))?;
    Ok(Solution {
        token: CaptchaToken::new(token),
        user_agent: wire.user_agent,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateTask<'a> {
    client_key: &'a str,
    task: WireTask<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GetTaskResult<'a> {
    client_key: &'a str,
    task_id: &'a str,
}

#[derive(Serialize)]
struct EnterprisePayload<'a> {
    s: &'a str,
}

#[derive(Serialize)]
struct TurnstileMetadata<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    action: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cdata: Option<&'a str>,
}

/// A task object with only the fields its type documents.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WireTask<'a> {
    #[serde(rename = "type")]
    task_type: &'static str,
    #[serde(rename = "websiteURL")]
    website_url: &'a str,
    website_key: &'a str,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    is_invisible: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    page_action: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recaptcha_data_s_value: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    enterprise_payload: Option<EnterprisePayload<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<TurnstileMetadata<'a>>,
}

impl<'a> From<&'a CaptchaTask> for WireTask<'a> {
    fn from(task: &'a CaptchaTask) -> Self {
        let task_type = task.task_type.into();
        match &task.challenge {
            Challenge::RecaptchaV2 {
                page_url,
                site_key,
                invisible,
                enterprise,
                data_s,
                action,
            } => {
                let data_s = data_s.as_deref();
                Self {
                    task_type,
                    website_url: page_url,
                    website_key: site_key,
                    is_invisible: *invisible,
                    page_action: action.as_deref(),
                    recaptcha_data_s_value: data_s.filter(|_| !enterprise),
                    enterprise_payload: data_s
                        .filter(|_| *enterprise)
                        .map(|s| EnterprisePayload { s }),
                    metadata: None,
                }
            }
            Challenge::RecaptchaV3 {
                page_url,
                site_key,
                action,
                ..
            } => Self {
                task_type,
                website_url: page_url,
                website_key: site_key,
                is_invisible: false,
                page_action: action.as_deref(),
                recaptcha_data_s_value: None,
                enterprise_payload: None,
                metadata: None,
            },
            Challenge::Turnstile {
                page_url,
                site_key,
                action,
                cdata,
            } => Self {
                task_type,
                website_url: page_url,
                website_key: site_key,
                is_invisible: false,
                page_action: None,
                recaptcha_data_s_value: None,
                enterprise_payload: None,
                metadata: (action.is_some() || cdata.is_some()).then(|| TurnstileMetadata {
                    action: action.as_deref(),
                    cdata: cdata.as_deref(),
                }),
            },
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireResponse {
    #[serde(default)]
    error_id: u8,
    error_code: Option<String>,
    status: Option<String>,
    task_id: Option<String>,
    solution: Option<WireSolution>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireSolution {
    g_recaptcha_response: Option<String>,
    token: Option<String>,
    user_agent: Option<String>,
}
