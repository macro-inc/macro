//! rmcp's streamable-HTTP client, served by the egress proxy in-process.
//!
//! The sandboxed harnesses reach their MCP servers by dialing the proxy over
//! the wire. This runtime lives in the same process as the proxy, so it hands
//! each request straight to the proxy's domain service instead: the same
//! token check, the same owner resolution, the same credential stamping, the
//! same answer for an app the owner has not connected - and no loopback
//! socket, no reachable-from-here base URL, nothing to configure.
//!
//! What it is given is still the ACP server list, URLs and all, because that
//! is what every harness is given. The URL's path names the server and the
//! `Authorization` header carries the session token; both are read here the
//! way the proxy's router reads them.

use std::collections::HashMap;
use std::sync::Arc;

use agent_egress::domain::error::EgressError;
use agent_egress::domain::model::{
    EgressTarget, McpDestination, ProxyBody, ProxyRequest, ProxyResponse, SessionToken,
};
use agent_egress::domain::service::EgressService;
use bytes::Bytes;
use futures::StreamExt as _;
use futures::stream::BoxStream;
use http::header::{ACCEPT, CONTENT_TYPE};
use http::{HeaderName, HeaderValue, Method, StatusCode};
use http_body_util::{BodyExt as _, Empty, Full};
use rmcp::model::{ClientJsonRpcMessage, JsonRpcMessage, ServerJsonRpcMessage};
use rmcp::transport::common::http_header::{
    EVENT_STREAM_MIME_TYPE, HEADER_LAST_EVENT_ID, HEADER_SESSION_ID, JSON_MIME_TYPE,
};
use rmcp::transport::streamable_http_client::{
    SseError, StreamableHttpClient, StreamableHttpError, StreamableHttpPostResponse,
};
use sse_stream::{Sse, SseStream};

#[cfg(test)]
mod test;

/// What stops a request short of the proxy, or the proxy's own refusal.
#[derive(Debug, thiserror::Error)]
pub enum EgressCallError {
    /// The URL does not name a server the proxy serves.
    #[error("{0} is not an egress MCP server URL")]
    NotAnEgressUrl(String),
    /// The server entry carried no session token.
    #[error("the MCP server entry carries no session token")]
    NoSessionToken,
    /// The proxy refused or failed the call.
    #[error(transparent)]
    Egress(#[from] EgressError),
    /// The proxy answered, but its body could not be read.
    #[error("could not read the proxy's response body: {0}")]
    Body(String),
}

type CallError = StreamableHttpError<EgressCallError>;

/// A [`StreamableHttpClient`] that calls the egress service directly.
///
/// One `Arc` shared with the proxy's own listener, so the two are the same
/// service with the same pools, not two configured alike.
pub struct EgressMcpClient<Egress> {
    egress: Arc<Egress>,
}

impl<Egress> EgressMcpClient<Egress> {
    /// A client over the service the proxy's listener also serves.
    pub fn new(egress: Arc<Egress>) -> Self {
        Self { egress }
    }
}

// Derived `Clone` would demand `Egress: Clone`, which the service is not.
impl<Egress> Clone for EgressMcpClient<Egress> {
    fn clone(&self) -> Self {
        Self {
            egress: Arc::clone(&self.egress),
        }
    }
}

/// Where a request is going, read off the pieces rmcp hands over.
struct Addressed {
    token: SessionToken,
    target: EgressTarget,
}

fn address(uri: &str, auth_header: Option<String>) -> Result<Addressed, CallError> {
    let url = url::Url::parse(uri).map_err(|_| {
        StreamableHttpError::Client(EgressCallError::NotAnEgressUrl(uri.to_owned()))
    })?;
    let destination = McpDestination::from_path(url.path()).ok_or_else(|| {
        StreamableHttpError::Client(EgressCallError::NotAnEgressUrl(uri.to_owned()))
    })?;
    let token = auth_header
        .map(SessionToken::new)
        .ok_or(StreamableHttpError::Client(EgressCallError::NoSessionToken))?;
    Ok(Addressed {
        token,
        target: EgressTarget::McpServer(destination),
    })
}

fn empty_body() -> ProxyBody {
    Empty::new().map_err(|never| match never {}).boxed_unsync()
}

fn full_body(bytes: Vec<u8>) -> ProxyBody {
    Full::new(Bytes::from(bytes))
        .map_err(|never| match never {})
        .boxed_unsync()
}

fn build_request(
    method: Method,
    uri: &str,
    session_id: Option<&str>,
    custom_headers: HashMap<HeaderName, HeaderValue>,
    body: ProxyBody,
) -> Result<ProxyRequest, CallError> {
    let mut builder = http::Request::builder()
        .method(method)
        .uri(uri)
        .header(ACCEPT, [EVENT_STREAM_MIME_TYPE, JSON_MIME_TYPE].join(", "));
    if let Some(session_id) = session_id {
        builder = builder.header(HEADER_SESSION_ID, session_id);
    }
    for (name, value) in custom_headers {
        builder = builder.header(name, value);
    }
    builder.body(body).map_err(|error| {
        StreamableHttpError::UnexpectedServerResponse(format!("malformed request: {error}").into())
    })
}

fn content_type(response: &ProxyResponse) -> Option<String> {
    response
        .headers()
        .get(CONTENT_TYPE)
        .map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned())
}

