use macro_event_broker::{EventPublisher, KafkaEventPublisher, TopicEvent};
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::mocking::MockCluster;
use rdkafka::{ClientConfig, Message, Offset, TopicPartitionList};
use std::time::Duration;

static SCENARIO_PATTERN: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r"#\[sqlx::test\([^\]]*\)\]\s*(?:#\[[^\]]*\]\s*)*async fn ([a-zA-Z0-9_]+)\(")
        .expect("scenario declarations")
});

fn scenario_names(source: &str) -> std::collections::BTreeSet<String> {
    static CASE_BLOCK: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?s)cases!\s*\{[^;]*;(.*?)\}").expect("case blocks")
    });
    static CASE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"\b([a-zA-Z0-9_]+),\s*[0-9]+,\s*(?:true|false),")
            .expect("case declarations")
    });
    let mut names: std::collections::BTreeSet<_> = SCENARIO_PATTERN
        .captures_iter(source)
        .map(|capture| capture[1].to_owned())
        .collect();
    for block in CASE_BLOCK.captures_iter(source) {
        names.extend(
            CASE.captures_iter(&block[1])
                .map(|capture| capture[1].to_owned()),
        );
    }
    names
}

#[test]
fn scenario_inventory_includes_explicit_worker_case_declarations() {
    let source = r#"
        #[sqlx::test(migrator = "migrations")]
        async fn ordinary(pool: PgPool) {}
        cases! { runner;
            primary_case, 100, false, Case::Example;
            retry_case, 103, true, Case::Example;
        }
        cases! { runner; inline_case, 109, true, Case::Example; }
        not_a_case, 106, false, Case::Example;
    "#;
    assert_eq!(
        scenario_names(source),
        ["inline_case", "ordinary", "primary_case", "retry_case"]
            .map(str::to_owned)
            .into()
    );
}

#[test]
fn normalization_preserves_behavior_and_reuses_runtime_id_names() {
    if !crate::parity::process_per_test() {
        return;
    }
    use super::normalize::Normalizer;
    let mut normalizer = Normalizer::default();
    normalizer.symbol("51000000-0000-0000-0000-000000000001", "<link:A>");
    let value = normalizer.value(
        "spans",
        serde_json::json!({
            "link": "51000000-0000-0000-0000-000000000001",
            "new": ["0195f0a6-8a0e-7cc2-8f39-6f0b5d6a2e10", "0195f0a6-8a0e-7cc2-8f39-6f0b5d6a2e10"],
            "created_at": "2026-11-10T09:01:02.123+00:00", "duration_ms": 234,
            "count": 11, "status": 400, "label": "Work", "message": "label not found",
        }),
    );
    assert_eq!(
        value,
        serde_json::json!({"link":"<link:A>","new":["<uuid:1>","<uuid:1>"],
        "created_at":"<ts>","duration_ms":"<volatile>","count":11,"status":400,"label":"Work","message":"label not found"})
    );
    let literal = "2026-11-10T09:01:02Z 0195f0a6-8a0e-7cc2-8f39-6f0b5d6a2e10";
    let content =
        serde_json::json!({"sql": literal, "name": literal, "provider_label_id": literal});
    assert_eq!(normalizer.value("spans", content.clone()), content);
}

#[test]
fn error_backtraces_do_not_change_transcripts() {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut normalizer = super::normalize::Normalizer::default();
    let error = "unable to write\n\nCaused by:\n    database unavailable";
    assert_eq!(
        normalizer.value(
            "logs",
            serde_json::json!(format!(
                "{error}\n\nStack backtrace:\n   0: arbitrary frame"
            ))
        ),
        serde_json::json!(error)
    );
}

#[test]
fn postgres_source_lines_do_not_change_transcripts() {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut normalizer = super::normalize::Normalizer::default();
    let error = |line: u32| {
        format!(
            "Database(PgDatabaseError {{ code: \"P0001\", file: Some(\"pl_exec.c\"), line: Some({line}), routine: Some(\"exec_stmt_raise\") }})"
        )
    };
    let expected = "Database(PgDatabaseError { code: \"P0001\", file: Some(\"pl_exec.c\"), line: Some(<postgres-source-line>), routine: Some(\"exec_stmt_raise\") })";
    for line in [3857, 3923] {
        assert_eq!(
            normalizer.value("logs", serde_json::json!(error(line))),
            serde_json::json!(expected)
        );
    }
    // Only telemetry is normalized this way; a payload keeps its text.
    assert_eq!(
        normalizer.value("response", serde_json::json!(error(3857))),
        serde_json::json!(error(3857))
    );
}

