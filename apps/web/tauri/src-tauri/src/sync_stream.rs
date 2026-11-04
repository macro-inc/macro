//! The HTTP opener for the native cache's streamed sync
//! (`graphql_cache_plugin::sync`): one reqwest client on the HTTP plugin's
//! cookie jar, so the stream carries the same session as the webview's
//! requests (see README "Native authentication cookies").

use async_trait::async_trait;
use graphql_cache_plugin::sync::{
    SyncHttpError, SyncHttpRequest, SyncHttpResponse, SyncResponseBody, SyncStreamOpener,
};
use reqwest::cookie::CookieStore;
use reqwest::header::{CONTENT_ENCODING, HeaderMap, HeaderName, HeaderValue};
use std::sync::Arc;
use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// Longest wait for more body bytes. The server runs the next page only once
/// the body is read, so this bounds one page's query, not the whole stream.
const READ_TIMEOUT: Duration = Duration::from_secs(120);

pub(crate) struct CookieSyncOpener {
    client: reqwest::Client,
}

impl CookieSyncOpener {
    /// `cookies` is the HTTP plugin's jar (`tauri_plugin_http::Http::cookies_jar`).
    pub(crate) fn new<C: CookieStore + 'static>(cookies: Arc<C>) -> Result<Self, reqwest::Error> {
        // No total timeout: a stream legitimately runs for minutes.
        let client = reqwest::Client::builder()
            .cookie_provider(cookies)
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .build()?;
        Ok(Self { client })
    }
}

#[async_trait]
impl SyncStreamOpener for CookieSyncOpener {
    async fn open(&self, request: SyncHttpRequest) -> Result<SyncHttpResponse, SyncHttpError> {
        let url = reqwest::Url::parse(&request.url)
            .map_err(|error| SyncHttpError(format!("invalid stream URL: {error}")))?;
        if !matches!(url.scheme(), "https" | "http") {
            return Err(SyncHttpError("stream URL must be http(s)".to_owned()));
        }
        let mut headers = HeaderMap::new();
        for (name, value) in request.headers {
            let name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|error| SyncHttpError(format!("invalid header name: {error}")))?;
            // `accept-encoding: gzip` passes through: the sync run decodes the
            // body itself (this client does not decompress).
            // The error never contains the value, which may be a bearer token.
            let value = HeaderValue::from_str(&value)
                .map_err(|error| SyncHttpError(format!("invalid `{name}` header: {error}")))?;
            headers.append(name, value);
        }
        let response = self
            .client
            .post(url)
            .headers(headers)
            .body(request.body)
            .send()
            .await
            .map_err(transport_error)?;
        let content_encoding = response
            .headers()
            .get(CONTENT_ENCODING)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        Ok(SyncHttpResponse {
            status: response.status().as_u16(),
            content_encoding,
            body: Box::new(ResponseBody(response)),
        })
    }
}

struct ResponseBody(reqwest::Response);

#[async_trait]
impl SyncResponseBody for ResponseBody {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, SyncHttpError> {
        Ok(self
            .0
            .chunk()
            .await
            .map_err(transport_error)?
            .map(Vec::from))
    }
}

/// reqwest's message plus its causes (connect, TLS, timeout), which its
/// `Display` leaves out.
fn transport_error(error: reqwest::Error) -> SyncHttpError {
    let mut message = error.to_string();
    let mut source = std::error::Error::source(&error);
    while let Some(cause) = source {
        message.push_str(": ");
        message.push_str(&cause.to_string());
        source = cause.source();
    }
    SyncHttpError(message)
}
