use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use async_trait::async_trait;
use cognition::domain::{
    Cognition, DecisionRequest, DecisionResponse, GenerateObjectRequest, GenerateObjectResponse,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde_json::json;

use super::{AutoModelSelector, DefaultAutoModel, HIGH_MODEL, JevAutoModel, MID_MODEL};

const GEMINI: &str = "google/gemini-3.8-flash";

enum Answer {
    Probabilities(&'static [(&'static str, f32)]),
    Fails,
    Hangs,
}

struct FakeCognition {
    answer: Answer,
    seen: Mutex<Vec<DecisionRequest>>,
}

#[async_trait]
impl Cognition for FakeCognition {
    async fn generate_object(
        &self,
        _: &MacroUserIdStr<'static>,
        _: GenerateObjectRequest,
    ) -> Result<GenerateObjectResponse, Report> {
        panic!("choosing a model must not generate text")
    }

    async fn decide(
        &self,
        _: &MacroUserIdStr<'static>,
        request: DecisionRequest,
    ) -> Result<DecisionResponse, Report> {
        self.seen.lock().unwrap().push(request);
        match self.answer {
            Answer::Probabilities(probabilities) => Ok(DecisionResponse {
                probabilities: probabilities
                    .iter()
                    .map(|(key, probability)| ((*key).to_owned(), *probability))
                    .collect(),
            }),
            Answer::Fails => {
                Err(Report::new_sendsync(std::io::Error::other("jev is down")).into_dynamic())
            }
            Answer::Hangs => {
                tokio::time::sleep(Duration::from_secs(60)).await;
                unreachable!("the selector times out first")
            }
        }
    }
}

fn selector(answer: Answer) -> (JevAutoModel, Arc<FakeCognition>) {
    let cognition = Arc::new(FakeCognition {
        answer,
        seen: Mutex::default(),
    });
    (JevAutoModel::new(cognition.clone()), cognition)
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@macro.com").unwrap()
}

#[tokio::test]
async fn a_hard_prompt_escalates_to_opus() {
    let (selector, cognition) = selector(Answer::Probabilities(&[("high", 0.9), ("simple", 0.6)]));

    let model = selector
        .select(&owner(), "Prove the scheduler cannot deadlock")
        .await;

    assert_eq!(model, HIGH_MODEL);
    assert_eq!(HIGH_MODEL, "anthropic/claude-opus-5-5");
    let seen = cognition.seen.lock().unwrap();
    assert_eq!(
        seen[0].input,
        json!({ "request": "Prove the scheduler cannot deadlock" })
    );
    assert_eq!(
        seen[0].questions.keys().collect::<Vec<_>>(),
        vec!["high", "simple"]
    );
}

#[tokio::test]
async fn a_simple_prompt_stays_on_gemini() {
    let (selector, _) = selector(Answer::Probabilities(&[("high", 0.03), ("simple", 0.98)]));

    assert_eq!(selector.select(&owner(), "hi").await, GEMINI);
}

#[tokio::test]
async fn an_ordinary_prompt_runs_on_sol() {
    let (selector, _) = selector(Answer::Probabilities(&[("high", 0.2), ("simple", 0.3)]));

    assert_eq!(
        selector.select(&owner(), "Summarize this doc").await,
        MID_MODEL
    );
    assert_eq!(MID_MODEL, "openai/gpt-6.1-sol");
}

#[tokio::test]
async fn a_missing_answer_stays_on_gemini() {
    let (selector, _) = selector(Answer::Probabilities(&[("high", 0.9)]));

    assert_eq!(selector.select(&owner(), "hi").await, GEMINI);
}

#[tokio::test]
async fn a_failed_decision_stays_on_gemini() {
    let (selector, _) = selector(Answer::Fails);

    assert_eq!(selector.select(&owner(), "hi").await, GEMINI);
}

#[tokio::test(start_paused = true)]
async fn a_slow_decision_stays_on_gemini() {
    let (selector, _) = selector(Answer::Hangs);

    assert_eq!(selector.select(&owner(), "hi").await, GEMINI);
}

#[tokio::test]
async fn without_cognition_auto_is_gemini() {
    assert_eq!(DefaultAutoModel.select(&owner(), "hi").await, GEMINI);
}
