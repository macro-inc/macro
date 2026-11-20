//! Run the labelled thread suite through the real model and report precision and
//! recall for due dates and event days, and what the reads took. See
//! `eval/README.md`. Needs the model router's provider keys in the environment;
//! never run it over real mail.
use ai_billing::DisabledAiAdmissionService;
use ai_usage::NoOpUsageRecorder;
use chrono::NaiveDate;
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{sync::Arc, time::Instant};
use universal_input::domain::temporal::thread_due_date::{
    ThreadDueDateRequest, ThreadDueDateService, ThreadMessage,
};
use universal_input::outbound::thread_due_date::AgentThreadFactExtractor;
use uuid::Uuid;

const SUITE: &str = include_str!("../eval/thread_due_dates.json");
/// The model's price in US dollars per million tokens, as the usage journal's
/// pricing table seeds it (`20260925042500` and `20261005221204`).
const INPUT_PRICE: f64 = 0.05;
const OUTPUT_PRICE: f64 = 0.20;
const CACHE_READ_PRICE: f64 = 0.01;

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
    #[serde(default)]
    expected_event_on: Option<NaiveDate>,
}

/// How one kind of date scored across the suite.
#[derive(Default)]
struct Score {
    correct: u32,
    wrong_date: u32,
    invented: u32,
    missed: u32,
}

impl Score {
    fn add(&mut self, expected: Option<NaiveDate>, got: Option<NaiveDate>) -> &'static str {
        match (expected, got) {
            (expected, got) if expected == got => {
                if expected.is_some() {
                    self.correct += 1;
                }
                "ok"
            }
            (Some(_), Some(_)) => {
                self.wrong_date += 1;
                "wrong date"
            }
            (None, Some(_)) => {
                self.invented += 1;
                "invented"
            }
            (Some(_), None) => {
                self.missed += 1;
                "missed"
            }
            (None, None) => "ok",
        }
    }

    fn report(&self) -> Value {
        let answered = self.correct + self.wrong_date + self.invented;
        let labelled = self.correct + self.wrong_date + self.missed;
        json!({
            "correct": self.correct,
            "wrong_date": self.wrong_date,
            "invented": self.invented,
            "missed": self.missed,
            "precision": f64::from(self.correct) / f64::from(answered.max(1)),
            "recall": f64::from(self.correct) / f64::from(labelled.max(1)),
        })
    }
}

#[tokio::main]
async fn main() {
    let suite: Suite = serde_json::from_str(SUITE).expect("the suite is valid JSON");
    let owner = MacroUserIdStr::try_from_email("eval@example.test").expect("a valid address");
    let service = ThreadDueDateService::new(
        AgentThreadFactExtractor::new(Arc::new(NoOpUsageRecorder)),
        Arc::new(DisabledAiAdmissionService),
    );
    let (mut due, mut event) = (Score::default(), Score::default());
    let (mut failed, mut calls) = (0_u32, 0_u32);
    let (mut input_tokens, mut output_tokens, mut cache_read_tokens) = (0_u64, 0_u64, 0_u64);
    let mut latencies = Vec::new();
    let mut results = Vec::new();
    for case in suite.cases {
        calls += 1;
        let started = Instant::now();
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
        latencies.push(started.elapsed().as_millis());
        // An answer that fails validation stores no date, so it scores as none.
        let response = answer.as_ref().ok();
        if answer.is_err() {
            failed += 1;
        }
        if let Some(usage) = response.and_then(|response| response.usage.as_ref()) {
            input_tokens += usage.input_tokens;
            output_tokens += usage.output_tokens;
            cache_read_tokens += usage.cache_read_tokens;
        }
        let got_due = response.and_then(|response| response.due_on);
        let got_event = response.and_then(|response| response.event_on);
        results.push(json!({
            "name": case.name,
            "expected_due_on": case.expected_due_on,
            "due_on": got_due,
            "due_verdict": due.add(case.expected_due_on, got_due),
            "expected_event_on": case.expected_event_on,
            "event_on": got_event,
            "event_verdict": event.add(case.expected_event_on, got_event),
            "rejected_answer": answer.is_err(),
        }));
    }
    latencies.sort_unstable();
    let cost = (input_tokens as f64 * INPUT_PRICE
        + output_tokens as f64 * OUTPUT_PRICE
        + cache_read_tokens as f64 * CACHE_READ_PRICE)
        / 1_000_000.0;
    let report = json!({
        "results": results,
        "due_dates": due.report(),
        "events": event.report(),
        "calls": calls,
        "rejected_answers": failed,
        "failure_rate": f64::from(failed) / f64::from(calls.max(1)),
        "tokens": {
            "input": input_tokens,
            "output": output_tokens,
            "cache_read": cache_read_tokens,
            "input_per_call": input_tokens / u64::from(calls.max(1)),
            "output_per_call": output_tokens / u64::from(calls.max(1)),
        },
        "cost_usd": cost,
        "cost_usd_per_1000_calls": cost * 1000.0 / f64::from(calls.max(1)),
        "latency_ms": {
            "median": latencies.get(latencies.len() / 2),
            "max": latencies.last(),
        },
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&report).expect("JSON values serialize")
    );
}
