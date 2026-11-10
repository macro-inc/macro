use super::{
    capture, database::Snapshot, fixture::Fixture, kafka::Kafka, normalize::Normalizer, redis,
    sql_fault::SqlFault, stub::Stub, transcript::Transcript,
};
use crate::composition::api::{ApiDependencies, api_context};
use crate::pubsub::label_write_sim::{
    fake_gmail::FakeGmail,
    fake_sqs::{self, FakeSqs},
};
use axum::{Router, body::Body, http::Request};
use http_body_util::BodyExt;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use serde_json::{Value, json};
use sqlx::{ConnectOptions, PgPool};
use std::sync::Arc;
use tower::ServiceExt;
use tracing::Instrument;
use tracing::instrument::WithSubscriber;

pub(super) struct LabOptions {
    pub suite: &'static str,
    pub name: &'static str,
    pub shard: u32,
    pub gmail_label_write_batches: bool,
}

#[derive(Clone, Copy)]
pub(super) enum Auth {
    User(usize),
    Internal,
    InternalKeyOnly,
    WrongInternalKey,
    MissingInternalKey,
    MissingCredentials,
    InvalidBearer,
}

pub(super) enum RequestBody {
    Empty,
    Json(Value),
    Raw {
        bytes: Vec<u8>,
        content_type: &'static str,
    },
}

/// Response headers whose values are generated per request.
const VOLATILE_RESPONSE_HEADERS: [&str; 2] = ["x-request-id", "date"];

pub(super) struct Lab {
    _guard: tokio::sync::OwnedMutexGuard<()>,
    app: Router,
    pub db: PgPool,
    pub fixture: Fixture,
    pub sqs: FakeSqs,
    pub gmail: FakeGmail,
    pub stub: Stub,
    pub sql_fault: SqlFault,
    pub drain_background: bool,
    kafka: Kafka,
    redis: ::redis::aio::MultiplexedConnection,
    redis_scopes: Vec<String>,
    pub transcript: Transcript,
}

