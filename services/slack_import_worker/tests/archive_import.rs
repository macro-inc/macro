//! Opt-in real PostgreSQL/S3/SQS contract test. No hosted endpoints or customer data.
//! SQLx creates a database per test; Docker creates a private LocalStack container.
//! Search acceptance is deliberately controlled, not an OpenSearch end-to-end test.

use std::{
    process::Command,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use aws_sdk_s3::config::{BehaviorVersion, Credentials, Region};
use chrono::{DateTime, Utc};
use entity_access::{
    domain::{models::*, service::EntityAccessServiceImpl},
    outbound::PgAccessRepository,
};
use import::outbound::pg_import_repo::PgImportRepo;
use macro_queues::{SlackImportDlq, SlackImportQueue};
use macro_user_id::user_id::MacroUserIdStr;
use notification::{domain::service::SqsNotificationIngress, outbound::queue::SqsQueue};
use sha2::{Digest, Sha256};
use slack_import_worker::composition::{
    authorizer::WorkerAuthorizer, channel_sink::ChannelImportSink,
    join_announcer::WorkerJoinAnnouncer, reference_reconciliation::WorkerReferenceReconciler,
};
use slack_integration::{
    domain::{
        importer::{ConversationImporter, ImporterConfig},
        maintenance::{ImportMaintenance, Maintenance},
        models::*,
        ports::*,
        service::SlackImportService,
    },
    inbound::worker::{self, WorkerConfig},
    outbound::{
        import_ledger::CanonicalImportLedger, pg_slack_import_repo::PgSlackImportRepo,
        s3_storage::S3ImportStorage, sqs_queue::SqsImportQueue,
    },
};
use sqlx::PgPool;
use teams::{
    domain::join_announcement::JoinAnnouncementServiceImpl,
    outbound::join_announcement_repo::JoinAnnouncementRepositoryImpl,
};
use tokio::time::{sleep, timeout};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[path = "archive_import/process_recovery.rs"]
mod process_recovery;

type Access = EntityAccessServiceImpl<PgAccessRepository>;

/// Only this test's container is removed, including on assertion failure. The image
/// must already exist: an ignored test must not silently pull arbitrary images.
struct LocalStack(String);

impl LocalStack {
    async fn start() -> (Self, String) {
        let container = Self(docker(&[
            "run",
            "--detach",
            "--rm",
            "--pull=never",
            "--publish",
            "127.0.0.1::4566",
            "--env",
            "SERVICES=s3,sqs",
            "--env",
            "SQS_ENDPOINT_STRATEGY=path",
            "localstack/localstack:4",
        ]));
        let address = docker(&["port", &container.0, "4566/tcp"]);
        let endpoint = format!("http://{address}");
        let client = reqwest::Client::new();
        timeout(Duration::from_secs(60), async {
            loop {
                if let Ok(response) = client
                    .get(format!("{endpoint}/_localstack/health"))
                    .send()
                    .await
                    && response.status().is_success()
                {
                    break;
                }
                sleep(Duration::from_millis(250)).await;
            }
        })
        .await
        .expect("isolated LocalStack did not start");
        (container, endpoint)
    }
}

impl Drop for LocalStack {
    fn drop(&mut self) {
        let _ = Command::new("docker")
            .args(["rm", "--force", &self.0])
            .output();
    }
}

fn docker(args: &[&str]) -> String {
    let output = Command::new("docker")
        .args(args)
        .output()
        .expect("Docker is required");
    assert!(
        output.status.success(),
        "docker failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

struct Resources {
    storage: S3ImportStorage,
    queue: SqsImportQueue,
    process: process_recovery::ProcessConfig,
    sqs: aws_sdk_sqs::Client,
    ingress_url: String,
}

async fn resources(endpoint: &str) -> Resources {
    let suffix = Uuid::now_v7().simple().to_string();
    let bucket = format!("archive-test-{suffix}");
    let main = format!("archive-main-{suffix}");
    let dlq = format!("archive-dlq-{suffix}");
    let ingress = format!("archive-ingress-{suffix}");
    let s3 = aws_sdk_s3::Client::from_conf(
        aws_sdk_s3::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new("us-east-1"))
            .credentials_provider(Credentials::new(
                "test",
                "test",
                None,
                None,
                "isolated-test",
            ))
            .endpoint_url(endpoint)
            .force_path_style(true)
            .build(),
    );
    s3.create_bucket().bucket(&bucket).send().await.unwrap();
    let sqs = aws_sdk_sqs::Client::from_conf(
        aws_sdk_sqs::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new("us-east-1"))
            .credentials_provider(Credentials::new(
                "test",
                "test",
                None,
                None,
                "isolated-test",
            ))
            .endpoint_url(endpoint)
            .build(),
    );
    for name in [&main, &dlq, &ingress] {
        sqs.create_queue().queue_name(name).send().await.unwrap();
    }
    use aws_sdk_sqs::types::QueueAttributeName;
    let main_url = sqs
        .get_queue_url()
        .queue_name(&main)
        .send()
        .await
        .unwrap()
        .queue_url
        .unwrap();
    let dlq_url = sqs
        .get_queue_url()
        .queue_name(&dlq)
        .send()
        .await
        .unwrap()
        .queue_url
        .unwrap();
    let ingress_url = sqs
        .get_queue_url()
        .queue_name(&ingress)
        .send()
        .await
        .unwrap()
        .queue_url
        .unwrap();
    let attributes = sqs
        .get_queue_attributes()
        .queue_url(dlq_url)
        .attribute_names(QueueAttributeName::QueueArn)
        .send()
        .await
        .unwrap();
    let arn = &attributes.attributes.unwrap()[&QueueAttributeName::QueueArn];
    sqs.set_queue_attributes()
        .queue_url(main_url)
        .attributes(
            QueueAttributeName::RedrivePolicy,
            serde_json::json!({"deadLetterTargetArn": arn, "maxReceiveCount": 2}).to_string(),
        )
        .send()
        .await
        .unwrap();
    let queue = SqsImportQueue::new(
        sqs.clone(),
        &SlackImportQueue::from_owned(main.clone()),
        &SlackImportDlq::from_owned(dlq.clone()),
    )
    .await
    .unwrap();
    let process = process_recovery::ProcessConfig {
        endpoint: endpoint.to_owned(),
        bucket: bucket.clone(),
        main,
        dlq,
    };
    let storage = S3ImportStorage::new(s3, bucket, ImportLimits::default()).unwrap();
    Resources {
        storage,
        queue,
        process,
        sqs,
        ingress_url,
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|t17@example.com").unwrap()
}

async fn team(pool: &PgPool) -> TeamId {
    let account = Uuid::now_v7();
    let team = Uuid::now_v7();
    sqlx::query!("INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 't17', 't17@example.com', 't17-customer')", account).execute(pool).await.unwrap();
    sqlx::query!(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|t17@example.com', 't17@example.com', $1)"#, account).execute(pool).await.unwrap();
    sqlx::query!("INSERT INTO team (id, name, owner_id, auto_join_domain) VALUES ($1, 'Atomic history', 'macro|t17@example.com', 'example.com')", team).execute(pool).await.unwrap();
    sqlx::query!("INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, 'macro|t17@example.com', 'owner')", team).execute(pool).await.unwrap();
    team.try_into().unwrap()
}

fn access(team: TeamId) -> EntityAccessReceipt<AdminTeamRole> {
    EntityAccessReceipt::try_new(
        EntityAccessAuth::Authenticated(user()),
        Entity {
            entity_id: team.to_string(),
            entity_type: EntityType::Team,
        },
        EntityPermission::TeamRole {
            role: TeamRole::Admin,
        },
    )
    .unwrap()
}

// Production write authorization is retained. This harness intentionally hides
// all target IDs in public receipts; reference disclosure uses the real lookup.
struct Admin(WorkerAuthorizer<Access>);
impl ImportAuthorizer for Admin {
    async fn require_admin(&self, team: TeamId, user: &MacroUserIdStr<'_>) -> PortResult<()> {
        self.0.require_admin(team, user).await
    }
    async fn require_target(
        &self,
        team: TeamId,
        user: &MacroUserIdStr<'_>,
        metadata: &ConversationMetadata,
        target: Uuid,
    ) -> PortResult<()> {
        self.0.require_target(team, user, metadata, target).await
    }
}
impl ImportProgressAccess for Admin {
    async fn participating_targets(
        &self,
        _: &MacroUserIdStr<'_>,
        _: &[Uuid],
    ) -> PortResult<Vec<Uuid>> {
        Ok(vec![])
    }
}
struct NoGateway;
impl ImportNotifier for NoGateway {
    async fn invalidate(
        &self,
        _: &MacroUserIdStr<'_>,
        _: TeamId,
        _: JobId,
        _: u64,
        _: JobStatus,
    ) -> PortResult<()> {
        Ok(())
    }
}
struct SystemClock;
impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}
#[derive(Clone, Default)]
struct SearchGate(Arc<AtomicBool>);
impl SearchBackfillClient for SearchGate {
    async fn submit(&self, _: &SearchBackfill) -> PortResult<Uuid> {
        Ok(Uuid::now_v7())
    }
    async fn progress(&self, receipt_id: Uuid) -> PortResult<SearchState> {
        if self.0.load(Ordering::SeqCst) {
            Ok(SearchState::Completed)
        } else {
            Ok(SearchState::Submitted { receipt_id })
        }
    }
}

fn command(history: bool) -> CreateImport {
    CreateImport {
        idempotency_token: Uuid::now_v7().try_into().unwrap(),
        source: SourceIdentity::ConfirmedUnknown,
        include_message_history: history,
        conversations: ["C1", "C2"]
            .map(|id| ConversationMetadata {
                slack_channel_id: id.parse().unwrap(),
                kind: ConversationKind::PublicChannel,
                name: "duplicate display name".into(),
                folder: id.parse().unwrap(),
                member_ids: vec!["U1".parse().unwrap(), "U3".parse().unwrap()],
                creator_id: None,
                created_at: Some("1.000001".parse().unwrap()),
                archived: false,
                message_count: None,
            })
            .to_vec(),
    }
}

fn descriptor(upload: UploadId, bytes: &[u8]) -> UploadDescriptor {
    let record_count = match upload {
        UploadId::Users => None,
        UploadId::ConversationPart { .. } => {
            Some(bytes.iter().filter(|byte| **byte == b'\n').count() as u32)
        }
    };
    UploadDescriptor {
        upload,
        sha256: format!("{:x}", Sha256::digest(bytes)).parse().unwrap(),
        byte_length: bytes.len() as u64,
        record_count,
    }
}

async fn put(grant: &UploadGrant, bytes: &[u8]) -> reqwest::StatusCode {
    let mut request = reqwest::Client::new().put(&grant.url).body(bytes.to_vec());
    for (name, value) in &grant.required_headers {
        request = request.header(name, value);
    }
    request.send().await.unwrap().status()
}

async fn upload_job(service: &impl ImportService, team: TeamId, history: bool) -> JobId {
    let request = command(history);
    let job = service.create(access(team), request.clone()).await.unwrap();
    assert_eq!(
        service
            .create(access(team), request.clone())
            .await
            .unwrap()
            .job_id,
        job.job_id
    );
    let mut changed = request;
    changed.conversations.pop();
    assert_eq!(
        service.create(access(team), changed).await.unwrap_err(),
        ImportError::Conflict
    );
    let users = serde_json::to_vec(&serde_json::json!([
        {"id":"U1", "name":"admin", "profile":{"email":"T17@Example.com"}},
        {"id":"U2", "name":"Unknown author"},
        {"id":"U3", "name":"External member", "profile":{"email":"external@example.com"}}
    ]))
    .unwrap();
    let users_descriptor = descriptor(UploadId::Users, &users);
    let grant = service
        .register_uploads(
            access(team),
            job.job_id,
            RegisterUploads {
                descriptors: vec![users_descriptor],
            },
        )
        .await
        .unwrap()
        .pop()
        .unwrap();
    assert!(put(&grant, &users).await.is_success());
    assert_eq!(
        put(&grant, &users).await,
        reqwest::StatusCode::PRECONDITION_FAILED
    );
    service
        .complete_uploads(
            access(team),
            job.job_id,
            CompleteUploads {
                uploads: vec![UploadId::Users],
                seal: None,
            },
        )
        .await
        .unwrap();
    // Registration and sealing cannot widen the persisted selection.
    let foreign = "CUNSELECTED".parse().unwrap();
    assert!(
        service
            .register_uploads(
                access(team),
                job.job_id,
                RegisterUploads {
                    descriptors: vec![descriptor(
                        UploadId::ConversationPart {
                            slack_channel_id: foreign,
                            part_index: 0
                        },
                        b"{}\n"
                    )]
                }
            )
            .await
            .is_err()
    );
    let seal = ConversationSeal::from_descriptors(
        "CUNSELECTED".parse().unwrap(),
        &[],
        &ImportLimits::default(),
    )
    .unwrap();
    assert!(
        service
            .complete_uploads(
                access(team),
                job.job_id,
                CompleteUploads {
                    uploads: vec![],
                    seal: Some(seal)
                }
            )
            .await
            .is_err()
    );
    assert!(
        service
            .progress(
                access(Uuid::now_v7().try_into().unwrap()),
                JobCommand { job_id: job.job_id }
            )
            .await
            .is_err()
    );
    // Seal in reverse order. No message can rely on queue order for its links.
    for id in ["C2", "C1"] {
        let mut descriptors = vec![];
        if history {
            let other = if id == "C1" { "C2" } else { "C1" };
            let records = [
                serde_json::json!({"type":"message", "user":"U2", "ts":"2.000001", "text": format!("<@U1> <!channel> See <#{other}|other> and <https://unproven.slack.com/archives/{other}/p0000000002000001|original>"), "reactions":[{"name":"thumbsup", "users":["U1"], "count":1}]}),
                serde_json::json!({"type":"message", "user":"U1", "ts":"3.000001", "thread_ts":"2.000001", "text":"historical reply"}),
            ];
            let bytes = records
                .iter()
                .map(|record| format!("{record}\n"))
                .collect::<String>()
                .into_bytes();
            let part = descriptor(
                UploadId::ConversationPart {
                    slack_channel_id: id.parse().unwrap(),
                    part_index: 0,
                },
                &bytes,
            );
            let grant = service
                .register_uploads(
                    access(team),
                    job.job_id,
                    RegisterUploads {
                        descriptors: vec![part.clone()],
                    },
                )
                .await
                .unwrap()
                .pop()
                .unwrap();
            assert!(put(&grant, &bytes).await.is_success());
            service
                .complete_uploads(
                    access(team),
                    job.job_id,
                    CompleteUploads {
                        uploads: vec![part.upload.clone()],
                        seal: None,
                    },
                )
                .await
                .unwrap();
            descriptors.push(part);
        }
        let receipt = service
            .progress(access(team), JobCommand { job_id: job.job_id })
            .await
            .unwrap();
        assert_eq!(
            receipt
                .conversations
                .iter()
                .find(|conversation| conversation.slack_channel_id.as_str() == id)
                .unwrap()
                .status,
            ConversationStatus::AwaitingUploads
        );
        let seal = ConversationSeal::from_descriptors(
            id.parse().unwrap(),
            &descriptors,
            &ImportLimits::default(),
        )
        .unwrap();
        service
            .complete_uploads(
                access(team),
                job.job_id,
                CompleteUploads {
                    uploads: vec![],
                    seal: Some(seal),
                },
            )
            .await
            .unwrap();
    }
    let receipt = service
        .finalize(access(team), JobCommand { job_id: job.job_id })
        .await
        .unwrap();
    assert_eq!(receipt.conversations.len(), 2);
    assert_eq!(receipt.include_message_history, history);
    job.job_id
}

async fn progress(repo: &PgSlackImportRepo, team: TeamId, job: JobId) -> ImportProgress {
    repo.progress(team, job).await.unwrap().unwrap()
}

async fn assert_no_notification_or_activity_rows(pool: &PgPool) {
    let counts = sqlx::query!(
        r#"
        SELECT
            (SELECT count(*) FROM notification) AS "notifications!",
            (SELECT count(*) FROM user_notification) AS "user_notifications!",
            (SELECT count(*) FROM notification_email_sent) AS "emails!",
            (SELECT count(*) FROM channel_notification_email_sent) AS "channel_emails!",
            (SELECT count(*) FROM comms_activity) AS "channel_activity!",
            (SELECT count(*) FROM activity_events) AS "activity_events!"
        "#
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        counts.notifications, 0,
        "history must not create notifications"
    );
    assert_eq!(
        counts.user_notifications, 0,
        "history must not create unread notifications"
    );
    assert_eq!(counts.emails, 0, "history must not send emails");
    assert_eq!(
        counts.channel_emails, 0,
        "history must not send channel invitations"
    );
    assert_eq!(
        counts.channel_activity, 0,
        "history must not create per-user activity"
    );
    assert_eq!(
        counts.activity_events, 0,
        "history must not create live activity events"
    );
}

async fn assert_one_external_colleague(pool: &PgPool, team: TeamId) {
    let count = sqlx::query_scalar!(r#"SELECT count(*) FROM team_joined_macro_email"#)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(count, Some(1));
    let rows = sqlx::query!(r#"SELECT team_id, email FROM team_joined_macro_email"#)
        .fetch_all(pool)
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].team_id, Uuid::from(team));
    assert_eq!(rows[0].email, "external@example.com");
}

async fn ingress_bodies(sqs: &aws_sdk_sqs::Client, url: &str) -> Vec<serde_json::Value> {
    let mut bodies = Vec::new();
    loop {
        let page = sqs
            .receive_message()
            .queue_url(url)
            .max_number_of_messages(10)
            .wait_time_seconds(1)
            .send()
            .await
            .unwrap();
        let Some(messages) = page.messages.filter(|messages| !messages.is_empty()) else {
            break;
        };
        for message in messages {
            bodies.push(serde_json::from_str(message.body.as_deref().unwrap()).unwrap());
            sqs.delete_message()
                .queue_url(url)
                .receipt_handle(message.receipt_handle.unwrap())
                .send()
                .await
                .unwrap();
        }
    }
    bodies
}

fn assert_colleague_joined(body: &serde_json::Value, team: Uuid) {
    let request = &body["request"];
    assert_eq!(
        request["req"]["notification"]["tag"],
        "colleague_joined_macro"
    );
    assert_eq!(request["req"]["sender_id"], "macro|t17@example.com");
    assert_eq!(
        request["req"]["recipient_ids"],
        serde_json::json!(["macro|external@example.com"])
    );
    let id = Uuid::new_v5(
        &Uuid::from_u128(0x7465_616d_2d6a_6f69_6e65_642d_6d61_6372),
        format!("{team}:external@example.com").as_bytes(),
    );
    assert_eq!(request["uuid_to_write"], id.to_string());
}

#[ignore = "requires Docker with localstack/localstack:4 and a local PostgreSQL test role"]
#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn sealed_uploads_queue_replay_and_search_completion_barrier(pool: PgPool) {
    let (_container, endpoint) = LocalStack::start().await;
    let Resources {
        storage,
        queue,
        sqs,
        ingress_url,
        ..
    } = resources(&endpoint).await;
    let team = team(&pool).await;
    let limits = ImportLimits::default();
    let repo = PgSlackImportRepo::new(pool.clone(), limits);
    let authorizer = WorkerAuthorizer::new(
        pool.clone(),
        Access::new(PgAccessRepository::new(pool.clone())),
    );
    let ledger = CanonicalImportLedger::new(PgImportRepo::new(pool.clone()));
    let service = SlackImportService::new(
        repo.clone(),
        storage.clone(),
        ledger.clone(),
        NoGateway,
        Admin(authorizer.clone()),
        |_| true,
        limits,
    )
    .unwrap();
    let sink = ChannelImportSink::new(pool.clone(), authorizer.clone(), limits).unwrap();
    let search = SearchGate::default();
    let maintenance = Arc::new(ImportMaintenance::new(
        repo.clone(),
        queue.clone(),
        search.clone(),
        SystemClock,
        WorkerReferenceReconciler::new(pool.clone(), limits),
    ));
    let importer = Arc::new(
        ConversationImporter::new(
            repo.clone(),
            storage,
            ledger,
            sink.clone(),
            sink.clone(),
            authorizer,
            WorkerJoinAnnouncer::new(
                JoinAnnouncementServiceImpl::new(
                    JoinAnnouncementRepositoryImpl::new(pool.clone()),
                    SqsNotificationIngress {
                        queue: SqsQueue::new(sqs.clone(), ingress_url.clone()),
                    },
                ),
                true,
            ),
            ImporterConfig { limits },
        )
        .unwrap(),
    );
    assert_no_notification_or_activity_rows(&pool).await;
    // Shape creation followed by history and an exact repeat reuse the same IDs.
    let mut canonical = None;
    for (attempt, history) in [false, true, true].into_iter().enumerate() {
        search.0.store(false, Ordering::SeqCst);
        let job = upload_job(&service, team, history).await;
        let events = repo.pending_events(50).await.unwrap();
        assert_eq!(events.len(), 2);
        // Fault boundary: SQS accepted the send, but the process died before the
        // PostgreSQL publication acknowledgement. The real outbox republishes it.
        for event in &events {
            queue.publish(event).await.unwrap();
        }
        // Expire only this test job's publication reservation, as wall time would
        // after a publisher crash. pending_events is a reservation, not a read.
        sqlx::query!("UPDATE slack_import_outbox SET available_at = clock_timestamp() - interval '1 second' WHERE job_id = $1", Uuid::from(job)).execute(&pool).await.unwrap();
        maintenance.publish().await.unwrap();
        assert!(repo.pending_events(50).await.unwrap().is_empty());
        let stop = CancellationToken::new();
        let driver = {
            let (importer, maintenance, queue, stop) = (
                importer.clone(),
                maintenance.clone(),
                queue.clone(),
                stop.clone(),
            );
            tokio::spawn(async move {
                worker::run(
                    importer.as_ref(),
                    maintenance.as_ref(),
                    &queue,
                    Uuid::now_v7().try_into().unwrap(),
                    WorkerConfig::new(true, 2, 5).unwrap(),
                    stop,
                )
                .await;
            })
        };
        timeout(Duration::from_secs(60), async {
            loop {
                let receipt = progress(&repo, team, job).await;
                if receipt
                    .conversations
                    .iter()
                    .all(|c| c.status == ConversationStatus::Completed)
                {
                    break;
                }
                sleep(Duration::from_millis(100)).await;
            }
        })
        .await
        .expect("queue driver did not settle selected conversations");
        stop.cancel();
        timeout(Duration::from_secs(35), driver)
            .await
            .unwrap()
            .unwrap();
        assert_one_external_colleague(&pool, team).await;
        let messages = ingress_bodies(&sqs, &ingress_url).await;
        if attempt == 0 {
            assert_eq!(messages.len(), 1);
            assert_colleague_joined(&messages[0], Uuid::from(team));
        } else {
            assert!(messages.is_empty());
        }
        // Reconcile links and publish search without a competing maintenance loop.
        maintenance.reconcile().await.unwrap();
        let receipt = progress(&repo, team, job).await;
        let targets: Vec<_> = receipt
            .conversations
            .iter()
            .map(|c| c.channel_id.unwrap())
            .collect();
        if let Some(ref expected) = canonical {
            assert_eq!(&targets, expected);
        } else {
            canonical = Some(targets.clone());
        }
        if history
            && receipt
                .conversations
                .iter()
                .any(|c| c.counters.imported > 0)
        {
            assert_eq!(
                receipt.status,
                JobStatus::Processing,
                "search acceptance is not completion"
            );
            for (index, id) in ["C1", "C2"].iter().enumerate() {
                let sources = ["2.000001", "3.000001"].map(|ts| SourceMessageId {
                    team_id: team,
                    slack_channel_id: id.parse().unwrap(),
                    ts: ts.parse().unwrap(),
                });
                let mapped = sink.lookup(&sources).await.unwrap();
                assert_eq!(mapped.len(), 2);
                let root = mapped
                    .iter()
                    .find(|(source, _)| source.ts == sources[0].ts)
                    .unwrap()
                    .1;
                let body =
                    sqlx::query_scalar!("SELECT content FROM comms_messages WHERE id = $1", root)
                        .fetch_one(&pool)
                        .await
                        .unwrap();
                assert!(
                    body.contains(&targets[1 - index].to_string()),
                    "reference must contain final canonical target UUID"
                );
                assert!(body.contains("<m-link>"));
                assert!(
                    body.contains("unproven.slack.com"),
                    "unproven domain must stay external"
                );
                let replies = sqlx::query_scalar!(
                    "SELECT thread_id FROM comms_messages WHERE channel_id = $1 AND id <> $2",
                    targets[index],
                    root
                )
                .fetch_all(&pool)
                .await
                .unwrap();
                assert_eq!(replies, vec![Some(root)]);
            }
        }
        search.0.store(true, Ordering::SeqCst);
        // Make the 60-second search receipt poll due in this isolated fixture.
        sqlx::query!("UPDATE slack_import_outbox SET available_at = clock_timestamp() - interval '1 second' WHERE job_id = $1", Uuid::from(job)).execute(&pool).await.unwrap();
        maintenance.reconcile().await.unwrap();
        assert_eq!(
            progress(&repo, team, job).await.status,
            JobStatus::Completed
        );
        assert_no_notification_or_activity_rows(&pool).await;
    }
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM comms_messages")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(4)
    );

    // Exhaust real receives (without a worker deleting them) into the configured
    // DLQ. Disabling admission must still run the production DLQ driver.
    // Cancelled HTTP long polls can still reserve messages server-side until
    // their timeout. A fresh queue keeps this redrive scenario independent.
    let Resources { storage, queue, .. } = resources(&endpoint).await;
    let authorizer = WorkerAuthorizer::new(
        pool.clone(),
        Access::new(PgAccessRepository::new(pool.clone())),
    );
    let service = SlackImportService::new(
        repo.clone(),
        storage,
        CanonicalImportLedger::new(PgImportRepo::new(pool.clone())),
        NoGateway,
        Admin(authorizer),
        |_| true,
        limits,
    )
    .unwrap();
    let maintenance = Arc::new(ImportMaintenance::new(
        repo.clone(),
        queue.clone(),
        search,
        SystemClock,
        WorkerReferenceReconciler::new(pool.clone(), limits),
    ));
    let exhausted = upload_job(&service, team, false).await;
    maintenance.publish().await.unwrap();
    let mut twice = std::collections::HashSet::new();
    timeout(Duration::from_secs(60), async {
        while twice.len() != 2 {
            let Some(delivery) = ImportConsumer::receive(&queue, false).await.unwrap() else {
                continue;
            };
            let (event, count) = SqsImportQueue::envelope(&delivery);
            let event = event.unwrap();
            if event.job_id != exhausted {
                ImportConsumer::delete(&queue, &delivery).await.unwrap();
                continue;
            }
            if count >= 2 {
                twice.insert(event.slack_channel_id);
            }
            queue.extend_visibility(&delivery, 0).await.unwrap();
        }
        // The next main receive triggers redrive, rather than fabricating a DLQ send.
        assert!(
            ImportConsumer::receive(&queue, false)
                .await
                .unwrap()
                .is_none()
        );
    })
    .await
    .expect("main queue did not exhaust into the DLQ");
    let stop = CancellationToken::new();
    let driver = {
        let (importer, maintenance, queue, stop) = (
            importer.clone(),
            maintenance.clone(),
            queue.clone(),
            stop.clone(),
        );
        tokio::spawn(async move {
            worker::run(
                importer.as_ref(),
                maintenance.as_ref(),
                &queue,
                Uuid::now_v7().try_into().unwrap(),
                WorkerConfig::new(false, 1, 5).unwrap(),
                stop,
            )
            .await;
        })
    };
    timeout(Duration::from_secs(60), async {
        loop {
            let receipt = progress(&repo, team, exhausted).await;
            if receipt.status == JobStatus::Failed {
                assert!(
                    receipt
                        .conversations
                        .iter()
                        .all(|conversation| conversation.status == ConversationStatus::Failed)
                );
                break;
            }
            sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("disabled worker did not persist exhausted work as Failed");
    assert_no_notification_or_activity_rows(&pool).await;
    assert_one_external_colleague(&pool, team).await;
    assert!(ingress_bodies(&sqs, &ingress_url).await.is_empty());
    stop.cancel();
    timeout(Duration::from_secs(35), driver)
        .await
        .unwrap()
        .unwrap();
}
