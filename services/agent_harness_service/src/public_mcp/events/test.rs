use super::catalog::{CHATGPT_EVENT_TYPES, EVENT_TYPES, MAX_QUERY_CHARS, QUERY_EVENT, selection};
use super::compiler::{CompileError, FilterCompiler, parse_outcome};
use super::dss::{
    EventSource, SourceError, SourceEvent, SourceItem, SourceStream, StoreError, SubscriptionStore,
    source_item,
};
use super::protocol::{
    FILTER_META, INTERPRETATION_META, PROFILE_HEADER, PROFILE_META, RequestScope, handle,
};
use super::stream::{NotificationSink, SUBSCRIPTION_ID_META, SinkClosed};
use super::{Compiled, MAX_STREAMS_PER_USER, McpEvents, SecretSealer, Selection};
use futures::StreamExt as _;
use futures::channel::mpsc;
use macro_user_id::user_id::MacroUserIdStr;
use rmcp::ErrorData as McpError;
use rmcp::model::CustomResult;
use serde_json::{Value, json};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use webhook::domain::mcp::filter::{
    McpEventFilter, McpFieldCondition, McpFilterClause, McpFilterField, McpFilterValue,
};
use webhook::domain::mcp::models::{
    MAX_FILTER_BYTES, McpDeliveryProfile, McpEndpointFailure, McpSecretCiphertext,
    McpSubscribeRequest, McpSubscribeResult, McpSubscriptionErrorBody, McpSubscriptionId,
    McpTtlRequest, McpUnsubscribeRequest,
};
use webhook::domain::models::{WEBHOOK_EVENT_NAMES, WebhookFilter};
use webhook_signature::standard::SigningSecret;

const ME: &str = "macro|me@example.com";
const OTHER: &str = "macro|other@example.com";
const SECRET: &str = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const CHANNEL: &str = "0193a5b2-0000-7000-8000-000000000001";
const OTHER_CHANNEL: &str = "0193a5b2-0000-7000-8000-000000000002";
const MENTIONS: &str = "I want all @ mentions in channels";

fn me() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(ME).unwrap()
}

fn literal(value: &str) -> McpFilterValue {
    McpFilterValue::Literal {
        value: value.to_owned(),
    }
}

/// "@ mentions of me in channels", as the compiler should give it.
/// `macro.events` arguments confirming `channel_mentions` for `MENTIONS`.
fn confirmed() -> Value {
    json!({"query": MENTIONS, "filter": channel_mentions()})
}

/// What a request in words was compiled to, from the confirmation it asks.
fn shown(result: Result<Compiled, super::EventsError>) -> Compiled {
    match result {
        Err(super::EventsError::ConfirmFilter { compiled, .. }) => compiled,
        other => panic!("expected a confirmation, got {other:?}"),
    }
}

fn channel_mentions() -> McpEventFilter {
    McpEventFilter {
        any_of: vec![McpFilterClause {
            events: vec!["message.mentioned".to_owned()],
            ids: None,
            all_of: vec![
                McpFieldCondition {
                    field: McpFilterField::ParentType,
                    one_of: vec![literal("channel")],
                },
                McpFieldCondition {
                    field: McpFilterField::MentionedId,
                    one_of: vec![McpFilterValue::Me],
                },
            ],
        }],
    }
}

/// A broker envelope of `message.mentioned`.
fn mention(parent_type: &str, parent_id: &str, mentioned: &str) -> Value {
    json!({
        "event_type": "message.mentioned",
        "schema_version": 1,
        "metadata": {
            "parent": {"type": parent_type, "id": parent_id},
            "sender": OTHER,
            "mentioned": {"entity_type": "user", "entity_id": mentioned},
        },
    })
}

fn event(name: &str, envelope: Value) -> SourceEvent {
    SourceEvent {
        event_id: uuid::Uuid::now_v7().to_string(),
        name: name.to_owned(),
        envelope,
    }
}

#[derive(Default)]
struct FakeCompiler {
    queries: Mutex<Vec<String>>,
    answer: Mutex<Option<CompileError>>,
    /// The filter to answer with instead of `channel_mentions`.
    filter: Mutex<Option<McpEventFilter>>,
    /// When set, each compile waits for it before answering.
    hold: Mutex<Option<Arc<tokio::sync::Notify>>>,
}

#[async_trait::async_trait]
impl FilterCompiler for FakeCompiler {
    async fn compile(
        &self,
        _: &MacroUserIdStr<'static>,
        query: &str,
    ) -> Result<McpEventFilter, CompileError> {
        self.queries.lock().unwrap().push(query.to_owned());
        let hold = self.hold.lock().unwrap().clone();
        if let Some(hold) = hold {
            hold.notified().await;
        }
        match self.answer.lock().unwrap().take() {
            Some(error) => Err(error),
            None => Ok(self
                .filter
                .lock()
                .unwrap()
                .clone()
                .unwrap_or_else(channel_mentions)),
        }
    }
}

/// Keeps subscriptions by name, arguments and URL, as the service does.
#[derive(Default)]
struct FakeStore {
    stored: Mutex<HashMap<(String, String, String), McpEventFilter>>,
    subscribes: Mutex<Vec<McpSubscribeRequest>>,
    unsubscribes: Mutex<Vec<McpUnsubscribeRequest>>,
    refuse: Mutex<Option<McpSubscriptionErrorBody>>,
    /// The profile it stores, whatever was asked: set it to play storage
    /// that predates profiles.
    stored_profile: Mutex<Option<McpDeliveryProfile>>,
}

fn key(event_type: &str, arguments: &Value, url: &str) -> (String, String, String) {
    (event_type.to_owned(), arguments.to_string(), url.to_owned())
}

#[async_trait::async_trait]
impl SubscriptionStore for FakeStore {
    async fn subscribe(
        &self,
        _: &MacroUserIdStr<'static>,
        request: &McpSubscribeRequest,
    ) -> Result<McpSubscribeResult, StoreError> {
        self.subscribes.lock().unwrap().push(request.clone());
        if let Some(body) = self.refuse.lock().unwrap().take() {
            return Err(StoreError::Refused(body));
        }
        let key = key(
            &request.event_type,
            &request.arguments,
            &request.endpoint_url,
        );
        let filter = request.filter.clone();
        self.stored.lock().unwrap().insert(key, filter.clone());
        Ok(McpSubscribeResult {
            id: McpSubscriptionId::from_stored("sub_1".to_owned()),
            refresh_before: chrono::DateTime::from_timestamp(1_800_000_000, 0).unwrap(),
            filter,
            profile: *self
                .stored_profile
                .lock()
                .unwrap()
                .get_or_insert(request.profile),
        })
    }

    async fn unsubscribe(
        &self,
        _: &MacroUserIdStr<'static>,
        request: &McpUnsubscribeRequest,
    ) -> Result<(), StoreError> {
        self.unsubscribes.lock().unwrap().push(request.clone());
        let key = key(
            &request.event_type,
            &request.arguments,
            &request.endpoint_url,
        );
        match self.stored.lock().unwrap().remove(&key) {
            Some(_) => Ok(()),
            None => Err(StoreError::Refused(McpSubscriptionErrorBody::NotFound)),
        }
    }
}

/// Hands out the streams a test queued for each `ids`, then streams that
/// never yield.
#[derive(Default)]
struct FakeSource {
    queued: Mutex<HashMap<Option<Vec<String>>, VecDeque<SourceStream>>>,
    opens: Mutex<Vec<(WebhookFilter, Option<String>)>>,
    /// A UUIDv7 minted as each open began.
    open_times: Mutex<Vec<uuid::Uuid>>,
    fail_open: Mutex<bool>,
}

type SourceSender = mpsc::UnboundedSender<Result<SourceItem, SourceError>>;

