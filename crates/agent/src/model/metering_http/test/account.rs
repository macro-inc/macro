use super::*;
use tracing_subscriber::layer::SubscriberExt as _;

/// A provider that refuses every request the way Fireworks does for a
/// suspended account.
#[derive(Clone, Debug, Default)]
struct SuspendedProvider;

fn suspended() -> http_client::Error {
    http_client::Error::InvalidStatusCodeWithMessage(
        reqwest::StatusCode::PRECONDITION_FAILED,
        r#"{"error":{"object":"error","type":"invalid_request_error","message":"Account acct-example1 is suspended, possibly due to reaching the monthly spending limit or failure to pay past invoices."}}"#.to_owned(),
    )
}

impl HttpClientExt for SuspendedProvider {
    fn send<T, U>(
        &self,
        _: Request<T>,
    ) -> impl Future<Output = http_client::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        T: Into<Bytes> + Send,
        U: From<Bytes> + Send + 'static,
    {
        std::future::ready(Err(suspended()))
    }

    fn send_multipart<U>(
        &self,
        _: Request<MultipartForm>,
    ) -> impl Future<Output = http_client::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        U: From<Bytes> + Send + 'static,
    {
        std::future::ready(Err(suspended()))
    }

    async fn send_streaming<T>(&self, _: Request<T>) -> http_client::Result<StreamingResponse>
    where
        T: Into<Bytes> + Send,
    {
        Err(suspended())
    }
}

/// Every event's message and fields, as `name=value` pairs.
#[derive(Clone, Default)]
struct Events(Arc<Mutex<Vec<String>>>);

struct Fields(String);

impl tracing::field::Visit for Fields {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        self.0.push_str(&format!(" {}={value:?}", field.name()));
    }
}

impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for Events {
    fn on_event(&self, event: &tracing::Event<'_>, _: tracing_subscriber::layer::Context<'_, S>) {
        let mut fields = Fields(event.metadata().level().to_string());
        event.record(&mut fields);
        self.0.lock().unwrap().push(fields.0);
    }
}

#[tokio::test]
async fn suspended_macro_account_is_logged_on_every_send() {
    let events = Events::default();
    let _guard =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(events.clone()));
    let client = MeteredHttpClient::new(
        SuspendedProvider,
        "fireworks",
        WireProtocol::ChatCompletions,
    );

    let sent = client.send::<_, Bytes>(request()).await;
    let streamed = client.send_streaming(request()).await;

    assert!(sent.is_err());
    assert!(streamed.is_err());
    assert_eq!(
        *events.0.lock().unwrap(),
        [
            r#"ERROR message=ai provider account unavailable provider="fireworks" http_status=412 reason="suspended""#,
            r#"ERROR message=ai provider account unavailable provider="fireworks" http_status=412 reason="suspended""#,
        ]
    );
}

#[tokio::test]
async fn suspended_agent_key_is_not_logged() {
    let events = Events::default();
    let _guard =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(events.clone()));
    let client = MeteredHttpClient::new(SuspendedProvider, "openai", WireProtocol::Responses)
        .with_agent_api_key();

    let sent = client.send::<_, Bytes>(request()).await;

    assert!(sent.is_err());
    assert!(events.0.lock().unwrap().is_empty());
}
