use github::domain::models::{GithubWebhookRepository, GithubWebhookSender};
use serde_json::{Value, json};

use super::*;

fn delivery(
    event: &str,
    action: Option<&str>,
    repository: &str,
    bot: bool,
) -> GithubWebhookReceived {
    GithubWebhookReceived {
        delivery_id: Some("d".to_owned()),
        event: event.to_owned(),
        action: action.map(str::to_owned),
        installation_id: 1,
        repository: Some(GithubWebhookRepository {
            id: 1,
            full_name: repository.to_owned(),
        }),
        sender: Some(GithubWebhookSender {
            login: if bot { "macro[bot]" } else { "octocat" }.to_owned(),
            bot,
        }),
        payload: None,
    }
}

fn selector(value: Value) -> GithubSelector {
    serde_json::from_value(value).unwrap()
}

#[test]
fn every_list_narrows_and_empty_lists_match_all() {
    let completed_runs_in_one_repo = selector(json!({
        "events": ["workflow_run"],
        "actions": ["completed"],
        "repositories": ["Macro-Inc/macro"],
    }));

    assert!(completed_runs_in_one_repo.accepts(&delivery(
        "workflow_run",
        Some("completed"),
        "macro-inc/macro",
        false
    )));
    assert!(!completed_runs_in_one_repo.accepts(&delivery(
        "workflow_run",
        Some("requested"),
        "macro-inc/macro",
        false
    )));
    assert!(!completed_runs_in_one_repo.accepts(&delivery(
        "workflow_run",
        Some("completed"),
        "macro-inc/other",
        false
    )));
    assert!(!completed_runs_in_one_repo.accepts(&delivery("push", None, "macro-inc/macro", false)));
    assert!(selector(json!({})).accepts(&delivery("push", None, "macro-inc/macro", false)));
}

#[test]
fn an_action_list_never_matches_an_event_without_actions() {
    assert!(
        !selector(json!({ "actions": ["opened"] })).accepts(&delivery(
            "push",
            None,
            "macro-inc/macro",
            false
        ))
    );
}

#[test]
fn bots_run_a_routine_only_when_it_asks_for_them() {
    let pushes = delivery("push", None, "macro-inc/macro", true);

    assert!(!selector(json!({})).accepts(&pushes));
    assert!(selector(json!({ "includeBots": true })).accepts(&pushes));
}

#[test]
fn names_are_github_snake_case() {
    let parse = |value: Value| serde_json::from_value::<GithubSelector>(value);

    assert!(parse(json!({ "events": ["pull_request_review"] })).is_ok());
    assert!(parse(json!({ "events": ["Pull-Request"] })).is_err());
    assert!(parse(json!({ "actions": [""] })).is_err());
    assert!(parse(json!({ "repositories": ["macro"] })).is_err());
    assert!(parse(json!({ "repositories": ["macro-inc/macro/x"] })).is_err());
    assert!(parse(json!({ "repositories": [" /macro"] })).is_err());
    assert!(parse(json!({ "unknown": true })).is_err());
}