impl FakeSource {
    /// Queue a stream for `ids` and return its sender.
    fn queue(&self, ids: Option<Vec<String>>) -> SourceSender {
        let (sender, receiver) = mpsc::unbounded();
        self.queued
            .lock()
            .unwrap()
            .entry(ids)
            .or_default()
            .push_back(receiver.boxed());
        sender
    }
}

#[async_trait::async_trait]
impl EventSource for FakeSource {
    async fn open(
        &self,
        _: &MacroUserIdStr<'static>,
        filter: &WebhookFilter,
        resume_after: Option<&str>,
    ) -> Result<SourceStream, SourceError> {
        self.open_times.lock().unwrap().push(uuid::Uuid::now_v7());
        self.opens
            .lock()
            .unwrap()
            .push((filter.clone(), resume_after.map(str::to_owned)));
        if *self.fail_open.lock().unwrap() {
            return Err(SourceError(rootcause::report!("source down")));
        }
        Ok(self
            .queued
            .lock()
            .unwrap()
            .get_mut(&filter.ids)
            .and_then(VecDeque::pop_front)
            .unwrap_or_else(|| futures::stream::pending().boxed()))
    }
}

#[derive(Default)]
struct FakeSealer {
    sealed: Mutex<u32>,
}

fn ciphertext() -> McpSecretCiphertext {
    McpSecretCiphertext {
        ciphertext: b"sealed".to_vec(),
        kms_key_id: "key".to_owned(),
        encryption_version: 1,
    }
}

#[async_trait::async_trait]
impl SecretSealer for FakeSealer {
    async fn seal(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &SigningSecret,
    ) -> Result<McpSecretCiphertext, rootcause::Report> {
        *self.sealed.lock().unwrap() += 1;
        Ok(ciphertext())
    }
}