impl Lab {
    #[expect(
        clippy::disallowed_methods,
        reason = "The test-only Redis URL comes from the explicitly supported REDIS_URI override"
    )]
    pub async fn start(db: PgPool, options: LabOptions) -> Self {
        let redis_uri =
            std::env::var("REDIS_URI").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
        Self::start_with_redis(db, options, redis_uri).await
    }

    /// A suite can isolate global provider caches in a Redis logical database.
    pub async fn start_with_redis(db: PgPool, options: LabOptions, redis_uri: String) -> Self {
        Self::start_configured(db, options, redis_uri, false).await
    }

    /// Explicit mailbox-rollout setting for initialization parity scenarios.
    pub async fn start_configured(
        db: PgPool,
        options: LabOptions,
        redis_uri: String,
        outlook_connections_enabled: bool,
    ) -> Self {
        let name = options.name;
        // The production cancellation shield spawns a root task without tracing
        // context. Capture its global events for this step as well. Nextest runs
        // scenarios in separate processes; the gate also protects in-process labs.
        let guard = capture::exclusive_lab().await;
        let mut normalizer = Normalizer::default();
        let mut fixture = Fixture::seed(&db, options.shard, &mut normalizer).await;
        let gmail = FakeGmail::start(std::mem::take(&mut fixture.gmail)).await;
        let sqs = FakeSqs::start().await;
        let stub = Stub::start().await;
        gmail.lock().http_recording = Some(stub.recording());
        let kafka = Kafka::start();
        normalizer.replace(&gmail.url, "<gmail>");
        normalizer.replace(&sqs.url, "<sqs>");
        normalizer.replace(&stub.url, "<services>");
        normalizer.replace(
            gmail
                .url
                .trim_start_matches("http://")
                .trim_end_matches("/gmail/v1"),
            "<gmail-address>",
        );
        normalizer.replace(sqs.url.trim_start_matches("http://"), "<sqs-address>");
        normalizer.replace(stub.url.trim_start_matches("http://"), "<services-address>");
        let redis_client = ::redis::Client::open(redis_uri.as_str()).expect("private Redis");
        let mut redis = redis_client
            .get_multiplexed_async_connection()
            .await
            .expect("Redis connection");
        let mut redis_scopes = Vec::new();
        for link_id in fixture.links {
            let link = email_db_client::links::get::fetch_link_by_id(&db, link_id)
                .await
                .expect("fixture link query")
                .expect("fixture link");
            let key = models_email::email::service::cache::TokenCacheKey::new(
                &link.fusionauth_user_id,
                link.email_address.0.as_ref(),
                link.provider.as_str(),
            )
            .to_redis_key();
            let _: () = ::redis::cmd("SET")
                .arg(&key)
                .arg("fake-access-token")
                .arg("EX")
                .arg(86_400)
                .query_async(&mut redis)
                .await
                .expect("fixture token");
            redis_scopes.push(key);
            redis_scopes.push(link_id.to_string());
            crate::pubsub::label_write_sim::wiring::reset_admission(&mut redis, link_id).await;
        }
        // A single service connection makes SQLx's type-cache introspection
        // deterministic without changing the separate fixture/dump connection.
        let sql_fault = SqlFault::default();
        let service_db = sql_fault
            .options()
            .connect_with(
                db.connect_options()
                    .as_ref()
                    .clone()
                    .log_statements(log::LevelFilter::Debug),
            )
            .await
            .expect("logged service pool");
        sql_fault.register(service_db.clone());
        let sdk = fake_sqs::client(&sqs.url, false);
        let sqs_client = sqs_client::SQS::new(sdk.clone())
            .gmail_inbox_sync_queue(&sqs.queue_url("gmail-webhook"))
            .gmail_inbox_sync_retry_queue(&sqs.queue_url("gmail-webhook-retry"))
            .gmail_ops_queue(&sqs.queue_url("gmail-ops"))
            .gmail_ops_retry_queue(&sqs.queue_url("gmail-ops-retry"))
            .gmail_label_write_batches(options.gmail_label_write_batches)
            .email_backfill_queue(&sqs.queue_url("backfill"))
            .email_scheduled_queue(&sqs.queue_url("scheduled"))
            .sfs_uploader_queue(&sqs.queue_url("sfs-uploader"))
            .email_link_manager_queue(&sqs.queue_url("link-manager"));
        let config = serde_json::from_value(json!({
            "MACRO_DB_URL": "private-test-database", "REDIS_URI": redis_uri,
            "KAFKA_BROKERS": "in-process", "GMAIL_GCP_QUEUE": "projects/parity/topics/gmail",
            "ATTACHMENT_BUCKET": "parity", "AUTHENTICATION_SERVICE_SECRET_KEY": "parity",
            "EMAIL_SERVICE_CLOUDFRONT_DISTRIBUTION_URL": stub.url,
            "EMAIL_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY": "parity",
            "EMAIL_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID": "parity", "INTERNAL_API_KEY": "parity",
            "ENVIRONMENT": "local", "GMAIL_LABEL_WRITE_BATCHES_ENABLED": options.gmail_label_write_batches,
            "OUTLOOK_CONNECTIONS_ENABLED": outlook_connections_enabled,
        })).expect("fixture configuration with production defaults");
        // Deny provider-token requests. These unused fixed-endpoint adapters may
        // be constructed, but parity scenarios must never call their providers.
        for path in [
            "/internal/google_access_token",
            "/internal/microsoft_access_token",
            "/internal/microsoft_disconnect_token",
        ] {
            stub.reply(
                "GET",
                path,
                401,
                json!({"message": "no provider credentials in parity"}),
            );
        }
        let state = api_context(ApiDependencies {
            read_receipts: email::domain::read_receipts::ReadReceiptService::new(
                email::outbound::read_receipts_pg::ReadReceiptPgRepository(service_db.clone()),
                email::domain::read_receipts::PixelUrlPrefix::new(&stub.url),
            ),
            config,
            db: service_db,
            sqs_client,
            contacts_ingress: Arc::new(contacts::domain::service::SqsContactsIngress {
                queue: contacts::outbound::ingress::SqsContactsQueue::new(
                    sdk,
                    sqs.queue_url("contacts"),
                ),
            }),
            s3_client: s3_client::S3::new(aws_sdk_s3::Client::from_conf(
                aws_sdk_s3::Config::builder()
                    .behavior_version(aws_sdk_s3::config::BehaviorVersion::latest())
                    .region(aws_sdk_s3::config::Region::new("us-east-1"))
                    .credentials_provider(aws_sdk_s3::config::Credentials::new(
                        "test", "test", None, None, "parity",
                    ))
                    .endpoint_url(&stub.url)
                    .force_path_style(true)
                    .build(),
            )),
            gmail_client: gmail_client::GmailClient::new_with_urls(
                Some("projects/parity/topics/gmail".into()),
                gmail.url.clone(),
                format!("{}/people", stub.url),
                format!("{}/certs", stub.url),
                "parity".into(),
            ),
            redis_client: crate::util::redis::RedisClient::new(redis_client, 60),
            auth_service_client: authentication_service_client::AuthServiceClient::new(
                "parity".into(),
                stub.url.clone(),
            ),
            sfs_client: static_file_service_client::StaticFileServiceClient::new(
                "parity".into(),
                stub.url.clone(),
            ),
            dss_client: document_storage_service_client::DocumentStorageServiceClient::new(
                "parity".into(),
                stub.url.clone(),
            ),
            connection_gateway_client:
                connection_gateway_client::client::ConnectionGatewayClient::new(
                    "parity".into(),
                    stub.url.clone(),
                ),
            jwt_args: JwtValidationArgs::testing_macro_token("parity", super::PUBLIC_KEY),
            macro_event_broker: kafka.broker.clone(),
        })
        .await
        .expect("production API composition");
        let lab = Self {
            _guard: guard,
            app: crate::api::app(state),
            db,
            fixture,
            sqs,
            gmail,
            stub,
            sql_fault,
            drain_background: false,
            kafka,
            redis,
            redis_scopes,
            transcript: Transcript::new(options.suite, name, normalizer),
        };
        // macro_auth lazily chooses its cookie name from the process environment.
        // Assert this pre-handler response outside capture, warming that lookup
        // before internal callers try optional cookie authentication.
        lab.assert_missing_credentials().await;
        lab
    }

    /// Seed tokens after a suite changes the inbox address used as its cache key.
    pub async fn seed_link_token(&mut self, link_id: uuid::Uuid) {
        let link = email_db_client::links::get::fetch_link_by_id(&self.db, link_id)
            .await
            .expect("suite link query")
            .expect("suite link");
        let key = models_email::email::service::cache::TokenCacheKey::new(
            &link.fusionauth_user_id,
            link.email_address.0.as_ref(),
            link.provider.as_str(),
        )
        .to_redis_key();
        let _: () = ::redis::cmd("SET")
            .arg(&key)
            .arg("fake-access-token")
            .arg("EX")
            .arg(86_400)
            .query_async(&mut self.redis)
            .await
            .expect("suite token");
        self.redis_scopes.push(key);
    }

    /// Capture a suite-owned Redis namespace, including newly created inboxes.
    pub fn record_redis_scope(&mut self, scope: &str) {
        self.redis_scopes.push(scope.to_owned());
    }

    pub async fn assert_missing_credentials(&self) {
        let response = self
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri("/email/messages/labels")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("missing-credentials request"),
            )
            .await
            .expect("missing-credentials response");
        assert_eq!(response.status(), axum::http::StatusCode::UNAUTHORIZED);
        let bytes = response
            .into_body()
            .collect()
            .await
            .expect("missing-credentials body")
            .to_bytes();
        assert_eq!(
            serde_json::from_slice::<Value>(&bytes).expect("JSON rejection"),
            json!({"message": "unauthorized"})
        );
    }

    pub async fn request(
        &mut self,
        name: &str,
        method: &str,
        path: &str,
        auth: Auth,
        body: RequestBody,
    ) -> u16 {
        self.request_with_headers(name, method, path, auth, body, &[])
            .await
    }

    pub async fn request_with_headers(
        &mut self,
        name: &str,
        method: &str,
        path: &str,
        auth: Auth,
        body: RequestBody,
        headers: &[(&str, &[u8])],
    ) -> u16 {
        let before = Snapshot::take(&self.db).await;
        let redis_before = redis::snapshot(&mut self.redis, &self.redis_scopes).await;
        let auth_name = match auth {
            Auth::User(i) => format!("user {}", ['A', 'B', 'C'][i]),
            Auth::Internal => "internal".into(),
            Auth::InternalKeyOnly => "internal key only".into(),
            Auth::WrongInternalKey => "wrong internal key".into(),
            Auth::MissingInternalKey => "internal identity without key".into(),
            Auth::MissingCredentials => "none".into(),
            Auth::InvalidBearer => "none (invalid bearer)".into(),
        };
        let (wire_body, recorded_body, body_format, content_type) = match body {
            RequestBody::Empty => (Body::empty(), Value::Null, "none", None),
            RequestBody::Json(value) => (
                Body::from(serde_json::to_vec(&value).expect("request JSON")),
                value,
                "json",
                Some("application/json"),
            ),
            RequestBody::Raw {
                bytes,
                content_type,
            } => {
                let recorded = std::str::from_utf8(&bytes)
                    .map(|text| json!(text))
                    .unwrap_or_else(|_| super::http_body(&bytes));
                (Body::from(bytes), recorded, "raw", Some(content_type))
            }
        };
        let mut request = Request::builder().method(method).uri(path);
        if let Some(content_type) = content_type {
            request = request.header("content-type", content_type);
        }
        match auth {
            Auth::User(index) => {
                let token = macro_auth::macro_api_token::encode_macro_api_token(
                    macro_auth::macro_api_token::EncodeMacroApiTokenArgs {
                        fusionauth_id: self.fixture.fusion[index].clone(),
                        macro_user_id: self.fixture.users[index].clone(),
                        organization_id: None,
                        issuer: "parity".into(),
                        private_key: super::PRIVATE_KEY.into(),
                        expiry_seconds: 3600,
                        agent_id: None,
                        agent_via: None,
                        agent_correlation_id: None,
                        agent_session_id: None,
                        routine_id: None,
                    },
                )
                .expect("fixture token");
                request = request.header("authorization", format!("Bearer {token}"));
            }
            Auth::Internal => {
                request = request
                    .header("x-internal-auth-key", "parity")
                    .header("x-internal-macro-user-id", &self.fixture.users[0])
                    .header("x-internal-fusionauth-user-id", &self.fixture.fusion[0]);
            }
            Auth::InvalidBearer => {
                request = request.header("authorization", "Bearer parity-invalid-jwt");
            }
            Auth::InternalKeyOnly => {
                request = request.header("x-internal-auth-key", "parity");
            }
            Auth::WrongInternalKey => {
                request = request.header("x-internal-auth-key", "wrong-parity-key");
            }
            Auth::MissingInternalKey => {
                request = request.header("x-internal-macro-user-id", &self.fixture.users[0]);
            }
            Auth::MissingCredentials => {}
        }
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let request = request.body(wire_body).expect("request");
        let (recording, span) = capture::start();
        let response = capture::scope(
            recording.clone(),
            async {
                let response = self
                    .app
                    .clone()
                    .oneshot(request)
                    .await
                    .expect("router request");
                let status = response.status().as_u16();
                // Every response header is behavior. Only values generated per
                // request are masked, so their presence stays pinned.
                let mut headers = std::collections::BTreeMap::<String, Vec<String>>::new();
                for (name, value) in response.headers() {
                    let value = if VOLATILE_RESPONSE_HEADERS.contains(&name.as_str()) {
                        "<volatile>".to_owned()
                    } else {
                        String::from_utf8_lossy(value.as_bytes()).into_owned()
                    };
                    headers
                        .entry(name.as_str().to_owned())
                        .or_default()
                        .push(value);
                }
                let bytes = response
                    .into_body()
                    .collect()
                    .await
                    .expect("response body")
                    .to_bytes();
                let body = serde_json::from_slice::<Value>(&bytes)
                    .unwrap_or_else(|_| json!(String::from_utf8_lossy(&bytes)));
                // Wait for real tracked publish completion before closing the step.
                let kafka = self.kafka.take().await;
                self.sql_fault.drain().await;
                (status, headers, body, kafka)
            }
            .instrument(span)
            .with_subscriber(capture::dispatch()),
        )
        .await;
        if self.drain_background {
            tokio::time::timeout(
                std::time::Duration::from_secs(20),
                capture::drain(&recording),
            )
            .await
            .expect("detached request spans drained");
        }
        capture::stop();
        let after = Snapshot::take(&self.db).await;
        let redis_after = redis::snapshot(&mut self.redis, &self.redis_scopes).await;
        let (spans, logs, sql, callsites, debug_spans) =
            recording.lock().expect("recording mutex").sections();
        let provider = self.stub.take();
        let mut sqs = std::mem::take(&mut self.sqs.lock().calls);
        for call in &mut sqs {
            if call["operation"] == "SendMessage" {
                call["request"]["DelaySeconds"] =
                    json!(call["request"]["DelaySeconds"].as_u64().unwrap_or(0));
            }
            if let Some(body) = call["request"]["MessageBody"].as_str() {
                call["request"]["MessageBody"] = serde_json::from_str(body).expect("queue JSON");
            }
            if let Some(entries) = call["request"]["Entries"].as_array_mut() {
                for entry in entries {
                    entry["DelaySeconds"] = json!(entry["DelaySeconds"].as_u64().unwrap_or(0));
                    if let Some(body) = entry["MessageBody"].as_str() {
                        entry["MessageBody"] =
                            serde_json::from_str(body).expect("queue batch JSON");
                    }
                }
            }
        }
        let mut recorded_request = json!({"method":method,"path":path,"auth":auth_name,
            "body":recorded_body,"body_format":body_format,"content-type":content_type});
        if !headers.is_empty() {
            let mut recorded_headers = std::collections::BTreeMap::<&str, Vec<Value>>::new();
            for (name, value) in headers {
                let value = std::str::from_utf8(value)
                    .map(|text| json!(text))
                    .unwrap_or_else(|_| super::http_body(value));
                recorded_headers.entry(name).or_default().push(value);
            }
            recorded_request["headers"] = json!(recorded_headers);
        }
        self.transcript.step(
            name,
            vec![
                ("request", recorded_request),
                (
                    "response",
                    json!({"status":response.0,"headers":response.1,"body":response.2}),
                ),
                ("spans", spans),
                ("logs", logs),
                ("sql", sql),
                ("provider_http", json!(provider)),
                ("sqs", json!(sqs)),
                ("kafka", json!(response.3)),
                ("redis", redis::changes(redis_before, redis_after)),
                ("db", before.changes(after)),
                ("callsites", callsites),
                ("debug_spans", debug_spans),
            ],
        );
        response.0
    }
}
