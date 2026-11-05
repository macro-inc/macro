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
async fn asks_as_the_owner_and_reads_the_date_back() {
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
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"due_on": "2026-10-30"})))
        .expect(1)
        .mount(&harness)
        .await;

    let due_dates =
        HarnessDueDates::new(&format!("{}/agent-harness/", harness.uri()), "internal-key").unwrap();

    assert_eq!(
        due_dates
            .due_on(&owner(), thread_id, &input())
            .await
            .unwrap(),
        NaiveDate::from_ymd_opt(2026, 10, 30)
    );
}

#[tokio::test]
async fn no_deadline_reads_as_no_date() {
    let harness = MockServer::start().await;
    Mock::given(matchers::any())
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"due_on": null})))
        .mount(&harness)
        .await;
    let due_dates = HarnessDueDates::new(&harness.uri(), "internal-key").unwrap();

    assert_eq!(
        due_dates
            .due_on(&owner(), Uuid::now_v7(), &input())
            .await
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn a_failure_reports_no_mail_text() {
    let harness = MockServer::start().await;
    Mock::given(matchers::any())
        .respond_with(ResponseTemplate::new(503).set_body_string(MAIL))
        .mount(&harness)
        .await;
    let due_dates = HarnessDueDates::new(&harness.uri(), "internal-key").unwrap();

    let error = due_dates
        .due_on(&owner(), Uuid::now_v7(), &input())
        .await
        .unwrap_err();

    assert!(format!("{error:?}").contains("503"));
    assert!(!format!("{error:?}").contains("signed contract"));
}
