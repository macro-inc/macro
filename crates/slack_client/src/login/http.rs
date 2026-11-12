//! Login transport: a serializable cookie jar and the sign-in page's
//! requests, with redirects followed by hand so every `Set-Cookie` lands in
//! the jar.

use std::collections::BTreeMap;
use std::time::Duration;

use reqwest::header::{self, HeaderMap, HeaderValue};
use reqwest::{StatusCode, redirect};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tracing::Instrument;
use tracing::field::Empty;
use url::Url;

use crate::client::{decode, invalid_request, is_slack_url, record_error, retry_after};
use crate::credentials::Secret;
use crate::endpoints::SlackEndpoints;
use crate::error::SlackError;
use crate::method::SlackMethod;

/// Login requests time out after this long.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(30);
/// Redirects followed per page load.
const MAX_REDIRECTS: u8 = 10;
/// Login responses larger than this are refused.
const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;

/// Cookies Slack set during the login, by name. All of them belong to
/// `slack.com` and its subdomains, so one jar serves every host.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CookieJar(BTreeMap<String, Secret>);

impl CookieJar {
    /// A cookie's raw value.
    pub(crate) fn get(&self, name: &str) -> Option<&Secret> {
        self.0.get(name)
    }

    fn store(&mut self, headers: &HeaderMap) {
        for value in headers.get_all(header::SET_COOKIE) {
            let Ok(value) = value.to_str() else {
                continue;
            };
            let Ok(cookie) = cookie::Cookie::parse(value) else {
                continue;
            };
            let expired = cookie.max_age().is_some_and(|max_age| max_age.is_zero() || max_age.is_negative())
                || cookie.value().is_empty()
                || cookie.value() == "deleted";
            if expired {
                self.0.remove(cookie.name());
            } else {
                self.0
                    .insert(cookie.name().to_owned(), Secret::new(cookie.value().to_owned()));
            }
        }
    }

    fn header(&self) -> Option<HeaderValue> {
        if self.0.is_empty() {
            return None;
        }
        let pairs: Vec<String> = self
            .0
            .iter()
            .map(|(name, value)| format!("{name}={}", value.expose()))
            .collect();
        let mut value = HeaderValue::from_str(&pairs.join("; ")).ok()?;
        value.set_sensitive(true);
        Some(value)
    }
}

/// The sign-in page's HTTP client.
pub(crate) struct LoginHttp {
    http: reqwest::Client,
    pub(crate) endpoints: SlackEndpoints,
}

/// A loaded page.
pub(crate) struct Page {
    pub(crate) body: Vec<u8>,
}

impl LoginHttp {
    pub(crate) fn new(endpoints: SlackEndpoints) -> Result<Self, SlackError> {
        let http = reqwest::Client::builder()
            .timeout(LOGIN_TIMEOUT)
            .user_agent(endpoints.user_agent.clone())
            .redirect(redirect::Policy::none())
            .build()
            .map_err(|source| SlackError::Transport {
                method: SlackMethod::SignupCheckEmail,
                source,
            })?;
        Ok(Self { http, endpoints })
    }

    /// Whether a URL Slack handed out (magic links) may be loaded.
    pub(crate) fn is_trusted(&self, url: &Url) -> bool {
        is_slack_url(url, &[&self.endpoints.slack, &self.endpoints.app])
    }

