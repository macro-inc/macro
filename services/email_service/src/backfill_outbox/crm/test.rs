use super::drain;
use axum::{Json, Router, extract::State, http::StatusCode};
use crm::domain::email_privacy::{EmailPrivacyChange, EmailPrivacyRepository};
use crm::outbound::companies_repo::CompaniesRepositoryImpl;
use email_types::email::service::backfill::{BackfillOperation, BackfillPubsubMessage};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::{Value, json};
use sqlx::PgPool;
use sqs_client::SQS;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;
use tokio::{net::TcpListener, task::JoinHandle};
use uuid::Uuid;

const USER: &str = "macro|outbox@example.com";

#[derive(Default)]
struct QueueState {
    requests: Mutex<Vec<Value>>,
    fail: AtomicBool,
}

struct TestQueue {
    sqs: SQS,
    state: Arc<QueueState>,
    server: JoinHandle<()>,
}

impl TestQueue {
    async fn start() -> anyhow::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let endpoint = format!("http://{}", listener.local_addr()?);
        let state = Arc::new(QueueState::default());
        let app = Router::new()
            .fallback(send_message)
            .with_state(state.clone());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let config = macro_aws_config::local_aws_config(&endpoint).await;
        let config = aws_sdk_sqs::config::Builder::from(&config)
            .retry_config(aws_sdk_sqs::config::retry::RetryConfig::disabled())
            .build();
        let sqs = SQS::new(aws_sdk_sqs::Client::from_conf(config))
            .email_backfill_queue(&format!("{endpoint}/queue"));
        Ok(Self { sqs, state, server })
    }

    fn messages(&self) -> Vec<BackfillPubsubMessage> {
        self.state
            .requests
            .lock()
            .unwrap()
            .iter()
            .map(|body| serde_json::from_str(body["MessageBody"].as_str().unwrap()).unwrap())
            .collect()
    }
}

impl Drop for TestQueue {
    fn drop(&mut self) {
        self.server.abort();
    }
}

async fn send_message(
    State(state): State<Arc<QueueState>>,
    body: bytes::Bytes,
) -> (StatusCode, Json<Value>) {
    state
        .requests
        .lock()
        .unwrap()
        .push(serde_json::from_slice(&body).unwrap());
    if state.fail.load(Ordering::SeqCst) {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"__type": "InternalError", "message": "queue unavailable"})),
        )
    } else {
        (
            StatusCode::OK,
            Json(json!({"MessageId": Uuid::now_v7().to_string()})),
        )
    }
}

async fn consent(pool: &PgPool) -> anyhow::Result<(CompaniesRepositoryImpl, Uuid, Uuid)> {
    let macro_user = Uuid::now_v7();
    let team = Uuid::now_v7();
    let link = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
        macro_user,
        USER,
        format!("stripe_{macro_user}")
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        USER,
        macro_user
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Outbox test', $2)",
        team,
        USER
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'owner')",
        team,
        USER
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $3, 'outbox@example.com', 'GMAIL')"#,
        link,
        USER,
        format!("fa_{link}")
    )
    .execute(pool)
    .await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.change_email_privacy(
        team,
        USER,
        EmailPrivacyChange::SetConsent {
            enabled: true,
            link_id: Some(link),
        },
    )
    .await?;
    Ok((repo, team, link))
}

