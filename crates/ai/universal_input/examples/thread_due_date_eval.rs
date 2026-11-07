//! Run the labelled thread suite through the real model and report precision and
//! recall. See `eval/README.md`. Needs the model router's provider keys in the
//! environment; never run it over real mail.
use ai_billing::DisabledAiAdmissionService;
use ai_usage::NoOpUsageRecorder;
use chrono::NaiveDate;
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use universal_input::domain::temporal::thread_due_date::{
    ThreadDueDateRequest, ThreadDueDateService, ThreadMessage,
};
use universal_input::outbound::thread_due_date::AgentThreadFactExtractor;
use uuid::Uuid;

const SUITE: &str = include_str!("../eval/thread_due_dates.json");

#[derive(Deserialize)]
struct Suite {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    name: String,
    subject: Option<String>,
    messages: Vec<ThreadMessage>,
    expected_due_on: Option<NaiveDate>,
}

#[tokio::main]
async fn main() {
    let suite: Suite = serde_json::from_str(SUITE).expect("the suite is valid JSON");
    let owner = MacroUserIdStr::try_from_email("eval@example.test").expect("a valid address");
    let service = ThreadDueDateService::new(
        AgentThreadFactExtractor::new(Arc::new(NoOpUsageRecorder)),
        Arc::new(DisabledAiAdmissionService),
    );
    let (mut correct, mut wrong_date, mut invented, mut missed, mut failed) = (0, 0, 0, 0, 0);
    let mut results = Vec::new();
    for case in suite.cases {
        let answer = service
            .due_date(
                owner.clone(),
                ThreadDueDateRequest {
                    thread_id: Uuid::now_v7(),
                    subject: case.subject,
                    messages: case.messages,
                },
            )
            .await;
        // An answer that fails validation stores no date, so it scores as none.
        let got = answer.as_ref().ok().and_then(|response| response.due_on);
        if answer.is_err() {
            failed += 1;
        }
        let verdict = match (case.expected_due_on, got) {
            (expected, got) if expected == got => {
                if expected.is_some() {
                    correct += 1;
                }
                "ok"
            }
            (Some(_), Some(_)) => {
                wrong_date += 1;
                "wrong date"
            }
            (None, Some(_)) => {
                invented += 1;
                "invented"
            }
            (Some(_), None) => {
                missed += 1;
                "missed"
            }
            (None, None) => "ok",
        };
        results.push(json!({
            "name": case.name,
            "expected": case.expected_due_on,
            "got": got,
            "verdict": verdict,
            "rejected_answer": answer.is_err(),
        }));
    }
    let answered: u32 = correct + wrong_date + invented;
    let labelled: u32 = correct + wrong_date + missed;
    let report = json!({
        "results": results,
        "correct": correct,
        "wrong_date": wrong_date,
        "invented": invented,
        "missed": missed,
        "rejected_answers": failed,
        "precision": f64::from(correct) / f64::from(answered.max(1)),
        "recall": f64::from(correct) / f64::from(labelled.max(1)),
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&report).expect("JSON values serialize")
    );
}
