use chrono::NaiveDate;
use email::domain::focus::DueDateMessage;
use serde_json::json;
use wiremock::{Mock, MockServer, ResponseTemplate, matchers};

use super::*;

const MAIL: &str = "Please send the signed contract by Friday.";

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@acme.example").unwrap()
}

fn input() -> DueDateInput {
    DueDateInput {
        subject: Some("Contract".to_owned()),
        messages: vec![DueDateMessage {
            written_on: NaiveDate::from_ymd_opt(2026, 10, 27).unwrap(),
            from_owner: false,
            text: MAIL.to_owned(),
        }],
    }
}

#[tokio::test]
async fn asks_as_the_owner_and_reads_the_dates_back() {
    let harness = MockServer::start().await;
    let thread_id = Uuid::now_v7();
    Mock::given(matchers::method("POST"))
        .and(matchers::path(
            "/agent-harness/universal_input/thread-due-date",
        ))
        .and(matchers::header(INTERNAL_API_KEY_HEADER, "internal-key"))
        .and(matchers::header(
            INTERNAL_MACRO_USER_ID_HEADER,
            owner().as_ref(),
        ))
        .and(matchers::body_json(json!({
            "thread_id": thread_id,
            "subject": "Contract",
            "messages": [{"written_on": "2026-10-27", "from_owner": false, "text": MAIL}],
        })))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"due_on": "2026-10-30", "event_on": "2026-11-02"})),
        )
        .expect(1)
        .mount(&harness)
        .await;

    let (due_dates, _) = harness_at(&format!("{}/agent-harness/", harness.uri()));

    assert_eq!(
        due_dates
            .dates(&owner(), thread_id, &input())
            .await
            .unwrap(),
        ThreadDates {
            due_on: NaiveDate::from_ymd_opt(2026, 10, 30),
            event_on: NaiveDate::from_ymd_opt(2026, 11, 2),
        }
    );
}

#[tokio::test]
async fn no_deadline_or_event_reads_as_no_dates() {
    let harness = MockServer::start().await;
    Mock::given(matchers::any())
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"due_on": null})))
        .mount(&harness)
        .await;
    let (due_dates, _) = harness_at(&harness.uri());

    assert_eq!(
        due_dates
            .dates(&owner(), Uuid::now_v7(), &input())
            .await
            .unwrap(),
        ThreadDates::default()
    );
}

#[tokio::test]
async fn a_failure_reports_no_mail_text() {
    let harness = MockServer::start().await;
    Mock::given(matchers::any())
        .respond_with(ResponseTemplate::new(503).set_body_string(MAIL))
        .mount(&harness)
        .await;
    let (due_dates, metrics) = harness_at(&harness.uri());

    let error = due_dates
        .dates(&owner(), Uuid::now_v7(), &input())
        .await
        .unwrap_err();

    assert!(format!("{error:?}").contains("503"));
    assert!(!format!("{error:?}").contains("signed contract"));
    let batch = metrics.take();
    assert_eq!(batch.sums[&Metric::DueDateCalls], 1.0);
    assert_eq!(batch.sums[&Metric::DueDateFailures], 1.0);
    assert_eq!(batch.sums[&Metric::DueDateRejected], 0.0);
}

#[tokio::test]
async fn a_rejected_answer_reads_as_no_dates_and_counts_as_rejected_with_its_cost() {
    let harness = MockServer::start().await;
    Mock::given(matchers::any())
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "due_on": null,
            "event_on": null,
            "rejected": true,
            "usage": {
                "model": "fireworks/nemotron",
                "input_tokens": 2_000_000,
                "output_tokens": 1_000_000,
                "cache_read_tokens": 0,
                "cache_write_tokens": 0,
            },
        })))
        .mount(&harness)
        .await;
    let (due_dates, metrics) = harness_at(&harness.uri());

    assert_eq!(
        due_dates
            .dates(&owner(), Uuid::now_v7(), &input())
            .await
            .unwrap(),
        ThreadDates::default()
    );

    let batch = metrics.take();
    assert_eq!(batch.sums[&Metric::DueDateCalls], 1.0);
    assert_eq!(batch.sums[&Metric::DueDateFailures], 0.0);
    assert_eq!(batch.sums[&Metric::DueDateRejected], 1.0);
    // 2M input at $0.05 and 1M output at $0.20 a million.
    let cost = batch.sums[&Metric::DueDateCostUsd];
    assert!((cost - 0.3).abs() < 1e-6, "{cost}");
}

fn harness_at(base: &str) -> (HarnessDueDates, FocusMetrics) {
    let metrics = FocusMetrics::default();
    let prices = Prices::fixed([(
        "nemotron",
        ai_usage::ModelPricing::Tokens {
            input: 0.05,
            output: 0.2,
            cache_read: Some(0.01),
            cache_write: None,
        },
    )]);
    let due_dates =
        HarnessDueDates::new(base, "internal-key", metrics.clone(), Arc::new(prices)).unwrap();
    (due_dates, metrics)
}

#[tokio::test]
async fn each_ask_counts_with_the_tokens_and_cost_the_harness_reports() {
    let harness = MockServer::start().await;
    Mock::given(matchers::any())
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "due_on": null,
            "usage": {
                "model": "fireworks/nemotron",
                "input_tokens": 2_000_000,
                "output_tokens": 1_000_000,
                "cache_read_tokens": 1_000_000,
                "cache_write_tokens": 0,
            },
        })))
        .mount(&harness)
        .await;
    let (due_dates, metrics) = harness_at(&harness.uri());

    due_dates
        .dates(&owner(), Uuid::now_v7(), &input())
        .await
        .unwrap();

    let batch = metrics.take();
    assert_eq!(batch.sums[&Metric::DueDateCalls], 1.0);
    assert_eq!(batch.sums[&Metric::DueDateFailures], 0.0);
    assert_eq!(batch.sums[&Metric::DueDateInputTokens], 3_000_000.0);
    assert_eq!(batch.sums[&Metric::DueDateOutputTokens], 1_000_000.0);
    // 2M input at $0.05, 1M output at $0.20 and 1M cached at $0.01 a million.
    let cost = batch.sums[&Metric::DueDateCostUsd];
    assert!((cost - 0.31).abs() < 1e-6, "{cost}");
}