fn session_id(response: &ProxyResponse) -> Option<String> {
    response
        .headers()
        .get(HEADER_SESSION_ID)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

fn is_event_stream(content_type: Option<&str>) -> bool {
    content_type.is_some_and(|value| value.starts_with(EVENT_STREAM_MIME_TYPE))
}

fn is_json(content_type: Option<&str>) -> bool {
    content_type.is_some_and(|value| value.starts_with(JSON_MIME_TYPE))
}

/// The response body as the event stream rmcp consumes.
fn event_stream(body: ProxyBody) -> BoxStream<'static, Result<Sse, SseError>> {
    // `sse_stream` wants a stream whose error is a sized `Error`; the proxy's
    // body error is boxed, so it goes through `io::Error`.
    let bytes = body
        .into_data_stream()
        .map(|chunk| chunk.map_err(std::io::Error::other));
    SseStream::from_byte_stream(bytes).boxed()
}

async fn read_body(body: ProxyBody) -> Result<Bytes, CallError> {
    body.collect()
        .await
        .map(|collected| collected.to_bytes())
        .map_err(|error| StreamableHttpError::Client(EgressCallError::Body(error.to_string())))
}

impl<Egress> StreamableHttpClient for EgressMcpClient<Egress>
where
    Egress: EgressService + 'static,
{
    type Error = EgressCallError;

    async fn post_message(
        &self,
        uri: Arc<str>,
        message: ClientJsonRpcMessage,
        session_id: Option<Arc<str>>,
        auth_header: Option<String>,
        custom_headers: HashMap<HeaderName, HeaderValue>,
    ) -> Result<StreamableHttpPostResponse, CallError> {
        let Addressed { token, target } = address(&uri, auth_header)?;
        let body = serde_json::to_vec(&message)?;
        let mut request = build_request(
            Method::POST,
            &uri,
            session_id.as_deref(),
            custom_headers,
            full_body(body),
        )?;
        request
            .headers_mut()
            .insert(CONTENT_TYPE, HeaderValue::from_static(JSON_MIME_TYPE));

        let response = self
            .egress
            .proxy(&token, target, request)
            .await
            .map_err(|error| StreamableHttpError::Client(EgressCallError::Egress(error)))?;

        let status = response.status();
        if matches!(status, StatusCode::ACCEPTED | StatusCode::NO_CONTENT) {
            return Ok(StreamableHttpPostResponse::Accepted);
        }
        if status == StatusCode::NOT_FOUND && session_id.is_some() {
            return Err(StreamableHttpError::SessionExpired);
        }
        let content_type = content_type(&response);
        let response_session = self::session_id(&response);
        if !status.is_success() {
            // A JSON-RPC error in the body is the server speaking and goes
            // to the model; anything else is transport failure.
            let body = read_body(response.into_body()).await?;
            if is_json(content_type.as_deref())
                && let Ok(message @ JsonRpcMessage::Error(_)) =
                    serde_json::from_slice::<ServerJsonRpcMessage>(&body)
            {
                return Ok(StreamableHttpPostResponse::Json(message, response_session));
            }
            return Err(StreamableHttpError::UnexpectedServerResponse(
                format!("HTTP {status}: {}", String::from_utf8_lossy(&body)).into(),
            ));
        }
        if is_event_stream(content_type.as_deref()) {
            return Ok(StreamableHttpPostResponse::Sse(
                event_stream(response.into_body()),
                response_session,
            ));
        }
        if is_json(content_type.as_deref()) {
            let body = read_body(response.into_body()).await?;
            return match serde_json::from_slice::<ServerJsonRpcMessage>(&body) {
                Ok(message) => Ok(StreamableHttpPostResponse::Json(message, response_session)),
                Err(error) => {
                    // A 200 to a notification with no `id` is not a message;
                    // rmcp's own client treats it as accepted, so do the same.
                    tracing::warn!(error = ?error, "MCP response was not a JSON-RPC message; treating it as accepted");
                    Ok(StreamableHttpPostResponse::Accepted)
                }
            };
        }
        Err(StreamableHttpError::UnexpectedContentType(content_type))
    }

    async fn delete_session(
        &self,
        uri: Arc<str>,
        session_id: Arc<str>,
        auth_header: Option<String>,
        custom_headers: HashMap<HeaderName, HeaderValue>,
    ) -> Result<(), CallError> {
        let Addressed { token, target } = address(&uri, auth_header)?;
        let request = build_request(
            Method::DELETE,
            &uri,
            Some(&session_id),
            custom_headers,
            empty_body(),
        )?;
        let response = self
            .egress
            .proxy(&token, target, request)
            .await
            .map_err(|error| StreamableHttpError::Client(EgressCallError::Egress(error)))?;
        let status = response.status();
        if status == StatusCode::METHOD_NOT_ALLOWED {
            tracing::debug!("the MCP server does not support deleting a session");
            return Ok(());
        }
        if !status.is_success() {
            return Err(StreamableHttpError::UnexpectedServerResponse(
                format!("HTTP {status} deleting the MCP session").into(),
            ));
        }
        Ok(())
    }

    async fn get_stream(
        &self,
        uri: Arc<str>,
        session_id: Arc<str>,
        last_event_id: Option<String>,
        auth_header: Option<String>,
        custom_headers: HashMap<HeaderName, HeaderValue>,
    ) -> Result<BoxStream<'static, Result<Sse, SseError>>, CallError> {
        let Addressed { token, target } = address(&uri, auth_header)?;
        let mut request = build_request(
            Method::GET,
            &uri,
            Some(&session_id),
            custom_headers,
            empty_body(),
        )?;
        if let Some(last_event_id) = last_event_id {
            let value = HeaderValue::from_str(&last_event_id).map_err(|_| {
                StreamableHttpError::UnexpectedServerResponse("invalid last event id".into())
            })?;
            request
                .headers_mut()
                .insert(HeaderName::from_static(HEADER_LAST_EVENT_ID), value);
        }
        let response = self
            .egress
            .proxy(&token, target, request)
            .await
            .map_err(|error| StreamableHttpError::Client(EgressCallError::Egress(error)))?;
        let status = response.status();
        if status == StatusCode::METHOD_NOT_ALLOWED {
            return Err(StreamableHttpError::ServerDoesNotSupportSse);
        }
        if !status.is_success() {
            return Err(StreamableHttpError::UnexpectedServerResponse(
                format!("HTTP {status} opening the MCP event stream").into(),
            ));
        }
        let content_type = content_type(&response);
        if !is_event_stream(content_type.as_deref()) && !is_json(content_type.as_deref()) {
            return Err(StreamableHttpError::UnexpectedContentType(content_type));
        }
        Ok(event_stream(response.into_body()))
    }
}
