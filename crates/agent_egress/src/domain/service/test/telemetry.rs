//! Each exchange with a connected app's server is one outbound span with what
//! a reader needs to explain a slow or failed call, and nothing of its content.

use super::*;
use crate::domain::ports::ActorMcpTransport;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fmt::Debug;
use tracing::Subscriber;
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing_subscriber::layer::{Context as LayerContext, Layer, SubscriberExt as _};
use tracing_subscriber::registry::LookupSpan;

/// Answers a call with `answer`, or fails the exchange when it is `None`.
struct AnsweringTransport(Option<Value>);

#[async_trait::async_trait]
impl ActorMcpTransport for AnsweringTransport {
    async fn exchange(
        &self,
        _: AgentSessionId,
        _: MacroUserIdStr<'static>,
        _: UpstreamCall,
        _: Value,
    ) -> Result<Value, EgressError> {
        self.0
            .clone()
            .ok_or_else(|| EgressError::Upstream(rootcause::report!("HTTP 429 Too Many Requests")))
    }
}

type Fields = BTreeMap<String, String>;

/// The fields of every closed span with `name`, as text.
#[derive(Clone)]
struct ClosedSpans {
    name: &'static str,
    closed: Arc<Mutex<Vec<Fields>>>,
}

struct FieldText<'a>(&'a mut Fields);

impl Visit for FieldText<'_> {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.0.insert(field.name().to_owned(), value.to_owned());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn Debug) {
        self.0.insert(field.name().to_owned(), format!("{value:?}"));
    }
}

impl<S: Subscriber + for<'a> LookupSpan<'a>> Layer<S> for ClosedSpans {
    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: LayerContext<'_, S>) {
        let mut fields = Fields::new();
        attrs.record(&mut FieldText(&mut fields));
        ctx.span(id).unwrap().extensions_mut().insert(fields);
    }

    fn on_record(&self, id: &Id, values: &Record<'_>, ctx: LayerContext<'_, S>) {
        let span = ctx.span(id).unwrap();
        let mut extensions = span.extensions_mut();
        values.record(&mut FieldText(extensions.get_mut::<Fields>().unwrap()));
    }

    fn on_close(&self, id: Id, ctx: LayerContext<'_, S>) {
        let span = ctx.span(&id).unwrap();
        if span.name() == self.name {
            let fields = span.extensions().get::<Fields>().unwrap().clone();
            self.closed.lock().unwrap().push(fields);
        }
    }
}

async fn exchange(answer: Option<Value>, destination: McpDestination) -> Fields {
    let closed = ClosedSpans {
        name: "connected_app.mcp_exchange",
        closed: Arc::default(),
    };
    let _guard =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(closed.clone()));
    let service = gated(prompted_by(Some(owner())), SpyCredentials::knowing())
        .with_actor_mcp(Arc::new(AnsweringTransport(answer)));
    let grant = service.session_grant(AgentSessionId::new()).await.unwrap();
    let _ = service
        .exchange_as(
            &grant,
            &owner(),
            &destination,
            json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{"q":"secret words"}}}),
        )
        .await;
    let mut closed = closed.closed.lock().unwrap().clone();
    assert_eq!(closed.len(), 1, "one span per exchange: {closed:?}");
    closed.remove(0)
}

#[tokio::test]
async fn an_exchange_records_where_it_went_how_big_and_how_it_ended() {
    let linear = McpDestination::Connected(McpServerSlug::parse("linear").unwrap());
    let ok = exchange(
        Some(json!({"content":[{"type":"text","text":"ok"}]})),
        linear.clone(),
    )
    .await;
    assert_eq!(ok["otel.kind"], "client");
    assert_eq!(ok["server.address"], "mcp.example.com");
    assert_eq!(ok["app.kind"], "connected");
    assert_eq!(ok["app.key"], "linear");
    assert_eq!(ok["mcp.method"], "tools/call");
    assert_eq!(ok["mcp.outcome"], "ok");
    assert_ne!(ok["mcp.request_bytes"], "0");
    assert_ne!(ok["mcp.response_bytes"], "0");
    assert!(
        ok.values().all(|value| !value.contains("secret words")),
        "no arguments on the span: {ok:?}"
    );

    let refused = exchange(
        Some(json!({"content":[{"type":"text","text":"no"}],"isError":true})),
        linear.clone(),
    )
    .await;
    assert_eq!(refused["mcp.outcome"], "tool_error");

    let failed = exchange(None, linear).await;
    assert_eq!(failed["mcp.outcome"], "upstream_error");
    assert_eq!(failed["otel.status_code"], "ERROR");

    let key = CustomMcpServerKey::parse("c491e4f2db62532ac6bc94f43fb214cf").unwrap();
    let custom = exchange(Some(json!({"content":[]})), McpDestination::Custom(key)).await;
    assert_eq!(custom["app.kind"], "custom");
    assert_eq!(custom["app.key"], "c491e4f2db62532ac6bc94f43fb214cf");
}