/// The notifications a stream sent, in order.
struct Sink(mpsc::UnboundedSender<(&'static str, Value)>);

impl NotificationSink for Sink {
    async fn send(&self, method: &'static str, params: Value) -> Result<(), SinkClosed> {
        self.0
            .unbounded_send((method, params))
            .map_err(|_| SinkClosed)
    }
}

struct Fixture {
    compiler: Arc<FakeCompiler>,
    store: Arc<FakeStore>,
    source: Arc<FakeSource>,
    sealer: Arc<FakeSealer>,
    events: McpEvents,
}

fn fixture() -> Fixture {
    let compiler = Arc::new(FakeCompiler::default());
    let store = Arc::new(FakeStore::default());
    let source = Arc::new(FakeSource::default());
    let sealer = Arc::new(FakeSealer::default());
    let events = McpEvents::new(
        compiler.clone(),
        store.clone(),
        source.clone(),
        sealer.clone(),
    );
    Fixture {
        compiler,
        store,
        source,
        sealer,
        events,
    }
}

fn no_extensions() -> rmcp::model::Extensions {
    rmcp::model::Extensions::new()
}

/// Run one request that is not a stream.
async fn call(
    events: &McpEvents,
    method: &str,
    params: Value,
    extensions: &rmcp::model::Extensions,
) -> Result<CustomResult, McpError> {
    let (sender, _receiver) = mpsc::unbounded();
    let sink = Sink(sender);
    handle(
        events,
        method,
        Some(params),
        RequestScope {
            user: me(),
            request_id: json!(7),
            extensions,
            sink: &sink,
            cancel: CancellationToken::new(),
            span: tracing::Span::none(),
        },
    )
    .await
}

fn subscribe_params(name: &str, arguments: Value) -> Value {
    json!({
        "name": name,
        "arguments": arguments,
        "delivery": {"mode": "webhook", "url": "https://agent.example/hook", "secret": SECRET},
    })
}

// --- selection ------------------------------------------------------------

#[test]
fn a_query_is_trimmed_and_bounded() {
    assert_eq!(
        selection(QUERY_EVENT, &json!({"query": "  my mentions  "})).unwrap(),
        Selection::Query {
            query: "my mentions".to_owned(),
            filter: None,
        }
    );
    assert_eq!(
        selection(QUERY_EVENT, &confirmed()).unwrap(),
        Selection::Query {
            query: MENTIONS.to_owned(),
            filter: Some(channel_mentions()),
        }
    );
    assert!(selection(QUERY_EVENT, &json!({"query": "x", "filter": {"anyOf": 1}})).is_err());
    // `null` is not a filter, so it is refused rather than taken for words alone.
    assert!(selection(QUERY_EVENT, &json!({"query": "x", "filter": null})).is_err());
    assert!(selection(QUERY_EVENT, &json!({"query": "   "})).is_err());
    // PostgreSQL cannot store a NUL character.
    assert!(selection(QUERY_EVENT, &json!({"query": "new\u{0}messages"})).is_err());
    let long = "a".repeat(MAX_QUERY_CHARS + 1);
    assert!(selection(QUERY_EVENT, &json!({"query": long})).is_err());
    assert!(selection(QUERY_EVENT, &json!({})).is_err());
    assert!(selection(QUERY_EVENT, &json!({"query": "x", "extra": 1})).is_err());
}

#[test]
fn a_named_type_takes_optional_ids() {
    assert_eq!(
        selection("message.posted", &json!({})).unwrap(),
        Selection::Event {
            name: "message.posted",
            ids: None,
            conditions: Vec::new(),
        }
    );
    assert_eq!(
        selection("message.posted", &json!({"ids": [CHANNEL]})).unwrap(),
        Selection::Event {
            name: "message.posted",
            ids: Some(vec![CHANNEL.to_owned()]),
            conditions: Vec::new(),
        }
    );
    assert!(selection("message.posted", &json!({"ids": []})).is_err());
    assert!(selection("message.posted", &json!({"ids": [""]})).is_err());
    assert!(selection("message.posted", &json!({"ids": ["chan\u{0}nel"]})).is_err());
    let many: Vec<String> = (0..17).map(|index| index.to_string()).collect();
    assert!(selection("message.posted", &json!({"ids": many})).is_err());
    assert!(selection("message.posted", &json!({"query": "x"})).is_err());
}

#[test]
fn an_unknown_type_is_not_found() {
    assert!(matches!(
        selection("message.teleported", &json!({})),
        Err(super::EventsError::UnknownEvent)
    ));
}

// --- events/list ----------------------------------------------------------

#[tokio::test]
async fn list_offers_the_query_type_and_every_webhook_event() {
    let fixture = fixture();
    let CustomResult(listed) = call(&fixture.events, "events/list", json!({}), &no_extensions())
        .await
        .unwrap();
    assert_eq!(listed["resultType"], "complete");
    let types = listed["events"].as_array().unwrap();
    assert_eq!(types.len(), WEBHOOK_EVENT_NAMES.len() + 1);
    assert_eq!(types[0]["name"], QUERY_EVENT);
    assert_eq!(types[0]["inputSchema"]["required"], json!(["query"]));
    // The filter argument is described by the filter's own schema, whose
    // references resolve at the input schema's root.
    let schema = &types[0]["inputSchema"];
    assert_eq!(schema["properties"]["filter"]["required"], json!(["anyOf"]));
    let reference = schema["properties"]["filter"]["properties"]["anyOf"]["items"]["$ref"]
        .as_str()
        .unwrap();
    let name = reference.strip_prefix("#/$defs/").unwrap();
    assert!(schema["$defs"][name].is_object());
    for entry in types {
        assert_eq!(entry["delivery"], json!(["push", "webhook"]));
        assert!(!entry["description"].as_str().unwrap().is_empty());
        assert_eq!(entry["inputSchema"]["additionalProperties"], false);
        assert!(entry["payloadSchema"]["properties"]["metadata"].is_object());
    }
    assert_eq!(&*EVENT_TYPES, types);
}

#[tokio::test]
async fn unknown_methods_and_poll_are_refused() {
    let fixture = fixture();
    let unknown = call(
        &fixture.events,
        "events/teleport",
        json!({}),
        &no_extensions(),
    )
    .await
    .unwrap_err();
    assert_eq!(unknown.code, rmcp::model::ErrorCode::METHOD_NOT_FOUND);
    let poll = call(&fixture.events, "events/poll", json!({}), &no_extensions())
        .await
        .unwrap_err();
    assert_eq!(poll.code.0, -32026);
    assert_eq!(poll.data.unwrap()["value"], "poll");
}

// --- events/subscribe -----------------------------------------------------

#[tokio::test]
async fn words_alone_are_compiled_and_shown_back_without_subscribing() {
    let fixture = fixture();
    let error = call(
        &fixture.events,
        "events/subscribe",
        subscribe_params(QUERY_EVENT, json!({"query": MENTIONS})),
        &no_extensions(),
    )
    .await
    .unwrap_err();

    // The one error response the handler leaves unlogged.
    assert!(super::is_confirm_step(&error));
    assert!(!super::is_confirm_step(&rmcp::ErrorData::invalid_params(
        "params: missing field",
        Some(json!({"field": "query"})),
    )));
    let reading = "`message.mentioned` events where the message is in a `\"channel\"` and the mentioned item is you.";
    assert_eq!(error.code.0, -32602);
    assert!(error.message.starts_with("Nothing is subscribed yet."));
    assert!(error.message.contains(reading));
    let data = error.data.unwrap();
    assert_eq!(data["arguments"], confirmed());
    assert_eq!(
        data[FILTER_META],
        serde_json::to_value(channel_mentions()).unwrap()
    );
    assert_eq!(data[INTERPRETATION_META], reading);
    assert_eq!(*fixture.compiler.queries.lock().unwrap(), vec![MENTIONS]);
    // Nothing is sealed or stored until the filter is confirmed.
    assert_eq!(*fixture.sealer.sealed.lock().unwrap(), 0);
    assert!(fixture.store.subscribes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_confirmed_filter_subscribes_without_a_model_call() {
    let fixture = fixture();
    let params = subscribe_params(QUERY_EVENT, confirmed());
    let CustomResult(result) = call(
        &fixture.events,
        "events/subscribe",
        params.clone(),
        &no_extensions(),
    )
    .await
    .unwrap();

    assert_eq!(result["id"], "sub_1");
    assert_eq!(result["refreshBefore"], "2027-01-15T08:00:00Z");
    assert_eq!(result["cursor"], Value::Null);
    assert_eq!(result["truncated"], false);
    assert_eq!(
        result["_meta"][FILTER_META],
        serde_json::to_value(channel_mentions()).unwrap()
    );
    assert_eq!(
        result["_meta"][INTERPRETATION_META],
        "`message.mentioned` events where the message is in a `\"channel\"` and the mentioned item is you."
    );
    assert_eq!(*fixture.sealer.sealed.lock().unwrap(), 1);
    {
        let subscribes = fixture.store.subscribes.lock().unwrap();
        assert_eq!(subscribes.len(), 1);
        assert_eq!(subscribes[0].filter, channel_mentions());
        assert_eq!(subscribes[0].arguments, confirmed());
        assert_eq!(subscribes[0].secret_ciphertext, ciphertext());
        assert_eq!(subscribes[0].ttl, McpTtlRequest::Default);
        assert_eq!(subscribes[0].endpoint_url, "https://agent.example/hook");
    }

    // A refresh is the same request again: still no model call.
    call(
        &fixture.events,
        "events/subscribe",
        params,
        &no_extensions(),
    )
    .await
    .unwrap();
    assert!(fixture.compiler.queries.lock().unwrap().is_empty());
    assert_eq!(fixture.store.subscribes.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn a_confirmed_filter_delivery_cannot_evaluate_is_refused() {
    let fixture = fixture();
    let error = call(
        &fixture.events,
        "events/subscribe",
        subscribe_params(
            QUERY_EVENT,
            json!({"query": MENTIONS, "filter": {"anyOf": [{"events": ["message.teleported"]}]}}),
        ),
        &no_extensions(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.code.0, -32602);
    assert!(error.message.starts_with("arguments.filter"));
    assert!(fixture.compiler.queries.lock().unwrap().is_empty());
    assert!(fixture.store.subscribes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_named_type_sends_its_filter_without_a_model_call() {
    let fixture = fixture();
    let CustomResult(result) = call(
        &fixture.events,
        "events/subscribe",
        subscribe_params("message.posted", json!({"ids": [CHANNEL]})),
        &no_extensions(),
    )
    .await
    .unwrap();

    let expected = McpEventFilter::for_events(
        vec!["message.posted".to_owned()],
        Some(vec![CHANNEL.to_owned()]),
    );
    let subscribes = fixture.store.subscribes.lock().unwrap();
    assert_eq!(subscribes.len(), 1);
    assert_eq!(subscribes[0].filter, expected.clone());
    assert!(fixture.compiler.queries.lock().unwrap().is_empty());
    assert_eq!(
        result["_meta"][INTERPRETATION_META],
        format!("`message.posted` events for `\"{CHANNEL}\"`.")
    );
}

#[tokio::test]
async fn ttl_absent_null_and_given_are_told_apart() {
    for (ttl, expected) in [
        (None, McpTtlRequest::Default),
        (Some(Value::Null), McpTtlRequest::NoExpiry),
        (Some(json!(60_000)), McpTtlRequest::Millis { value: 60_000 }),
    ] {
        let fixture = fixture();
        let mut params = subscribe_params("message.posted", json!({}));
        if let Some(ttl) = ttl {
            params["ttlMs"] = ttl;
        }
        call(
            &fixture.events,
            "events/subscribe",
            params,
            &no_extensions(),
        )
        .await
        .unwrap();
        assert_eq!(fixture.store.subscribes.lock().unwrap()[0].ttl, expected);
    }
    let fixture = fixture();
    let mut params = subscribe_params("message.posted", json!({}));
    params["ttlMs"] = json!(-1);
    let error = call(
        &fixture.events,
        "events/subscribe",
        params,
        &no_extensions(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.code.0, -32602);
}

#[tokio::test]
async fn subscribe_refuses_what_it_cannot_deliver() {
    let fixture = fixture();
    let mut push = subscribe_params("message.posted", json!({}));
    push["delivery"]["mode"] = json!("push");
    let error = call(&fixture.events, "events/subscribe", push, &no_extensions())
        .await
        .unwrap_err();
    assert_eq!(error.code.0, -32026);

    let mut weak = subscribe_params("message.posted", json!({}));
    weak["delivery"]["secret"] = json!("whsec_c2hvcnQ=");
    let error = call(&fixture.events, "events/subscribe", weak, &no_extensions())
        .await
        .unwrap_err();
    assert_eq!(error.code.0, -32602);
    assert!(!error.message.contains("c2hvcnQ"));

    let error = call(
        &fixture.events,
        "events/subscribe",
        subscribe_params("message.teleported", json!({})),
        &no_extensions(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.code.0, -32023);
    assert_eq!(error.data.unwrap()["kind"], "event");
    assert!(fixture.store.subscribes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_request_the_filter_cannot_express_is_refused() {
    let fixture = fixture();
    *fixture.compiler.answer.lock().unwrap() = Some(CompileError::Refused(
        "matching message text is not supported".to_owned(),
    ));
    let error = call(
        &fixture.events,
        "events/subscribe",
        subscribe_params(QUERY_EVENT, json!({"query": "messages that say hello"})),
        &no_extensions(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.code.0, -32602);
    assert!(
        error
            .message
            .contains("matching message text is not supported")
    );
}

#[tokio::test]
async fn a_user_out_of_ai_usage_is_told_so() {
    let fixture = fixture();
    *fixture.compiler.answer.lock().unwrap() = Some(CompileError::NotAdmitted(
        ai_billing::AiAdmissionError::Unavailable,
    ));
    let error = call(
        &fixture.events,
        "events/subscribe",
        subscribe_params(QUERY_EVENT, json!({"query": MENTIONS})),
        &no_extensions(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.code.0, -32025);
    assert_eq!(error.data.unwrap()["limit"], "ai_usage");
}

#[tokio::test]
async fn service_refusals_keep_their_codes() {
    for (body, code) in [
        (
            McpSubscriptionErrorBody::ResourceExhausted { max: 50 },
            -32025,
        ),
        (
            McpSubscriptionErrorBody::CallbackEndpointError {
                reason: McpEndpointFailure::ChallengeFailed,
            },
            -32027,
        ),
        (
            McpSubscriptionErrorBody::InvalidParams {
                message: "url must be https".to_owned(),
            },
            -32602,
        ),
        (McpSubscriptionErrorBody::Internal, -32603),
    ] {
        let fixture = fixture();
        *fixture.store.refuse.lock().unwrap() = Some(body);
        let error = call(
            &fixture.events,
            "events/subscribe",
            subscribe_params("message.posted", json!({})),
            &no_extensions(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code.0, code);
    }
}

#[tokio::test]
async fn a_mismatched_name_header_is_refused() {
    let fixture = fixture();
    let (parts, ()) = http::Request::builder()
        .header("mcp-name", "message.posted")
        .body(())
        .unwrap()
        .into_parts();
    let mut extensions = rmcp::model::Extensions::new();
    extensions.insert(parts);
    let error = call(
        &fixture.events,
        "events/subscribe",
        subscribe_params(QUERY_EVENT, json!({"query": MENTIONS})),
        &extensions,
    )
    .await
    .unwrap_err();
    assert_eq!(error.code.0, -32020);

    call(
        &fixture.events,
        "events/subscribe",
        subscribe_params("message.posted", json!({})),
        &extensions,
    )
    .await
    .unwrap();

    // A client that sends Mcp-Method follows the HTTP standardization, so it
    // must send Mcp-Name too, once.
    let headers = |names: &[&str]| {
        let mut builder = http::Request::builder().header("mcp-method", "events/subscribe");
        for name in names {
            builder = builder.header("mcp-name", *name);
        }
        let (parts, ()) = builder.body(()).unwrap().into_parts();
        let mut extensions = rmcp::model::Extensions::new();
        extensions.insert(parts);
        extensions
    };
    for names in [&[][..], &["message.posted", "message.mentioned"][..]] {
        let error = call(
            &fixture.events,
            "events/subscribe",
            subscribe_params("message.posted", json!({})),
            &headers(names),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code.0, -32020, "{names:?}");
    }
    call(
        &fixture.events,
        "events/subscribe",
        subscribe_params("message.posted", json!({})),
        &headers(&["message.posted"]),
    )
    .await
    .unwrap();
}

// --- events/unsubscribe ---------------------------------------------------

#[tokio::test]
async fn arguments_that_mean_the_same_name_the_same_subscription() {
    let fixture = fixture();
    call(
        &fixture.events,
        "events/subscribe",
        subscribe_params(QUERY_EVENT, confirmed()),
        &no_extensions(),
    )
    .await
    .unwrap();
    // Spaces around the words and an empty `allOf` spelled out are the same
    // request.
    let mut filter = serde_json::to_value(McpEventFilter::for_events(
        vec!["message.mentioned".to_owned()],
        None,
    ))
    .unwrap();
    filter["anyOf"][0]["allOf"] =
        serde_json::to_value(&channel_mentions().any_of[0].all_of).unwrap();
    let mut spelled = filter.clone();
    spelled["anyOf"][0]["ids"] = Value::Null;
    call(
        &fixture.events,
        "events/unsubscribe",
        json!({
            "name": QUERY_EVENT,
            "arguments": {"query": format!("  {MENTIONS} "), "filter": spelled},
            "delivery": {"url": "https://agent.example/hook"},
        }),
        &no_extensions(),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn a_proposal_too_large_to_confirm_is_refused() {
    let fixture = fixture();
    // A filter within its own limit whose arguments, words included, are not.
    let ids: Vec<String> = (0..16).map(|n| format!("{n:0>220}")).collect();
    let large = McpEventFilter::for_events(vec!["message.posted".to_owned()], Some(ids));
    large.validate().unwrap();
    assert!(serde_json::to_string(&large).unwrap().len() <= MAX_FILTER_BYTES);
    *fixture.compiler.filter.lock().unwrap() = Some(large);
    let query = "a".repeat(MAX_QUERY_CHARS);
    let error = call(
        &fixture.events,
        "events/subscribe",
        subscribe_params(QUERY_EVENT, json!({"query": query})),
        &no_extensions(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.code.0, -32602);
    assert!(error.message.contains("too large to confirm"));
    assert!(error.data.is_none());
}

#[tokio::test]
async fn unsubscribe_removes_by_name_arguments_and_url() {
    let fixture = fixture();
    call(
        &fixture.events,
        "events/subscribe",
        subscribe_params("message.posted", json!({})),
        &no_extensions(),
    )
    .await
    .unwrap();
    let params = json!({
        "name": "message.posted",
        "arguments": {},
        "delivery": {"url": "https://agent.example/hook"},
    });
    let CustomResult(result) = call(
        &fixture.events,
        "events/unsubscribe",
        params.clone(),
        &no_extensions(),
    )
    .await
    .unwrap();
    assert_eq!(result, json!({"resultType": "complete"}));

    let again = call(
        &fixture.events,
        "events/unsubscribe",
        params,
        &no_extensions(),
    )
    .await
    .unwrap_err();
    assert_eq!(again.code.0, -32023);
    assert_eq!(again.data.unwrap()["kind"], "subscription");
}

// --- compiling ------------------------------------------------------------

#[tokio::test]
async fn the_same_words_compile_once_per_user() {
    let fixture = fixture();
    let query = Selection::Query {
        query: MENTIONS.to_owned(),
        filter: None,
    };
    let first = shown(fixture.events.compile(&me(), &query).await);
    let second = shown(fixture.events.compile(&me(), &query).await);
    assert_eq!(first, second);
    assert_eq!(first, Compiled::new(channel_mentions()));
    assert_eq!(fixture.compiler.queries.lock().unwrap().len(), 1);

    let other = MacroUserIdStr::parse_from_str(OTHER).unwrap();
    shown(fixture.events.compile(&other, &query).await);
    assert_eq!(fixture.compiler.queries.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn concurrent_first_requests_share_one_model_call() {
    let fixture = fixture();
    let hold = Arc::new(tokio::sync::Notify::new());
    *fixture.compiler.hold.lock().unwrap() = Some(Arc::clone(&hold));
    let query = Selection::Query {
        query: MENTIONS.to_owned(),
        filter: None,
    };
    // Polled in order: the first waits on the model, the second on the
    // first, then the model answers.
    let user = me();
    let (first, second, ()) = tokio::join!(
        fixture.events.compile(&user, &query),
        fixture.events.compile(&user, &query),
        async { hold.notify_waiters() },
    );
    assert_eq!(shown(first), shown(second));
    assert_eq!(fixture.compiler.queries.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_failed_compile_is_not_cached() {
    let fixture = fixture();
    *fixture.compiler.answer.lock().unwrap() =
        Some(CompileError::Refused("not an event".to_owned()));
    let query = Selection::Query {
        query: MENTIONS.to_owned(),
        filter: None,
    };
    assert!(matches!(
        fixture.events.compile(&me(), &query).await,
        Err(super::EventsError::InvalidParams(_))
    ));
    shown(fixture.events.compile(&me(), &query).await);
    assert_eq!(fixture.compiler.queries.lock().unwrap().len(), 2);
}

#[test]
fn a_refusal_keeps_the_model_words_out_of_its_display() {
    let error = CompileError::Refused("the words of the request".to_owned());
    assert!(!error.to_string().contains("words of the request"));
    let shown = super::EventsError::from(error);
    assert!(shown.to_string().contains("words of the request"));
}

#[test]
fn the_service_is_reached_under_its_gateway_path() {
    let dss = super::dss::DssEvents::new(
        url::Url::parse("https://gateway.example/dss").unwrap(),
        "key".to_owned(),
    )
    .unwrap();
    assert_eq!(
        dss.url(super::dss::SUBSCRIBE_PATH).unwrap().as_str(),
        "https://gateway.example/dss/internal/mcp/event_subscriptions"
    );
    assert_eq!(
        dss.url(super::dss::STREAM_PATH).unwrap().as_str(),
        "https://gateway.example/dss/webhook/events/stream"
    );
    let local = super::dss::DssEvents::new(
        url::Url::parse("http://localhost:8080").unwrap(),
        "key".to_owned(),
    )
    .unwrap();
    assert_eq!(
        local.url(super::dss::STREAM_PATH).unwrap().as_str(),
        "http://localhost:8080/webhook/events/stream"
    );
}

#[test]
fn the_model_answer_is_validated() {
    let filter = parse_outcome(json!({
        "outcome": "filter",
        "filter": serde_json::to_value(channel_mentions()).unwrap(),
    }))
    .unwrap();
    assert_eq!(filter, channel_mentions());

    assert!(matches!(
        parse_outcome(json!({"outcome": "refuse", "reason": "names are not ids"})),
        Err(CompileError::Refused(reason)) if reason == "names are not ids"
    ));
    // A filter delivery cannot evaluate is a refusal, never a subscription.
    assert!(matches!(
        parse_outcome(json!({
            "outcome": "filter",
            "filter": {"anyOf": [{"events": ["message.teleported"]}]},
        })),
        Err(CompileError::Refused(_))
    ));
    assert!(matches!(
        parse_outcome(json!({"outcome": "maybe"})),
        Err(CompileError::Internal(_))
    ));
}

#[test]
fn the_reading_names_every_alternative() {
    let filter = McpEventFilter {
        any_of: vec![
            McpFilterClause {
                events: vec!["message.posted".to_owned(), "message.patched".to_owned()],
                ids: Some(vec![CHANNEL.to_owned(), OTHER_CHANNEL.to_owned()]),
                all_of: vec![McpFieldCondition {
                    field: McpFilterField::Actor,
                    one_of: vec![literal(OTHER), McpFilterValue::Me],
                }],
            },
            McpFilterClause {
                events: vec!["document.created".to_owned()],
                ids: None,
                all_of: vec![],
            },
        ],
    };
    assert_eq!(
        super::describe::describe(&filter),
        format!(
            "Any of: `message.posted` or `message.patched` events for `\"{CHANNEL}\"` or \
             `\"{OTHER_CHANNEL}\"` where whoever acted (sent it, or for an edit, deletion or \
             attachment change, whoever made that change, not necessarily its author) is \
             `\"{OTHER}\"` or you; or `document.created` events."
        )
    );
}

#[test]
fn the_reading_names_the_sender_only_where_the_actor_is_the_sender() {
    let by_me = |events: &[&str]| McpEventFilter {
        any_of: vec![McpFilterClause {
            events: events.iter().map(|event| (*event).to_owned()).collect(),
            ids: None,
            all_of: vec![McpFieldCondition {
                field: McpFilterField::Actor,
                one_of: vec![McpFilterValue::Me],
            }],
        }],
    };
    assert_eq!(
        super::describe::describe(&by_me(&["message.posted", "message.mentioned"])),
        "`message.posted` or `message.mentioned` events where the sender is you."
    );
    // A deletion's actor is whoever deleted the message, not its author.
    assert!(!super::describe::describe(&by_me(&["message.deleted"])).contains("the sender is"));
}

#[test]
fn a_value_reads_exactly_as_one_value() {
    let in_parent = |values: &[&str]| McpEventFilter {
        any_of: vec![McpFilterClause {
            events: vec!["message.posted".to_owned()],
            ids: None,
            all_of: vec![McpFieldCondition {
                field: McpFilterField::ParentType,
                one_of: values.iter().map(|value| literal(value)).collect(),
            }],
        }],
    };
    let two = super::describe::describe(&in_parent(&["channel", "document"]));
    let one = super::describe::describe(&in_parent(&["channel` or `document"]));
    assert_ne!(two, one);
    assert!(two.contains(r#"a `"channel"` or `"document"`."#));
    assert!(one.contains(r#"a `` "channel` or `document" ``."#));
    // Edge spaces and line breaks, which a Markdown code span folds, stay
    // visible.
    let spaced = super::describe::describe(&in_parent(&[" channel "]));
    assert!(spaced.contains(r#"a `" channel "`."#));
    let broken = super::describe::describe(&in_parent(&["chan\nnel"]));
    assert!(broken.contains(r#"a `"chan\nnel"`."#));
    // So do characters that render as nothing.
    let hidden = super::describe::describe(&in_parent(&["chan\u{200B}nel"]));
    assert!(hidden.contains(r#"a `"chan\u200bnel"`."#));
    let shorthand = super::describe::describe(&in_parent(&["chan\u{1BCA0}nel"]));
    assert!(shorthand.contains(r#"a `"chan\ud82f\udca0nel"`."#));
    let tagged = super::describe::describe(&in_parent(&["channel\u{E0041}"]));
    assert!(tagged.contains(r#"a `"channel\udb40\udc41"`."#));
}

// --- the live source ------------------------------------------------------

#[test]
fn source_frames_become_events_or_heartbeats() {
    assert_eq!(
        source_item("heartbeat", "{}".to_owned(), None).unwrap(),
        SourceItem::Heartbeat
    );
    let envelope = mention("channel", CHANNEL, ME);
    assert_eq!(
        source_item("message.mentioned", envelope.to_string(), Some("e1")).unwrap(),
        SourceItem::Event(SourceEvent {
            event_id: "e1".to_owned(),
            name: "message.mentioned".to_owned(),
            envelope,
        })
    );
    assert!(source_item("message.mentioned", "{}".to_owned(), None).is_err());
    assert!(source_item("message.mentioned", "not json".to_owned(), Some("e1")).is_err());
}

// --- events/stream --------------------------------------------------------

/// Run `events/stream` beside `script`, which reads its notifications and
/// cancels it. The handler owns the sending side, so the notifications end
/// when it returns.
async fn stream_with<F>(
    events: &McpEvents,
    params: Value,
    script: impl FnOnce(mpsc::UnboundedReceiver<(&'static str, Value)>, CancellationToken) -> F,
) -> Result<CustomResult, McpError>
where
    F: Future<Output = ()>,
{
    let (sender, receiver) = mpsc::unbounded();
    let sink = Sink(sender);
    let cancel = CancellationToken::new();
    let extensions = no_extensions();
    let handler_cancel = cancel.clone();
    let handler = async move {
        handle(
            events,
            "events/stream",
            Some(params),
            RequestScope {
                user: me(),
                request_id: json!(7),
                extensions: &extensions,
                sink: &sink,
                cancel: handler_cancel,
                span: tracing::Span::none(),
            },
        )
        .await
    };
    let (result, ()) = tokio::join!(handler, script(receiver, cancel));
    result
}

async fn next(
    receiver: &mut mpsc::UnboundedReceiver<(&'static str, Value)>,
) -> (&'static str, Value) {
    receiver.next().await.unwrap()
}

#[tokio::test(start_paused = true)]
async fn a_stream_delivers_only_what_its_filter_matches() {
    let fixture = fixture();
    let source = fixture.source.queue(None);
    let wanted = event("message.mentioned", mention("channel", CHANNEL, ME));
    let wanted_id = wanted.event_id.clone();

    let result = stream_with(
        &fixture.events,
        json!({"name": QUERY_EVENT, "arguments": confirmed(), "heartbeatMs": 10_000}),
        |mut receiver, cancel| async move {
            let (method, active) = next(&mut receiver).await;
            assert_eq!(method, "notifications/events/active");
            assert_eq!(active["heartbeatMs"], 10_000);
            assert_eq!(active["cursor"], Value::Null);
            assert_eq!(active["truncated"], false);
            assert_eq!(active["_meta"][SUBSCRIPTION_ID_META], 7);
            assert_eq!(
                active["_meta"][FILTER_META],
                serde_json::to_value(channel_mentions()).unwrap()
            );
            assert!(active["_meta"][INTERPRETATION_META].is_string());

            // A document mention and a mention of someone else are not sent.
            for envelope in [
                mention("document", CHANNEL, ME),
                mention("channel", CHANNEL, OTHER),
            ] {
                source
                    .unbounded_send(Ok(SourceItem::Event(event("message.mentioned", envelope))))
                    .unwrap();
            }
            source
                .unbounded_send(Ok(SourceItem::Event(wanted.clone())))
                .unwrap();
            let (method, occurrence) = next(&mut receiver).await;
            assert_eq!(method, "notifications/events/event");
            assert_eq!(occurrence["eventId"], wanted_id);
            assert_eq!(occurrence["name"], QUERY_EVENT);
            assert_eq!(occurrence["data"], wanted.envelope);
            assert_eq!(occurrence["cursor"], Value::Null);
            assert_eq!(occurrence["_meta"][SUBSCRIPTION_ID_META], 7);
            let timestamp: chrono::DateTime<chrono::Utc> =
                serde_json::from_value(occurrence["timestamp"].clone()).unwrap();
            let (seconds, _) = uuid::Uuid::parse_str(&wanted_id)
                .unwrap()
                .get_timestamp()
                .unwrap()
                .to_unix();
            assert_eq!(timestamp.timestamp(), i64::try_from(seconds).unwrap());

            cancel.cancel();
        },
    )
    .await;

    let CustomResult(result) = result.unwrap();
    assert_eq!(
        result,
        json!({"resultType": "complete", "_meta": {SUBSCRIPTION_ID_META: 7}})
    );
    let opens = fixture.source.opens.lock().unwrap();
    assert_eq!(
        *opens,
        vec![(
            WebhookFilter {
                events: vec!["message.mentioned".to_owned()],
                ids: None
            },
            None
        )]
    );
}

#[tokio::test(start_paused = true)]
async fn a_quiet_stream_sends_heartbeats() {
    let fixture = fixture();
    let started = tokio::time::Instant::now();
    stream_with(
        &fixture.events,
        // Below the floor: granted the shortest heartbeat.
        json!({"name": "message.posted", "heartbeatMs": 10}),
        |mut receiver, cancel| async move {
            let (_, active) = next(&mut receiver).await;
            assert_eq!(active["heartbeatMs"], 5_000);
            let (method, heartbeat) = next(&mut receiver).await;
            assert_eq!(method, "notifications/events/heartbeat");
            assert_eq!(heartbeat["_meta"][SUBSCRIPTION_ID_META], 7);
            assert_eq!(started.elapsed(), Duration::from_secs(5));
            cancel.cancel();
        },
    )
    .await
    .unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_lost_source_reports_an_error_and_resumes_after_its_last_event() {
    let fixture = fixture();
    let first = fixture.source.queue(None);
    let second = fixture.source.queue(None);
    let resumed_after = Arc::new(Mutex::new(String::new()));
    let posted_id_out = Arc::clone(&resumed_after);

    stream_with(
        &fixture.events,
        json!({"name": "message.posted"}),
        |mut receiver, cancel| async move {
            next(&mut receiver).await;
            // Minted after the stream opened, so only the deduper can drop
            // its repeat.
            let posted = event("message.posted", json!({"metadata": {}}));
            let posted_id = posted.event_id.clone();
            posted_id_out.lock().unwrap().clone_from(&posted_id);
            first
                .unbounded_send(Ok(SourceItem::Event(posted.clone())))
                .unwrap();
            assert_eq!(next(&mut receiver).await.1["eventId"], posted_id);
            first
                .unbounded_send(Err(SourceError(rootcause::report!("reset"))))
                .unwrap();
            let (method, error) = next(&mut receiver).await;
            assert_eq!(method, "notifications/events/error");
            assert_eq!(error["error"]["message"], "UpstreamError");
            // The same event again (a resume overlap) is dropped.
            second
                .unbounded_send(Ok(SourceItem::Event(posted.clone())))
                .unwrap();
            let after = event("message.posted", json!({"metadata": {}}));
            let after_id = after.event_id.clone();
            second.unbounded_send(Ok(SourceItem::Event(after))).unwrap();
            let (method, occurrence) = next(&mut receiver).await;
            assert_eq!(method, "notifications/events/event");
            assert_eq!(occurrence["eventId"], after_id);
            cancel.cancel();
        },
    )
    .await
    .unwrap();

    let opens = fixture.source.opens.lock().unwrap();
    assert_eq!(opens.len(), 2);
    let resumed_after = resumed_after.lock().unwrap();
    assert_eq!(opens[1].1.as_deref(), Some(resumed_after.as_str()));
}

#[tokio::test(start_paused = true)]
async fn a_silent_source_is_replaced_and_resumes_from_when_it_opened() {
    let fixture = fixture();
    // Held open but silent: no event, no heartbeat.
    let _silent = fixture.source.queue(None);
    let opened_at = uuid::Uuid::now_v7();
    let started = tokio::time::Instant::now();
    stream_with(
        &fixture.events,
        json!({"name": "message.posted", "heartbeatMs": 45_000}),
        |mut receiver, cancel| async move {
            loop {
                let (method, _) = next(&mut receiver).await;
                if method == "notifications/events/error" {
                    break;
                }
            }
            assert_eq!(started.elapsed(), Duration::from_secs(60));
            // The group reopens after its first retry wait.
            tokio::time::sleep(Duration::from_secs(1)).await;
            cancel.cancel();
        },
    )
    .await
    .unwrap();

    let opens = fixture.source.opens.lock().unwrap();
    assert_eq!(opens.len(), 2, "the silent source was reopened");
    let cursor = uuid::Uuid::parse_str(opens[1].1.as_deref().unwrap()).unwrap();
    assert_eq!(cursor.get_version_num(), 7);
    assert!(cursor >= opened_at);
    // Minted before the source opened, not after setup finished.
    assert!(cursor < fixture.source.open_times.lock().unwrap()[0]);
}

#[tokio::test(start_paused = true)]
async fn a_resumed_source_drops_what_it_replays_from_before_the_stream_opened() {
    let fixture = fixture();
    let first = fixture.source.queue(None);
    let second = fixture.source.queue(None);
    let before = event("message.posted", json!({"metadata": {}}));
    stream_with(
        &fixture.events,
        json!({"name": "message.posted"}),
        |mut receiver, cancel| async move {
            next(&mut receiver).await;
            first
                .unbounded_send(Err(SourceError(rootcause::report!("reset"))))
                .unwrap();
            assert_eq!(next(&mut receiver).await.0, "notifications/events/error");
            // The resumed source's lookback reaches past the stream's start.
            second
                .unbounded_send(Ok(SourceItem::Event(before)))
                .unwrap();
            let after = event("message.posted", json!({"metadata": {}}));
            let after_id = after.event_id.clone();
            second.unbounded_send(Ok(SourceItem::Event(after))).unwrap();
            let (method, occurrence) = next(&mut receiver).await;
            assert_eq!(method, "notifications/events/event");
            assert_eq!(occurrence["eventId"], after_id);
            cancel.cancel();
        },
    )
    .await
    .unwrap();
}

#[tokio::test(start_paused = true)]
async fn after_its_replay_a_resumed_source_delivers_a_live_event_minted_before_the_stream() {
    let fixture = fixture();
    let first = fixture.source.queue(None);
    let second = fixture.source.queue(None);
    // A producer whose clock is behind ours: its live event's id sorts
    // before the stream opened.
    let skewed = event("message.posted", json!({"metadata": {}}));
    let skewed_id = skewed.event_id.clone();
    stream_with(
        &fixture.events,
        json!({"name": "message.posted"}),
        |mut receiver, cancel| async move {
            next(&mut receiver).await;
            first
                .unbounded_send(Err(SourceError(rootcause::report!("reset"))))
                .unwrap();
            assert_eq!(next(&mut receiver).await.0, "notifications/events/error");
            // The heartbeat ends the replay.
            second.unbounded_send(Ok(SourceItem::Heartbeat)).unwrap();
            second
                .unbounded_send(Ok(SourceItem::Event(skewed)))
                .unwrap();
            let (method, occurrence) = next(&mut receiver).await;
            assert_eq!(method, "notifications/events/event");
            assert_eq!(occurrence["eventId"], skewed_id);
            cancel.cancel();
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn a_client_that_leaves_during_setup_frees_its_slot() {
    let fixture = fixture();
    // The model never answers.
    *fixture.compiler.hold.lock().unwrap() = Some(Arc::new(tokio::sync::Notify::new()));
    let result = stream_with(
        &fixture.events,
        json!({"name": QUERY_EVENT, "arguments": {"query": MENTIONS}}),
        |_, cancel| async move { cancel.cancel() },
    )
    .await;
    assert_eq!(result.unwrap_err().message, "request cancelled");
    assert!(fixture.source.opens.lock().unwrap().is_empty());
    let slots: Vec<_> = (0..MAX_STREAMS_PER_USER)
        .map(|_| fixture.events.claim_stream(&me()))
        .collect();
    assert!(slots.iter().all(Result::is_ok));
}

#[tokio::test]
async fn each_distinct_ids_gets_its_own_source() {
    let fixture = fixture();
    let both = McpEventFilter {
        any_of: vec![
            McpFilterClause {
                events: vec!["message.posted".to_owned()],
                ids: Some(vec![CHANNEL.to_owned()]),
                all_of: vec![],
            },
            McpFilterClause {
                events: vec!["message.posted".to_owned()],
                ids: Some(vec![OTHER_CHANNEL.to_owned()]),
                all_of: vec![],
            },
        ],
    };
    let sources = super::stream::open_sources(
        &(fixture.source.clone() as Arc<dyn EventSource>),
        &me(),
        &both,
    )
    .await
    .unwrap();
    assert_eq!(sources.len(), 2);
    let opened: Vec<_> = fixture
        .source
        .opens
        .lock()
        .unwrap()
        .iter()
        .map(|(filter, _)| filter.ids.clone())
        .collect();
    assert_eq!(
        opened,
        vec![
            Some(vec![CHANNEL.to_owned()]),
            Some(vec![OTHER_CHANNEL.to_owned()])
        ]
    );
}

#[tokio::test]
async fn a_stream_that_cannot_open_its_source_fails_before_any_notification() {
    let fixture = fixture();
    *fixture.source.fail_open.lock().unwrap() = true;
    let result = stream_with(
        &fixture.events,
        json!({"name": "message.posted"}),
        |mut receiver, _| async move {
            assert!(receiver.next().await.is_none(), "nothing was sent");
        },
    )
    .await;
    assert_eq!(result.unwrap_err().code.0, -32603);
}

#[tokio::test]
async fn a_stream_of_words_alone_shows_its_filter_and_opens_nothing() {
    let fixture = fixture();
    let result = stream_with(
        &fixture.events,
        json!({"name": QUERY_EVENT, "arguments": {"query": MENTIONS}}),
        |mut receiver, _| async move {
            assert!(receiver.next().await.is_none(), "nothing was sent");
        },
    )
    .await;
    let error = result.unwrap_err();
    assert_eq!(error.code.0, -32602);
    assert_eq!(error.data.unwrap()["arguments"], confirmed());
    assert!(fixture.source.opens.lock().unwrap().is_empty());
    let slots: Vec<_> = (0..MAX_STREAMS_PER_USER)
        .map(|_| fixture.events.claim_stream(&me()))
        .collect();
    assert!(slots.iter().all(Result::is_ok));
}

#[tokio::test]
async fn words_alone_get_their_proposal_even_with_every_stream_slot_held() {
    let fixture = fixture();
    let _held: Vec<_> = (0..MAX_STREAMS_PER_USER)
        .map(|_| fixture.events.claim_stream(&me()).unwrap())
        .collect();
    let result = stream_with(
        &fixture.events,
        json!({"name": QUERY_EVENT, "arguments": {"query": MENTIONS}}),
        |_, _| async {},
    )
    .await;
    let error = result.unwrap_err();
    assert_eq!(error.code.0, -32602);
    assert_eq!(error.data.unwrap()["arguments"], confirmed());
}

#[tokio::test]
async fn streams_per_user_are_capped_and_released() {
    let fixture = fixture();
    let slots: Vec<_> = (0..MAX_STREAMS_PER_USER)
        .map(|_| fixture.events.claim_stream(&me()).unwrap())
        .collect();
    let refused = call(
        &fixture.events,
        "events/stream",
        json!({"name": "message.posted"}),
        &no_extensions(),
    )
    .await
    .unwrap_err();
    assert_eq!(refused.code.0, -32025);
    assert_eq!(refused.data.unwrap()["limit"], "streams");

    let other = MacroUserIdStr::parse_from_str(OTHER).unwrap();
    assert!(fixture.events.claim_stream(&other).is_ok());
    drop(slots);
    assert!(fixture.events.claim_stream(&me()).is_ok());
}

#[tokio::test(start_paused = true)]
async fn a_client_that_leaves_ends_the_stream() {
    let fixture = fixture();
    let result = stream_with(
        &fixture.events,
        json!({"name": "message.posted"}),
        |receiver, _| async move { drop(receiver) },
    )
    .await;
    assert!(result.is_ok());
    // Its slot is free again.
    let slots: Vec<_> = (0..MAX_STREAMS_PER_USER)
        .map(|_| fixture.events.claim_stream(&me()))
        .collect();
    assert!(slots.iter().all(Result::is_ok));
}

/// Events over fakes, for the tool service's wire tests.
pub(crate) fn fake_events() -> Arc<McpEvents> {
    Arc::new(fixture().events)
}

// --- structured arguments --------------------------------------------------

#[test]
fn a_named_type_narrows_by_the_fields_it_carries() {
    let selected = selection(
        "message.mentioned",
        &json!({"parent_type": "channel", "mentioned_id": "me", "actor": OTHER}),
    )
    .unwrap();
    let Selection::Event { conditions, .. } = &selected else {
        panic!("a named type");
    };
    let mut conditions = conditions.clone();
    conditions.sort_by_key(|condition| condition.field.to_string());
    assert_eq!(
        conditions,
        vec![
            McpFieldCondition {
                field: McpFilterField::Actor,
                one_of: vec![literal(OTHER)],
            },
            McpFieldCondition {
                field: McpFilterField::MentionedId,
                one_of: vec![McpFilterValue::Me],
            },
            McpFieldCondition {
                field: McpFilterField::ParentType,
                one_of: vec![literal("channel")],
            },
        ]
    );
    // Written back as given, so the same arguments name the same subscription.
    assert_eq!(
        selected.arguments(),
        json!({"parent_type": "channel", "mentioned_id": "me", "actor": OTHER})
    );

    // Only fields the event carries, as text.
    assert!(selection("message.posted", &json!({"mentioned_id": "me"})).is_err());
    assert!(selection("document.created", &json!({"parent_type": "channel"})).is_err());
    assert!(selection("message.posted", &json!({"parent_id": CHANNEL})).is_err());
    assert!(selection("message.posted", &json!({"actor": 1})).is_err());
    assert!(selection("message.posted", &json!({"actor": ""})).is_err());
    assert!(selection("message.posted", &json!([])).is_err());
}

#[tokio::test]
async fn structured_arguments_subscribe_to_the_filter_they_spell() {
    let fixture = fixture();
    call(
        &fixture.events,
        "events/subscribe",
        subscribe_params(
            "message.mentioned",
            json!({"parent_type": "channel", "mentioned_id": "me"}),
        ),
        &no_extensions(),
    )
    .await
    .unwrap();
    let subscribes = fixture.store.subscribes.lock().unwrap();
    assert_eq!(subscribes[0].filter, channel_mentions());
    assert!(fixture.compiler.queries.lock().unwrap().is_empty());
}

#[tokio::test]
async fn every_named_type_lists_the_fields_it_can_narrow_by() {
    let types = &*EVENT_TYPES;
    let properties = |name: &str| -> Vec<String> {
        let entry = types.iter().find(|entry| entry["name"] == name).unwrap();
        let mut keys: Vec<String> = entry["inputSchema"]["properties"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        keys.sort();
        keys
    };
    assert_eq!(
        properties("message.mentioned"),
        [
            "actor",
            "ids",
            "mentioned_id",
            "mentioned_type",
            "parent_type"
        ]
    );
    assert_eq!(
        properties("message.posted"),
        ["actor", "ids", "parent_type"]
    );
    assert_eq!(properties("document.created"), ["ids"]);
}

// --- ChatGPT ---------------------------------------------------------------

/// The extensions of a request the ChatGPT MCP Worker forwards.
fn chatgpt() -> rmcp::model::Extensions {
    let (parts, ()) = http::Request::builder()
        .header(PROFILE_HEADER, "chatgpt")
        .body(())
        .unwrap()
        .into_parts();
    let mut extensions = rmcp::model::Extensions::new();
    extensions.insert(parts);
    extensions
}

#[tokio::test]
async fn chatgpt_lists_every_named_type_for_webhooks_only() {
    let fixture = fixture();
    let CustomResult(listed) = call(&fixture.events, "events/list", json!({}), &chatgpt())
        .await
        .unwrap();
    // ChatGPT's documented shape: the entries alone, and the profile it was
    // answered under, which the Worker checks and removes.
    assert_eq!(listed.as_object().unwrap().len(), 2);
    assert_eq!(listed["_meta"], json!({ PROFILE_META: "chatgpt" }));
    let types = listed["events"].as_array().unwrap();
    assert_eq!(types, &*CHATGPT_EVENT_TYPES);
    assert_eq!(types.len(), WEBHOOK_EVENT_NAMES.len());
    for entry in types {
        assert_ne!(entry["name"], QUERY_EVENT);
        assert_eq!(entry["delivery"], json!(["webhook"]));
        assert_eq!(entry["inputSchema"]["type"], "object");
        assert_eq!(entry["inputSchema"]["additionalProperties"], false);
        assert!(
            entry["payloadSchema"]["properties"]["metadata"]["description"]
                .as_str()
                .unwrap()
                .contains("someone")
        );
    }
}

#[tokio::test]
async fn chatgpt_subscribes_with_its_profile_and_gets_the_documented_result() {
    let fixture = fixture();
    let mut params = subscribe_params("message.mentioned", json!({"mentioned_id": "me"}));
    params["cursor"] = Value::Null;
    let CustomResult(result) = call(&fixture.events, "events/subscribe", params, &chatgpt())
        .await
        .unwrap();
    assert_eq!(
        result,
        json!({
            "id": "sub_1",
            "refreshBefore": "2027-01-15T08:00:00Z",
            "cursor": null,
            "truncated": false,
            "_meta": { PROFILE_META: "chatgpt" },
        })
    );
    let subscribes = fixture.store.subscribes.lock().unwrap();
    assert_eq!(subscribes[0].profile, McpDeliveryProfile::Chatgpt);
}

#[tokio::test]
async fn a_chatgpt_subscription_stored_without_its_profile_is_refused() {
    // Document storage from before profiles stores what MCP's would.
    let fixture = fixture();
    *fixture.store.stored_profile.lock().unwrap() = Some(McpDeliveryProfile::Mcp);
    let error = call(
        &fixture.events,
        "events/subscribe",
        subscribe_params("message.mentioned", json!({"mentioned_id": "me"})),
        &chatgpt(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, rmcp::model::ErrorCode::INTERNAL_ERROR);
}

#[tokio::test]
async fn other_clients_subscribe_with_the_mcp_profile() {
    let fixture = fixture();
    call(
        &fixture.events,
        "events/subscribe",
        subscribe_params("message.posted", json!({})),
        &no_extensions(),
    )
    .await
    .unwrap();
    assert_eq!(
        fixture.store.subscribes.lock().unwrap()[0].profile,
        McpDeliveryProfile::Mcp
    );
}

#[tokio::test]
async fn chatgpt_unsubscribes_idempotently() {
    let fixture = fixture();
    let params = json!({
        "name": "message.posted",
        "arguments": {},
        "delivery": {"mode": "webhook", "url": "https://agent.example/hook"},
    });
    for _ in 0..2 {
        let CustomResult(result) = call(
            &fixture.events,
            "events/unsubscribe",
            params.clone(),
            &chatgpt(),
        )
        .await
        .unwrap();
        assert_eq!(result, json!({ "_meta": { PROFILE_META: "chatgpt" } }));
    }
}

#[tokio::test]
async fn chatgpt_gets_the_error_codes_of_the_draft_it_follows() {
    let fixture = fixture();
    let unknown = call(
        &fixture.events,
        "events/subscribe",
        subscribe_params("message.teleported", json!({})),
        &chatgpt(),
    )
    .await
    .unwrap_err();
    assert_eq!(unknown.code.0, -32011);
    // Words are not offered to ChatGPT.
    let words = call(
        &fixture.events,
        "events/subscribe",
        subscribe_params(QUERY_EVENT, json!({"query": MENTIONS})),
        &chatgpt(),
    )
    .await
    .unwrap_err();
    assert_eq!(words.code.0, -32011);
    assert!(fixture.compiler.queries.lock().unwrap().is_empty());

    *fixture.store.refuse.lock().unwrap() = Some(McpSubscriptionErrorBody::CallbackEndpointError {
        reason: McpEndpointFailure::ChallengeFailed,
    });
    let callback = call(
        &fixture.events,
        "events/subscribe",
        subscribe_params("message.posted", json!({})),
        &chatgpt(),
    )
    .await
    .unwrap_err();
    assert_eq!(callback.code.0, -32015);
    assert_eq!(callback.data.unwrap()["reason"], "challenge_failed");

    let stream = call(
        &fixture.events,
        "events/stream",
        json!({"name": "message.posted"}),
        &chatgpt(),
    )
    .await
    .unwrap_err();
    assert_eq!(stream.code.0, -32014);
}

#[tokio::test]
async fn an_unknown_profile_is_refused() {
    let fixture = fixture();
    let (parts, ()) = http::Request::builder()
        .header(PROFILE_HEADER, "claude")
        .body(())
        .unwrap()
        .into_parts();
    let mut extensions = rmcp::model::Extensions::new();
    extensions.insert(parts);
    let error = call(&fixture.events, "events/list", json!({}), &extensions)
        .await
        .unwrap_err();
    assert_eq!(error.code, rmcp::model::ErrorCode::INVALID_REQUEST);
}
