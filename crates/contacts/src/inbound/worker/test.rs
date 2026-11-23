use super::*;
use crate::domain::models::invalidation::ContactsInvalidation;
use crate::domain::models::list::InboxSource;
use aws_sdk_sqs::config::{BehaviorVersion, Credentials, Region, retry::RetryConfig};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use wiremock::matchers::{body_json, header, method};
use wiremock::{Mock, MockServer, ResponseTemplate};

const RECEIPT_HANDLE: &str = "receipt-0";

#[derive(Default)]
struct CountingRepository {
    writes: AtomicUsize,
}

impl ContactsRepository for CountingRepository {
    async fn get_contacts(
        &self,
        _user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        Ok(Vec::new())
    }

    async fn create_connections(
        &self,
        _connections: Vec<(MacroUserIdStr<'_>, MacroUserIdStr<'_>)>,
    ) -> Result<(), rootcause::Report> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

impl ContactListRepository for CountingRepository {
    async fn record_interactions(
        &self,
        _users: &[MacroUserIdStr<'static>],
        _peers: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)>, rootcause::Report> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        Ok(Vec::new())
    }

    async fn record_inbox_contacts(
        &self,
        _inbox: &InboxSource,
        _contacts: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        Ok(Vec::new())
    }

    async fn record_invite(
        &self,
        _owner: &MacroUserIdStr<'static>,
        _contact: &MacroUserIdStr<'static>,
    ) -> Result<bool, rootcause::Report> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        Ok(false)
    }

    async fn missing_profiles(
        &self,
        _ids: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        Ok(Vec::new())
    }

    async fn delete_user_lists(
        &self,
        _user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        Ok(Vec::new())
    }
}

struct NoopNotifier;

impl ContactsNotifier for NoopNotifier {
    async fn invalidate_contacts_for_users(
        &self,
        _invalidations: Vec<ContactsInvalidation>,
    ) -> Result<(), rootcause::Report> {
        Ok(())
    }
}

fn worker(server: &MockServer) -> ContactsWorker<CountingRepository, NoopNotifier> {
    let config = aws_sdk_sqs::Config::builder()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("us-east-1"))
        .credentials_provider(Credentials::new("test", "test", None, None, "test"))
        .endpoint_url(server.uri())
        .retry_config(RetryConfig::disabled())
        .build();
    let sqs = SQSWorker::new(aws_sdk_sqs::Client::from_conf(config), server.uri(), 10, 0);
    let service = ContactsDomainService {
        repository: CountingRepository::default(),
        notifier: NoopNotifier,
    };
    ContactsWorker::new(sqs, Arc::new(service))
}

async fn expect_delete(server: &MockServer) {
    Mock::given(method("POST"))
        .and(header("x-amz-target", "AmazonSQS.DeleteMessage"))
        .and(body_json(serde_json::json!({
            "QueueUrl": server.uri(),
            "ReceiptHandle": RECEIPT_HANDLE,
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .expect(1)
        .mount(server)
        .await;
}

fn sqs_message(body: Option<&str>) -> aws_sdk_sqs::types::Message {
    aws_sdk_sqs::types::Message::builder()
        .message_id("message-0")
        .receipt_handle(RECEIPT_HANDLE)
        .set_body(body.map(str::to_string))
        .build()
}

#[tokio::test]
async fn unparseable_messages_are_left_for_the_dlq() {
    for body in [None, Some("not json"), Some(r#"{"unknown":"shape"}"#)] {
        let server = MockServer::start().await;
        let worker = worker(&server);

        let result = worker.process_message(&sqs_message(body)).await;

        assert!(result.is_err(), "{body:?} must not be acknowledged");
        assert_eq!(worker.service.repository.writes.load(Ordering::SeqCst), 0);
        let requests = server.received_requests().await.unwrap();
        assert!(requests.is_empty(), "{body:?} must not reach SQS");
    }
}

#[tokio::test]
async fn processed_messages_are_deleted() {
    let server = MockServer::start().await;
    expect_delete(&server).await;
    let worker = worker(&server);
    let body = include_str!("../../../tests/fixtures/add_connection.json");

    worker
        .process_message(&sqs_message(Some(body)))
        .await
        .unwrap();

    assert_eq!(worker.service.repository.writes.load(Ordering::SeqCst), 1);
    server.verify().await;
}

/// A message sent from a traced request, carrying its context as SQS does.
#[cfg(feature = "outbound")]
fn traced_sqs_message(body: &str) -> aws_sdk_sqs::types::Message {
    let attribute = crate::trace_context::attribute().expect("the sender has a trace");
    aws_sdk_sqs::types::Message::builder()
        .message_id("message-0")
        .receipt_handle(RECEIPT_HANDLE)
        .body(body)
        .message_attributes(crate::trace_context::ATTRIBUTE, attribute)
        .build()
}

#[cfg(feature = "outbound")]
#[tokio::test]
async fn each_message_is_a_finished_round_in_the_senders_trace_without_emails() {
    use opentelemetry::Value;
    use opentelemetry::trace::TraceContextExt as _;
    use tracing_opentelemetry::OpenTelemetrySpanExt as _;

    let capture = crate::trace_context::capture::Capture::start();
    let server = MockServer::start().await;
    expect_delete(&server).await;
    let worker = worker(&server);
    let body = include_str!("../../../tests/fixtures/add_connection.json");
    assert!(
        body.contains("@test.com"),
        "the fixture must name users by email"
    );

    let send = tracing::info_span!(parent: None, "contacts.send");
    let sent_from = send.context().span().span_context().clone();
    let message = send.in_scope(|| traced_sqs_message(body));
    drop(send);
    worker.process_message(&message).await.unwrap();

    let spans = capture.finished();
    let rounds: Vec<_> = spans
        .iter()
        .filter(|span| span.name == "contacts.worker.process_message")
        .collect();
    assert_eq!(
        rounds.len(),
        1,
        "the round's span must close: {:?}",
        spans.iter().map(|span| &span.name).collect::<Vec<_>>()
    );
    let round = rounds[0];
    assert_eq!(round.span_context.trace_id(), sent_from.trace_id());
    assert_eq!(round.parent_span_id, sent_from.span_id());

    let domain = spans
        .iter()
        .find(|span| span.name == "contacts.process_message")
        .expect("the domain service opens its own span");
    assert_eq!(domain.span_context.trace_id(), sent_from.trace_id());
    let field = |name: &str| {
        domain
            .attributes
            .iter()
            .find(|attribute| attribute.key.as_str() == name)
            .map(|attribute| attribute.value.clone())
    };
    assert_eq!(field("kind"), Some(Value::from("nodes")));
    assert_eq!(field("users"), Some(Value::I64(3)));
    assert_eq!(field("connections"), Some(Value::I64(3)));

    capture.assert_no_email("test.com");
    server.verify().await;
}