async fn pending(pool: &PgPool) -> anyhow::Result<i64> {
    Ok(
        sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM crm_email_backfill_outbox"#)
            .fetch_one(pool)
            .await?,
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn publishes_committed_consent_and_removes_request(pool: PgPool) -> anyhow::Result<()> {
    consent(&pool).await?;
    let queue = TestQueue::start().await?;
    drain(&pool, &queue.sqs).await?;
    assert_eq!(pending(&pool).await?, 0);
    let messages = queue.messages();
    assert_eq!(messages.len(), 1);
    let BackfillOperation::PopulateCrmForUser(payload) = &messages[0].backfill_operation else {
        panic!("expected a CRM user backfill");
    };
    assert_eq!(payload.macro_id.as_ref(), USER);

    drain(&pool, &queue.sqs).await?;
    assert_eq!(queue.messages().len(), 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_publish_remains_pending_and_retries(pool: PgPool) -> anyhow::Result<()> {
    consent(&pool).await?;
    let queue = TestQueue::start().await?;
    queue.state.fail.store(true, Ordering::SeqCst);
    assert!(drain(&pool, &queue.sqs).await.is_err());
    assert_eq!(pending(&pool).await?, 1);

    queue.state.fail.store(false, Ordering::SeqCst);
    drain(&pool, &queue.sqs).await?;
    assert_eq!(pending(&pool).await?, 0);
    let messages = queue.messages();
    assert_eq!(messages.len(), 2);
    assert_eq!(
        serde_json::to_value(&messages[0])?,
        serde_json::to_value(&messages[1])?
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn withdrawn_consent_discards_pending_request(pool: PgPool) -> anyhow::Result<()> {
    let (repo, team, _) = consent(&pool).await?;
    repo.change_email_privacy(
        team,
        USER,
        EmailPrivacyChange::SetConsent {
            enabled: false,
            link_id: None,
        },
    )
    .await?;
    assert_eq!(pending(&pool).await?, 1);
    let queue = TestQueue::start().await?;
    drain(&pool, &queue.sqs).await?;
    assert_eq!(pending(&pool).await?, 0);
    assert!(queue.messages().is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn disconnected_mailbox_discards_pending_request(pool: PgPool) -> anyhow::Result<()> {
    let (_, _, link) = consent(&pool).await?;
    sqlx::query!("DELETE FROM email_links WHERE id = $1", link)
        .execute(&pool)
        .await?;
    let queue = TestQueue::start().await?;
    drain(&pool, &queue.sqs).await?;
    assert_eq!(pending(&pool).await?, 0);
    assert!(queue.messages().is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn another_publisher_skips_locked_request(pool: PgPool) -> anyhow::Result<()> {
    let (_, team, _) = consent(&pool).await?;
    let queue = TestQueue::start().await?;
    let mut publisher = pool.begin().await?;
    sqlx::query!(
        "SELECT team_id FROM crm_email_backfill_outbox WHERE team_id = $1 FOR UPDATE",
        team
    )
    .fetch_one(&mut *publisher)
    .await?;
    tokio::time::timeout(Duration::from_secs(5), drain(&pool, &queue.sqs)).await??;
    assert!(queue.messages().is_empty());
    assert_eq!(pending(&pool).await?, 1);

    publisher.rollback().await?;
    drain(&pool, &queue.sqs).await?;
    assert_eq!(queue.messages().len(), 1);
    assert_eq!(pending(&pool).await?, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn withdrawal_does_not_wait_for_publisher_row_lock(pool: PgPool) -> anyhow::Result<()> {
    let (repo, team, _) = consent(&pool).await?;
    let mut publisher = pool.begin().await?;
    sqlx::query!(
        "SELECT team_id FROM crm_email_backfill_outbox WHERE team_id = $1 FOR UPDATE",
        team
    )
    .fetch_one(&mut *publisher)
    .await?;
    tokio::time::timeout(
        Duration::from_secs(5),
        repo.change_email_privacy(
            team,
            USER,
            EmailPrivacyChange::SetConsent {
                enabled: false,
                link_id: None,
            },
        ),
    )
    .await??;
    assert!(repo.contribution_mailbox(team, USER).await?.is_none());

    publisher.rollback().await?;
    let queue = TestQueue::start().await?;
    drain(&pool, &queue.sqs).await?;
    assert!(queue.messages().is_empty());
    assert_eq!(pending(&pool).await?, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn consent_trace_survives_outbox_queue_and_deferral_without_payload_fields(
    pool: PgPool,
) -> anyhow::Result<()> {
    use opentelemetry::trace::TracerProvider as _;
    use opentelemetry_sdk::{
        propagation::TraceContextPropagator,
        trace::{InMemorySpanExporter, SdkTracerProvider},
    };
    use sqs_client::email::trace_context;
    use tracing::Instrument as _;
    use tracing::instrument::WithSubscriber as _;
    use tracing_subscriber::layer::SubscriberExt as _;

    opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("crm-outbox-test")));
    async {
        let request = tracing::info_span!(parent: None, "consent.request");
        let (repo, team, link) = consent(&pool).instrument(request.clone()).await?;
        let stored = sqlx::query_scalar!(
            "SELECT traceparent FROM crm_email_backfill_outbox WHERE team_id = $1",
            team
        )
        .fetch_one(&pool)
        .await?
        .expect("request context persisted");
        let trace_id = stored.split('-').nth(1).unwrap();
        let queue = TestQueue::start().await?;
        drain(&pool, &queue.sqs).await?;
        let carried = queue.state.requests.lock().unwrap()[0]["MessageAttributes"]
            [trace_context::ATTRIBUTE]["StringValue"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(carried.split('-').nth(1), Some(trace_id));
        let delivery = tracing::info_span!(parent: None, "email.backfill.process");
        traceparent::adopt(&delivery, Some(&carried));
        let message = queue.messages().remove(0);
        queue
            .sqs
            .defer_email_backfill_message(&message, 5, 1)
            .instrument(delivery)
            .await?;
        let retry = queue.state.requests.lock().unwrap()[1]["MessageAttributes"]
            [trace_context::ATTRIBUTE]["StringValue"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(retry.split('-').nth(1), Some(trace_id));
        // Exercise the real CRM service/repository boundaries, even though no
        // stored message exists and these population requests correctly no-op.
        use crm::domain::{
            companies_repo::CompaniesRepository,
            service::{CrmService, CrmServiceImpl},
        };
        let service = CrmServiceImpl::new(
            repo.clone(),
            crm::outbound::no_op_resolver::NoOpCompanyMetadataResolver,
        );
        assert_eq!(service.get_team_id_for_user(USER).await?, Some(team));
        let now = chrono::Utc::now();
        service
            .populate_contact(
                &team,
                &link,
                "outbox@example.com",
                "person@example.org",
                Some("Private Contact"),
                now,
                now,
                true,
            )
            .await?;
        repo.populate_contact(
            &team,
            &link,
            "example.org",
            "person@example.org",
            Some("Private Contact"),
            now,
            now,
            true,
        )
        .await?;
        assert!(
            service
                .populate_contact(
                    &team,
                    &link,
                    "outbox@example.com",
                    "private-invalid-address",
                    None,
                    now,
                    now,
                    true
                )
                .await
                .is_err()
        );
        let invalid = tracing::info_span!(parent: None, "invalid.context");
        let before = invalid.in_scope(traceparent::current);
        traceparent::adopt(&invalid, Some("not-a-traceparent"));
        traceparent::adopt(&invalid, None);
        assert_eq!(invalid.in_scope(traceparent::current), before);
        drop(invalid);
        // A later request outside tracing must not retain an obsolete parent.
        repo.change_email_privacy(
            team,
            USER,
            EmailPrivacyChange::RemoveDomain {
                scope: crm::domain::email_privacy::EmailBlockScope::Personal,
                domain: "example.org".into(),
            },
        )
        .with_subscriber(tracing::subscriber::NoSubscriber::default())
        .await?;
        assert!(
            sqlx::query_scalar!(
                "SELECT traceparent FROM crm_email_backfill_outbox WHERE team_id = $1",
                team
            )
            .fetch_one(&pool)
            .await?
            .is_none()
        );
        drop(request);
        anyhow::Ok(())
    }
    .with_subscriber(subscriber)
    .await?;
    provider.force_flush()?;
    let spans = exporter.get_finished_spans()?;
    assert!(
        spans
            .iter()
            .any(|span| span.name == "crm.email_backfill.publish")
    );
    let deferral = spans
        .iter()
        .find(|span| span.name == "defer_email_backfill_message")
        .expect("deferral span exported");
    for (key, expected) in [("delay_seconds", 5), ("deferrals", 1)] {
        assert!(
            deferral.attributes.iter().any(|field| {
                field.key.as_str() == key && field.value == opentelemetry::Value::I64(expected)
            }),
            "missing numeric deferral field {key}"
        );
    }
    for span in spans {
        for field in span.attributes {
            let value = field.value.to_string();
            assert!(!value.contains(USER), "personal identity in span field");
            for private in [
                "outbox@example.com",
                "person@example.org",
                "Private Contact",
                "private-invalid-address",
            ] {
                assert!(
                    !value.contains(private),
                    "personal data in span field {}",
                    field.key
                );
            }
        }
    }
    Ok(())
}