#[test]
fn no_orphan_goldens() {
    if !crate::parity::process_per_test() {
        return;
    }
    let root = super::transcript::golden_root();
    if !root.exists() {
        return;
    }
    let updating = super::transcript::updating_snapshots();
    for entry in std::fs::read_dir(&root).expect("golden suites") {
        let suite = entry.expect("suite entry").path();
        assert!(suite.is_dir(), "goldens must be grouped by suite");
        let name = suite
            .file_name()
            .expect("suite name")
            .to_str()
            .expect("UTF-8");
        let source_root = root.parent().expect("parity root").join("suites");
        let mut source = std::fs::read_to_string(source_root.join(format!("{name}.rs")))
            .expect("a source module for every golden suite");
        collect_sources(&source_root.join(name), &mut source);
        let scenarios = scenario_names(&source);
        let mut snapshots = std::collections::BTreeSet::new();
        let mut referenced = std::collections::BTreeSet::new();
        for entry in std::fs::read_dir(&suite).expect("suite goldens") {
            let path = entry.expect("golden entry").path();
            if path.is_dir() {
                assert_eq!(path.file_name().expect("directory name"), "sql");
                continue;
            }
            assert_eq!(
                path.extension().and_then(|value| value.to_str()),
                Some("snap"),
                "unexpected golden or pending snapshot {}",
                path.display()
            );
            let name = path
                .file_stem()
                .expect("golden name")
                .to_str()
                .expect("UTF-8");
            assert!(scenarios.contains(name), "orphan golden {}", path.display());
            snapshots.insert(name.to_owned());
            if !updating {
                let mut in_sql = false;
                for line in std::fs::read_to_string(&path).expect("golden text").lines() {
                    if !line.starts_with(' ') {
                        in_sql = line == "sql:";
                    } else if in_sql && line.trim() != "[]" {
                        let id = line.split_whitespace().next().expect("SQL hash");
                        assert!(
                            id.len() == 12 && id.bytes().all(|byte| byte.is_ascii_hexdigit()),
                            "invalid SQL reference in {}: {line}",
                            path.display()
                        );
                        referenced.insert(id.to_owned());
                    }
                }
            }
        }
        // A parallel updater can publish a statement before its scenario file.
        // Normal comparison runs validate the complete, stable reference set.
        if !updating {
            assert_eq!(
                snapshots,
                scenarios,
                "every scenario must have a snapshot in {}",
                suite.display()
            );
            super::transcript::assert_sql_references(&suite, referenced);
        }
    }
}

fn collect_sources(root: &std::path::Path, source: &mut String) {
    if !root.exists() {
        return;
    }
    for entry in std::fs::read_dir(root).expect("suite modules") {
        let path = entry.expect("source entry").path();
        if path.is_dir() {
            collect_sources(&path, source);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            source.push_str(&std::fs::read_to_string(path).expect("suite source"));
        }
    }
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn changed_request_is_visible_in_exactly_the_expected_section(pool: sqlx::PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    use super::lab::{Auth, Lab, LabOptions};
    let mut lab = Lab::start(
        pool,
        LabOptions {
            suite: "self_tests",
            name: "sensitivity",
            shard: 25000,
            gmail_label_write_batches: false,
        },
    )
    .await;
    #[expect(
        clippy::disallowed_methods,
        reason = "Fixture assertions use runtime queries without test SQLx cache entries"
    )]
    let provider_ids: Vec<String> = sqlx::query_scalar(
        "SELECT provider_id FROM email_messages WHERE provider_id IS NOT NULL ORDER BY provider_id",
    )
    .fetch_all(&lab.db)
    .await
    .expect("fixture provider ids");
    assert_eq!(
        provider_ids,
        lab.gmail
            .lock()
            .messages
            .keys()
            .cloned()
            .collect::<Vec<_>>(),
        "fake Gmail and database fixtures agree"
    );
    let work = lab.fixture.labels["A/Label_work"];
    lab.request(
        "invalid",
        "PATCH",
        "/email/messages/labels",
        Auth::User(0),
        super::lab::RequestBody::Json(
            serde_json::json!({"message_ids":[],"label_id":work,"value":true}),
        ),
    )
    .await;
    let first = lab.transcript.take();
    lab.request(
        "invalid",
        "PATCH",
        "/email/messages/labels",
        Auth::User(0),
        super::lab::RequestBody::Json(
            serde_json::json!({"message_ids":[],"label_id":work,"value":false}),
        ),
    )
    .await;
    let second = lab.transcript.take();
    assert_ne!(first, second);
    let after_request =
        |text: String| text[text.find("response:\n").expect("response section")..].to_string();
    assert_eq!(
        after_request(first),
        after_request(second),
        "only the request section changes for rejected request bodies"
    );
}

