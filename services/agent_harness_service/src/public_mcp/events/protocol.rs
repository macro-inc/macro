//! The `events/*` requests on the wire: parsing params, the results, and the
//! extension's error codes.

use super::catalog::{CHATGPT_EVENT_TYPES, EVENT_TYPES, QUERY_EVENT, selection};
use super::stream::{
    DEFAULT_HEARTBEAT, MAX_HEARTBEAT, MIN_HEARTBEAT, NotificationSink, SUBSCRIPTION_ID_META,
    StreamPlan,
};
use super::{EventsError, McpEvents, Subscribe, Unsubscribe};
use macro_user_id::user_id::MacroUserIdStr;
use rmcp::ErrorData as McpError;
use rmcp::model::{CustomResult, ErrorCode};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use tracing::Instrument as _;
use webhook::domain::mcp::models::{McpDeliveryProfile, McpTtlRequest};
use webhook_signature::standard::SigningSecret;

/// The extension's identifier in `capabilities.extensions`.
pub(crate) const EXTENSION_ID: &str = "io.modelcontextprotocol/events";
/// Methods this extension defines; every one starts with this.
pub(crate) const METHOD_PREFIX: &str = "events/";
/// `NotFound`.
const NOT_FOUND: i32 = -32023;
/// `ResourceExhausted`.
const RESOURCE_EXHAUSTED: i32 = -32025;
/// `Unsupported`.
const UNSUPPORTED: i32 = -32026;
/// `CallbackEndpointError`.
const CALLBACK_ENDPOINT_ERROR: i32 = -32027;
/// `HeaderMismatch` (SEP-2243).
const HEADER_MISMATCH: i32 = -32020;
/// The routing header naming the event type.
const MCP_NAME_HEADER: &str = "mcp-name";
/// Sent by every request of a client following the HTTP standardization
/// (SEP-2243), which must then also send `Mcp-Name`.
const MCP_METHOD_HEADER: &str = "mcp-method";
/// The ChatGPT MCP Worker sends this extension's methods under this prefix
/// (`com.macro/chatgpt/events/subscribe`), to be answered and delivered in
/// the conventions ChatGPT follows. It grants nothing. A server from before
/// ChatGPT's profile has no such methods and answers method-not-found, so it
/// can never store a ChatGPT subscription as an MCP one, whose deliveries
/// name people.
pub(crate) const CHATGPT_METHOD_PREFIX: &str = "com.macro/chatgpt/";
/// Where a result answered under a profile other than MCP's names it, so a
/// caller that asked for one can tell it from a server that ignored the
/// header (`mcp-chatgpt-worker` checks and removes it).
pub(crate) const PROFILE_META: &str = "com.macro/eventsProfile";
/// Where the filter a subscription delivers by is returned.
pub(crate) const FILTER_META: &str = "com.macro/filter";
/// Where the reading of that filter in words is returned.
pub(crate) const INTERPRETATION_META: &str = "com.macro/interpretation";

/// Whether `error` is the answer to a subscribe's first step: the filter
/// compiled from the caller's words, to confirm.
pub(crate) fn is_confirm_step(error: &McpError) -> bool {
    error.code == ErrorCode::INVALID_PARAMS
        && error
            .data
            .as_ref()
            .is_some_and(|data| data.get(FILTER_META).is_some())
}

