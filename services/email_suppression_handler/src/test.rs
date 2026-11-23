use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use sqlx::PgPool;

async fn transient_bounce(db: PgPool, subtype: &str) {
    let notification = json!({"notificationType":"Bounce","bounce":{
        "bounceType":"Transient","bounceSubType":subtype,"bouncedRecipients":[],
        "timestamp":"2025-01-01T00:00:00Z","feedbackId":"local-feedback"
    }});
    let event=serde_json::from_value(json!({"Records":[{
        "EventSource":"aws:sns","EventVersion":"1.0","EventSubscriptionArn":"local-subscription",
        "Sns":{"Type":"Notification","MessageId":"local-message","TopicArn":"arn:aws:sns:us-east-1:000000000000:local",
            "Message":notification.to_string(),"Timestamp":"2025-01-01T00:00:00Z","SignatureVersion":"1",
            "Signature":"local-signature","SigningCertUrl":"https://example.com/cert","UnsubscribeUrl":"https://example.com/unsubscribe","MessageAttributes":{}}
    }]})).unwrap();
    crate::handler::handler(
        crate::composition::service(db),
        lambda_runtime::LambdaEvent::new(event, lambda_runtime::Context::default()),
    )
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[should_panic(expected = "internal error: entered unreachable code")]
async fn transient_undetermined_panics(db: PgPool) {
    transient_bounce(db, "Undetermined").await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[should_panic(expected = "internal error: entered unreachable code")]
async fn transient_no_email_panics(db: PgPool) {
    transient_bounce(db, "NoEmail").await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[should_panic(expected = "internal error: entered unreachable code")]
async fn transient_suppressed_panics(db: PgPool) {
    transient_bounce(db, "Suppressed").await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[should_panic(expected = "internal error: entered unreachable code")]
async fn transient_account_suppressed_panics(db: PgPool) {
    transient_bounce(db, "OnAccountSuppressionList").await;
}

type CapturedTrace = (Vec<(String, String)>, Vec<String>);
#[derive(Clone)]
struct RawMessageCapture(std::sync::Arc<std::sync::Mutex<Vec<CapturedTrace>>>);
#[derive(Default)]
struct TraceFields(Vec<(String, String)>);
impl tracing::field::Visit for TraceFields {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        self.0.push((field.name().into(), format!("{value:?}")));
    }
}
impl<S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>>
    tracing_subscriber::Layer<S> for RawMessageCapture
{
    fn on_event(&self, event: &tracing::Event<'_>, ctx: tracing_subscriber::layer::Context<'_, S>) {
        if *event.metadata().level() != tracing::Level::TRACE {
            return;
        }
        let mut fields = TraceFields::default();
        event.record(&mut fields);
        let ancestry = ctx
            .event_scope(event)
            .unwrap()
            .from_root()
            .map(|span| span.name().to_owned())
            .collect();
        self.0.lock().unwrap().push((fields.0, ancestry));
    }
}

#[tokio::test]
async fn each_record_traces_the_exact_raw_message_under_handler() {
    use tracing::instrument::WithSubscriber;
    use tracing_subscriber::layer::SubscriberExt;
    let observed = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let subscriber = tracing_subscriber::registry().with(RawMessageCapture(observed.clone()));
    let raw = "invalid synthetic payload";
    let event=serde_json::from_value(json!({"Records":[{
        "EventSource":"aws:sns","EventVersion":"1.0","EventSubscriptionArn":"local-subscription",
        "Sns":{"Type":"Notification","MessageId":"local-message","TopicArn":"arn:aws:sns:us-east-1:000000000000:local",
            "Message":raw,"Timestamp":"2025-01-01T00:00:00Z","SignatureVersion":"1",
            "Signature":"local-signature","SigningCertUrl":"https://example.com/cert","UnsubscribeUrl":"https://example.com/unsubscribe","MessageAttributes":{}}
    }]})).unwrap();
    let db = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://postgres@127.0.0.1/unused")
        .unwrap();
    crate::handler::handler(
        crate::composition::service(db),
        lambda_runtime::LambdaEvent::new(event, lambda_runtime::Context::default()),
    )
    .with_subscriber(subscriber)
    .await
    .unwrap();
    assert_eq!(
        *observed.lock().unwrap(),
        vec![(
            vec![
                ("message".into(), "processing message".into()),
                ("message".into(), format!("{raw:?}"))
            ],
            vec!["handler".into()]
        )]
    );
}
