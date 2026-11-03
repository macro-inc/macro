use std::collections::BTreeMap;

use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::client::Hosts;

fn config() -> RelevanceConfig {
    RelevanceConfig::starter("Ada", "accounts payable")
}

fn probs(pairs: &[(&str, f64)]) -> BTreeMap<String, f64> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), *v)).collect()
}

#[test]
fn wakes_if_any_group_is_fully_above_threshold() {
    let config = config();
    assert!(config.is_relevant(&probs(&[("addressed_to_me", 0.9)])));
    assert!(config.is_relevant(&probs(&[("about_my_job", 0.7), ("needs_response", 0.6)])));
    assert!(!config.is_relevant(&probs(&[("about_my_job", 0.9), ("needs_response", 0.5)])));
    assert!(!config.is_relevant(&probs(&[])));
}

#[test]
fn the_starter_config_is_valid_and_round_trips() {
    let config = config();
    config.validate().unwrap();
    let text = serde_json::to_string(&config).unwrap();
    assert!(text.contains("\"wakeIf\""));
    assert_eq!(
        serde_json::from_str::<RelevanceConfig>(&text).unwrap(),
        config
    );
}

#[test]
fn validation_enforces_the_decide_limits() {
    let mut bad = config();
    bad.questions
        .insert("x".repeat(MAX_KEY_BYTES + 1), "ok?".to_owned());
    assert!(bad.validate().is_err());

    let mut bad = config();
    bad.questions
        .insert("long".to_owned(), "a".repeat(MAX_QUESTION_CHARS + 1));
    assert!(bad.validate().is_err());

    let mut bad = config();
    bad.questions = (0..=MAX_QUESTIONS)
        .map(|i| (format!("q{i}"), "ok?".to_owned()))
        .collect();
    bad.wake_if = vec![vec!["q0".to_owned()]];
    assert!(bad.validate().is_err());

    let mut bad = config();
    bad.wake_if.push(vec!["unknown".to_owned()]);
    assert!(bad.validate().is_err());

    let mut bad = config();
    bad.threshold = 1.5;
    assert!(bad.validate().is_err());
}

#[test]
fn oversized_requests_drop_the_oldest_context_first() {
    let big = "x".repeat(20 * 1024);
    let request = DecideRequest {
        input: json!({"recent_messages": [big.clone(), big.clone(), big.clone(), "newest"], "new_message": "hi"}),
        questions: config().questions,
    };
    let fitted = fit_body(request).unwrap();
    let recent = fitted.input["recent_messages"].as_array().unwrap();
    assert_eq!(recent.last().unwrap(), "newest");
    assert!(serde_json::to_vec(&fitted).unwrap().len() <= MAX_BODY_BYTES);
}

fn candidate(mentions_me: bool, direct_message: bool) -> Candidate {
    Candidate {
        message_id: "m1".to_owned(),
        mentions_me,
        direct_message,
        input: json!({"new_message": "hello"}),
    }
}

#[tokio::test]
async fn fast_paths_skip_the_model_and_decisions_are_logged() {
    let dir = tempfile::tempdir().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/decisions"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(
                json!({"probabilities": {"about_my_job": 0.9, "needs_response": 0.2}}),
            ),
        )
        .expect(1)
        .mount(&server)
        .await;
    let config_path = dir.path().join("relevance.json");
    config().save(&config_path).await.unwrap();
    let log = dir.path().join("decisions.jsonl");
    let client = MacroClient::new("k", Hosts::all_at(&server.uri())).unwrap();
    let relevance = Relevance::new(client, &config_path).log_to(&log);

    let mentioned = relevance.judge(&candidate(true, false)).await.unwrap();
    assert_eq!(
        (mentioned.relevant, mentioned.reason),
        (true, Reason::Mentioned)
    );
    let dm = relevance.judge(&candidate(false, true)).await.unwrap();
    assert_eq!((dm.relevant, dm.reason), (true, Reason::DirectMessage));
    let decided = relevance.judge(&candidate(false, false)).await.unwrap();
    assert_eq!((decided.relevant, decided.reason), (false, Reason::Decided));

    let lines: Vec<serde_json::Value> = crate::memory::read_jsonl(&log).await.unwrap();
    assert_eq!(lines.len(), 3);
    assert!(
        lines
            .iter()
            .all(|l| l.get("message_id").is_some() && l.get("text").is_none())
    );
}

#[tokio::test]
async fn fast_paths_can_be_turned_off() {
    let dir = tempfile::tempdir().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/decisions"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"probabilities": {"addressed_to_me": 0.1}})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let config_path = dir.path().join("relevance.json");
    config().save(&config_path).await.unwrap();
    let client = MacroClient::new("k", Hosts::all_at(&server.uri())).unwrap();
    let relevance = Relevance::new(client, &config_path).fast_paths(FastPaths {
        mention: false,
        direct_message: false,
    });

    let decision = relevance.judge(&candidate(true, true)).await.unwrap();
    assert!(!decision.relevant);
}