#[tokio::test]
async fn production_kafka_publisher_reaches_mock_cluster() {
    if !crate::parity::process_per_test() {
        return;
    }
    let cluster = MockCluster::new(1).expect("mock Kafka cluster");
    cluster
        .create_topic("macro.email", 1, 1)
        .expect("email topic");
    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", cluster.bootstrap_servers())
        .set("group.id", "parity-probe")
        .set("enable.auto.commit", "false")
        .create()
        .expect("Kafka consumer");
    let mut assignment = TopicPartitionList::new();
    assignment
        .add_partition_offset("macro.email", 0, Offset::Beginning)
        .expect("partition");
    consumer.assign(&assignment).expect("assign consumer");
    let publisher = KafkaEventPublisher::with_environment(
        &cluster.bootstrap_servers(),
        macro_env::Environment::Local,
    )
    .expect("real publisher");
    publisher
        .publish::<<email::domain::events::EmailTopicEvent as TopicEvent>::Topic>(
            "probe",
            br#"{"probe":true}"#,
        )
        .await
        .expect("production publisher delivery");
    let message = tokio::time::timeout(Duration::from_secs(10), consumer.recv())
        .await
        .expect("Kafka delivery signal")
        .expect("Kafka message");
    assert_eq!(message.key(), Some(b"probe".as_slice()));
    assert_eq!(message.payload(), Some(br#"{"probe":true}"#.as_slice()));
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn missing_credentials_return_the_exact_unauthorized_response(pool: sqlx::PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let lab = super::lab::Lab::start(
        pool,
        super::lab::LabOptions {
            suite: "self_tests",
            name: "missing_credentials_assertion",
            shard: 25003,
            gmail_label_write_batches: false,
        },
    )
    .await;
    lab.assert_missing_credentials().await;
}

#[test]
fn business_payload_fields_are_not_telemetry() {
    if !crate::parity::process_per_test() {
        return;
    }
    let body = serde_json::json!({"duration":5,"port":1,"elapsed":2,"ReceiptHandle":"literal"});
    for section in ["request", "response", "provider_http", "kafka", "db"] {
        let mut normalizer = super::normalize::Normalizer::default();
        assert_eq!(normalizer.value(section, body.clone()), body);
    }
    let mut normalizer = super::normalize::Normalizer::default();
    assert_eq!(
        normalizer.value("sqs", body),
        serde_json::json!({"duration":5,"port":1,"elapsed":2,"ReceiptHandle":"<volatile>"})
    );
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn get_query_without_a_body_is_recorded_faithfully(pool: sqlx::PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = super::lab::Lab::start(
        pool,
        super::lab::LabOptions {
            suite: "self_tests",
            name: "get_query",
            shard: 25006,
            gmail_label_write_batches: false,
        },
    )
    .await;
    assert_eq!(
        lab.request(
            "health query",
            "GET",
            "/health?probe=a%20b&limit=2",
            super::lab::Auth::User(0),
            super::lab::RequestBody::Empty
        )
        .await,
        200
    );
    let transcript = lab.transcript.take();
    let request = transcript
        .split("request:\n")
        .nth(1)
        .expect("request section")
        .split("response:\n")
        .next()
        .expect("request JSON");
    let request: serde_json::Value =
        serde_json::from_str(request.trim()).expect("recorded request");
    assert_eq!(request["path"], "/health?probe=a%20b&limit=2");
    assert_eq!(request["method"], "GET");
    assert_eq!(request["body_format"], "none");
    assert!(request["body"].is_null());
    assert!(request["content-type"].is_null());
}