impl From<EventsError> for McpError {
    fn from(error: EventsError) -> Self {
        let message = error.to_string();
        match error {
            EventsError::InvalidParams(_) => McpError::invalid_params(message, None),
            EventsError::UnknownEvent => McpError::new(
                ErrorCode(NOT_FOUND),
                message,
                Some(json!({"kind": "event"})),
            ),
            EventsError::UnknownSubscription => McpError::new(
                ErrorCode(NOT_FOUND),
                message,
                Some(json!({"kind": "subscription"})),
            ),
            EventsError::ResourceExhausted { limit, max } => McpError::new(
                ErrorCode(RESOURCE_EXHAUSTED),
                message,
                Some(json!({"limit": limit, "max": max})),
            ),
            EventsError::Unsupported { feature, value } => McpError::new(
                ErrorCode(UNSUPPORTED),
                message,
                Some(json!({"feature": feature, "value": value})),
            ),
            EventsError::CallbackEndpoint(reason) => McpError::new(
                ErrorCode(CALLBACK_ENDPOINT_ERROR),
                message,
                Some(json!({"reason": reason})),
            ),
            EventsError::ConfirmFilter {
                arguments,
                compiled,
            } => McpError::invalid_params(
                format!(
                    "Nothing is subscribed yet. Your query reads as: {} If that is what you \
                     want, repeat this request with `arguments` set to this error's \
                     `data.arguments`; otherwise rephrase the query.",
                    compiled.interpretation
                ),
                Some(json!({
                    "arguments": arguments,
                    FILTER_META: compiled.filter,
                    INTERPRETATION_META: compiled.interpretation,
                })),
            ),
            EventsError::NotAdmitted(_) => McpError::new(
                ErrorCode(RESOURCE_EXHAUSTED),
                message,
                Some(json!({"limit": "ai_usage"})),
            ),
            EventsError::Internal(report) => {
                tracing::error!(error = ?report, "MCP events request failed");
                McpError::internal_error("internal error", None)
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StreamParams {
    name: String,
    #[serde(default = "empty_object")]
    arguments: Value,
    #[serde(default)]
    heartbeat_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubscribeParams {
    name: String,
    #[serde(default = "empty_object")]
    arguments: Value,
    delivery: WebhookDelivery,
}

#[derive(Deserialize)]
struct WebhookDelivery {
    mode: String,
    url: String,
    #[serde(deserialize_with = "zeroizing_string")]
    secret: zeroize::Zeroizing<String>,
}

/// A plaintext secret that is wiped when dropped.
fn zeroizing_string<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<zeroize::Zeroizing<String>, D::Error> {
    String::deserialize(deserializer).map(zeroize::Zeroizing::new)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnsubscribeParams {
    name: String,
    #[serde(default = "empty_object")]
    arguments: Value,
    delivery: UnsubscribeDelivery,
}

#[derive(Deserialize)]
struct UnsubscribeDelivery {
    url: String,
}

fn empty_object() -> Value {
    Value::Object(Map::new())
}

fn parse<T: for<'de> Deserialize<'de>>(params: Option<Value>) -> Result<T, McpError> {
    serde_json::from_value(params.unwrap_or_else(empty_object))
        .map_err(|error| McpError::invalid_params(format!("params: {error}"), None))
}

/// `ttlMs`: absent is the default, `null` asks for no expiry.
fn ttl(params: Option<&Value>) -> Result<McpTtlRequest, McpError> {
    match params.and_then(|params| params.get("ttlMs")) {
        None => Ok(McpTtlRequest::Default),
        Some(Value::Null) => Ok(McpTtlRequest::NoExpiry),
        Some(value) => value
            .as_u64()
            .map(|value| McpTtlRequest::Millis { value })
            .ok_or_else(|| {
                McpError::invalid_params("ttlMs must be a non-negative integer or null", None)
            }),
    }
}

/// A request's `Mcp-Name` header must be one value naming `params.name`. It
/// may be absent only from a client that sends no `Mcp-Method` either: one
/// from before the HTTP standardization.
fn check_name_header(extensions: &rmcp::model::Extensions, name: &str) -> Result<(), McpError> {
    let Some(headers) = extensions
        .get::<http::request::Parts>()
        .map(|parts| &parts.headers)
    else {
        return Ok(());
    };
    let mut values = headers.get_all(MCP_NAME_HEADER).iter();
    match (values.next(), values.next()) {
        (Some(value), None) if value.as_bytes() == name.as_bytes() => Ok(()),
        (None, _) if !headers.contains_key(MCP_METHOD_HEADER) => Ok(()),
        _ => Err(McpError::new(
            ErrorCode(HEADER_MISMATCH),
            "Mcp-Name must be sent once and match params.name",
            None,
        )),
    }
}

/// The profile a method is called under, and the method without its
/// profile's prefix ([`CHATGPT_METHOD_PREFIX`]); MCP's when it has none.
pub(crate) fn split_profile(method: &str) -> (McpDeliveryProfile, &str) {
    match method.strip_prefix(CHATGPT_METHOD_PREFIX) {
        Some(method) => (McpDeliveryProfile::Chatgpt, method),
        None => (McpDeliveryProfile::Mcp, method),
    }
}

/// The error code ChatGPT knows for `code`: its integration follows a draft
/// that numbered the extension's errors from -32011.
fn chatgpt_code(code: ErrorCode) -> ErrorCode {
    match code.0 {
        NOT_FOUND => ErrorCode(-32011),
        RESOURCE_EXHAUSTED => ErrorCode(-32013),
        UNSUPPORTED => ErrorCode(-32014),
        CALLBACK_ENDPOINT_ERROR => ErrorCode(-32015),
        _ => code,
    }
}

/// What a request needs from the transport.
pub(crate) struct RequestScope<'a, Sink> {
    pub(crate) user: MacroUserIdStr<'static>,
    pub(crate) request_id: Value,
    pub(crate) extensions: &'a rmcp::model::Extensions,
    pub(crate) sink: &'a Sink,
    pub(crate) cancel: CancellationToken,
    /// Opaque caller ids for spans; never the user id.
    pub(crate) span: tracing::Span,
}

/// Answer one `events/*` request.
pub(crate) async fn handle<Sink: NotificationSink>(
    events: &McpEvents,
    method: &str,
    params: Option<Value>,
    scope: RequestScope<'_, Sink>,
) -> Result<CustomResult, McpError> {
    let span = scope.span.clone();
    let (profile, method) = split_profile(method);
    span.record("mcp.events.method", method);
    span.record("mcp.events.profile", profile.as_ref());
    let result = async {
        match (profile, method) {
            (McpDeliveryProfile::Mcp, "events/list") => Ok(CustomResult(json!({
                "resultType": "complete",
                "events": &*EVENT_TYPES,
            }))),
            (McpDeliveryProfile::Chatgpt, "events/list") => Ok(CustomResult(json!({
                "events": &*CHATGPT_EVENT_TYPES,
            }))),
            (_, "events/subscribe") => subscribe(events, params, &scope, profile).await,
            (_, "events/unsubscribe") => unsubscribe(events, params, &scope, profile).await,
            (McpDeliveryProfile::Mcp, "events/stream") => stream(events, params, scope).await,
            (McpDeliveryProfile::Chatgpt, "events/stream") | (_, "events/poll") => {
                Err(EventsError::Unsupported {
                    feature: "deliveryMode",
                    value: method.trim_start_matches(METHOD_PREFIX).to_owned(),
                }
                .into())
            }
            _ => Err(McpError::new(
                ErrorCode::METHOD_NOT_FOUND,
                method.to_owned(),
                None,
            )),
        }
    }
    .instrument(span.clone())
    .await;
    let result = match profile {
        McpDeliveryProfile::Mcp => result,
        McpDeliveryProfile::Chatgpt => result
            .map(|CustomResult(mut value)| {
                if let Some(fields) = value.as_object_mut() {
                    fields.insert("_meta".to_owned(), json!({ PROFILE_META: profile }));
                }
                CustomResult(value)
            })
            .map_err(|mut error| {
                error.code = chatgpt_code(error.code);
                error
            }),
    };
    span.record(
        "mcp.outcome",
        match &result {
            Ok(_) => "success",
            Err(error) => match error.code.0 {
                -32603 => "internal_error",
                _ if is_confirmation(error) => "awaiting_confirmation",
                _ => "refused",
            },
        },
    );
    result
}

/// Refuses a type the profile's `events/list` does not offer: ChatGPT is
/// not offered the request in words, so it never reaches the compiler.
fn refuse_unlisted(name: &str, profile: McpDeliveryProfile) -> Result<(), McpError> {
    match profile {
        McpDeliveryProfile::Chatgpt if name == QUERY_EVENT => Err(EventsError::UnknownEvent.into()),
        McpDeliveryProfile::Mcp | McpDeliveryProfile::Chatgpt => Ok(()),
    }
}

/// Whether an error asks the caller to confirm a compiled filter.
fn is_confirmation(error: &McpError) -> bool {
    error
        .data
        .as_ref()
        .is_some_and(|data| data.get(INTERPRETATION_META).is_some())
}

async fn subscribe<Sink>(
    events: &McpEvents,
    params: Option<Value>,
    scope: &RequestScope<'_, Sink>,
    profile: McpDeliveryProfile,
) -> Result<CustomResult, McpError> {
    let ttl = ttl(params.as_ref())?;
    let SubscribeParams {
        name,
        arguments,
        delivery,
    } = parse(params)?;
    check_name_header(scope.extensions, &name)?;
    tracing::Span::current().record("mcp.event.name", name.as_str());
    refuse_unlisted(&name, profile)?;
    if delivery.mode != "webhook" {
        return Err(EventsError::Unsupported {
            feature: "deliveryMode",
            value: delivery.mode,
        }
        .into());
    }
    let secret = SigningSecret::parse(&delivery.secret).map_err(|_| {
        McpError::invalid_params(
            "delivery.secret is not a whsec_ secret of 24 to 64 bytes",
            None,
        )
    })?;
    drop(delivery.secret);
    let subscribed = events
        .subscribe(
            &scope.user,
            Subscribe {
                name,
                arguments,
                url: delivery.url,
                secret,
                ttl,
                profile,
            },
        )
        .await?;
    if profile == McpDeliveryProfile::Chatgpt {
        // Exactly the fields ChatGPT's documentation names.
        return Ok(CustomResult(json!({
            "id": subscribed.result.id,
            "refreshBefore": subscribed.result.refresh_before,
            "cursor": null,
            "truncated": false,
        })));
    }
    Ok(CustomResult(json!({
        "resultType": "complete",
        "id": subscribed.result.id,
        "refreshBefore": subscribed.result.refresh_before,
        "cursor": null,
        "truncated": false,
        "_meta": {
            FILTER_META: subscribed.compiled.filter,
            INTERPRETATION_META: subscribed.compiled.interpretation,
        },
    })))
}

async fn unsubscribe<Sink>(
    events: &McpEvents,
    params: Option<Value>,
    scope: &RequestScope<'_, Sink>,
    profile: McpDeliveryProfile,
) -> Result<CustomResult, McpError> {
    let UnsubscribeParams {
        name,
        arguments,
        delivery,
    } = parse(params)?;
    check_name_header(scope.extensions, &name)?;
    tracing::Span::current().record("mcp.event.name", name.as_str());
    let removed = events
        .unsubscribe(
            &scope.user,
            Unsubscribe {
                name,
                arguments,
                url: delivery.url,
            },
        )
        .await;
    match (profile, removed) {
        (McpDeliveryProfile::Mcp, removed) => {
            removed?;
            Ok(CustomResult(json!({"resultType": "complete"})))
        }
        // ChatGPT expects unsubscribing to be idempotent: one already gone
        // is the same empty result.
        (McpDeliveryProfile::Chatgpt, Ok(()) | Err(EventsError::UnknownSubscription)) => {
            Ok(CustomResult(json!({})))
        }
        (McpDeliveryProfile::Chatgpt, Err(error)) => Err(error.into()),
    }
}

async fn stream<Sink: NotificationSink>(
    events: &McpEvents,
    params: Option<Value>,
    scope: RequestScope<'_, Sink>,
) -> Result<CustomResult, McpError> {
    let StreamParams {
        name,
        arguments,
        heartbeat_ms,
    } = parse(params)?;
    check_name_header(scope.extensions, &name)?;
    tracing::Span::current().record("mcp.event.name", name.as_str());
    let selected = selection(&name, &arguments)?;
    // rmcp signals a client leaving without dropping this future, so setup
    // stops on it too, rather than waiting for the model and the sources.
    let cancelled = || McpError::new(ErrorCode::INTERNAL_ERROR, "request cancelled", None);
    // Words alone end here with their proposal, before taking a stream slot.
    let compiled = tokio::select! {
        biased;
        () = scope.cancel.cancelled() => return Err(cancelled()),
        compiled = events.compile(&scope.user, &selected) => compiled?,
    };
    let slot = events.claim_stream(&scope.user)?;
    let sources = tokio::select! {
        biased;
        () = scope.cancel.cancelled() => return Err(cancelled()),
        sources = super::stream::open_sources(&events.source, &scope.user, &compiled.filter) => {
            sources.map_err(|error| EventsError::Internal(error.0))?
        }
    };
    tracing::Span::current().record("mcp.events.sources", sources.len());
    let heartbeat = heartbeat_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_HEARTBEAT)
        .clamp(MIN_HEARTBEAT, MAX_HEARTBEAT);
    let plan = StreamPlan {
        name,
        subscription_id: scope.request_id.clone(),
        filter: compiled.filter,
        interpretation: compiled.interpretation,
        heartbeat,
    };
    // The delivery loop runs outside the request span: it lasts as long as
    // the client stays, and its end is logged with its counts instead.
    let (end, stats) = super::stream::run(
        scope.sink,
        std::sync::Arc::clone(&events.source),
        scope.user.clone(),
        sources,
        plan,
        scope.cancel.clone(),
    )
    .instrument(tracing::Span::none())
    .await;
    drop(slot);
    tracing::info!(
        parent: &scope.span,
        end = <&'static str>::from(end),
        delivered = stats.delivered,
        source_errors = stats.source_errors,
        "MCP events stream closed"
    );
    Ok(CustomResult(json!({
        "resultType": "complete",
        "_meta": {SUBSCRIPTION_ID_META: scope.request_id},
    })))
}