    /// Posts a sign-in API method as multipart form, like the sign-in page.
    pub(crate) async fn post_api<Response: DeserializeOwned>(
        &self,
        method: SlackMethod,
        reason: Option<&str>,
        fields: &[(&'static str, &str)],
        jar: &mut CookieJar,
    ) -> Result<Response, SlackError> {
        let now = chrono::Utc::now();
        let request_id = format!("noversion-{}.{:03}", now.timestamp(), now.timestamp_subsec_millis());
        let mut url = self
            .endpoints
            .slack
            .join(&format!("api/{}", method.as_str()))
            .map_err(|error| invalid_request(method, error))?;
        url.query_pairs_mut().append_pair("_x_id", &request_id);
        let referer = self
            .endpoints
            .slack
            .join("signin")
            .map_err(|error| invalid_request(method, error))?;

        let mut form = reqwest::multipart::Form::new();
        for (name, value) in fields {
            form = form.text(*name, (*value).to_owned());
        }
        if let Some(reason) = reason {
            form = form.text("_x_reason", reason.to_owned());
        }
        let mut request = self
            .http
            .post(url)
            .header(header::ACCEPT, "application/json")
            .header(header::REFERER, referer.as_str())
            .multipart(form);
        if let Some(cookies) = jar.header() {
            request = request.header(header::COOKIE, cookies);
        }

        let span = login_span(method);
        async {
            let outcome = async {
                let response = request
                    .send()
                    .await
                    .map_err(|source| SlackError::Transport { method, source })?;
                jar.store(response.headers());
                let status = response.status();
                if status == StatusCode::TOO_MANY_REQUESTS {
                    return Err(SlackError::RateLimited {
                        method,
                        retry_after: retry_after(response.headers()),
                    });
                }
                let body = read_body(method, response).await?;
                tracing::Span::current().record("http.response.status_code", status.as_u16());
                decode(method, status, &body)
            }
            .await;
            if let Err(error) = &outcome {
                record_error(&tracing::Span::current(), error);
            }
            outcome
        }
        .instrument(span)
        .await
    }

    /// Loads a page, following redirects and storing cookies on every hop.
    pub(crate) async fn get_page(
        &self,
        method: SlackMethod,
        url: Url,
        jar: &mut CookieJar,
    ) -> Result<Page, SlackError> {
        let span = login_span(method);
        async {
            let outcome = self.follow(method, url, jar).await;
            match &outcome {
                Ok(_) => {
                    tracing::Span::current().record("http.response.status_code", 200);
                }
                Err(error) => record_error(&tracing::Span::current(), error),
            }
            outcome
        }
        .instrument(span)
        .await
    }

    async fn follow(&self, method: SlackMethod, mut url: Url, jar: &mut CookieJar) -> Result<Page, SlackError> {
        for _ in 0..=MAX_REDIRECTS {
            if !self.is_trusted(&url) {
                return Err(invalid_request(method, "login redirected off Slack"));
            }
            let mut request = self.http.get(url.clone()).header(
                header::ACCEPT,
                "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            );
            if let Some(cookies) = jar.header() {
                request = request.header(header::COOKIE, cookies);
            }
            let response = request
                .send()
                .await
                .map_err(|source| SlackError::Transport { method, source })?;
            jar.store(response.headers());
            let status = response.status();
            if status.is_redirection() {
                let location = response
                    .headers()
                    .get(header::LOCATION)
                    .and_then(|location| location.to_str().ok())
                    .ok_or_else(|| invalid_request(method, "redirect without a location"))?;
                url = url.join(location).map_err(|error| invalid_request(method, error))?;
                continue;
            }
            if status == StatusCode::TOO_MANY_REQUESTS {
                return Err(SlackError::RateLimited {
                    method,
                    retry_after: retry_after(response.headers()),
                });
            }
            if !status.is_success() {
                return Err(SlackError::HttpStatus {
                    method,
                    status: status.as_u16(),
                });
            }
            let body = read_body(method, response).await?;
            return Ok(Page { body });
        }
        Err(invalid_request(method, "too many redirects"))
    }
}

fn login_span(method: SlackMethod) -> tracing::Span {
    tracing::info_span!(
        "slack.login",
        slack.method = method.as_str(),
        http.response.status_code = Empty,
        slack.error = Empty,
        otel.status_code = Empty,
    )
}

async fn read_body(method: SlackMethod, response: reqwest::Response) -> Result<Vec<u8>, SlackError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(invalid_request(method, "login response too large"));
    }
    let body = response
        .bytes()
        .await
        .map_err(|source| SlackError::Transport { method, source })?;
    if body.len() > MAX_RESPONSE_BYTES {
        return Err(invalid_request(method, "login response too large"));
    }
    Ok(body.to_vec())
}
