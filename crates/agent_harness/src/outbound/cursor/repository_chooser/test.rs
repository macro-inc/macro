use super::*;

fn candidates() -> Vec<String> {
    vec![
        "https://github.com/macro-inc/macro".to_owned(),
        "https://github.com/macro-inc/infra".to_owned(),
    ]
}

#[test]
fn the_user_message_carries_candidates_recent_sessions_and_the_prompt() {
    let message = user_message("rename the button", &candidates(), &[], &candidates()[0]);
    assert!(message.contains("<candidate_repositories>\nhttps://github.com/macro-inc/macro\n"));
    assert!(message.contains("<recent_sessions>\nnone\n</recent_sessions>"));
    assert!(message.contains("<prompt>\nrename the button\n</prompt>"));
    assert!(message.contains(
        "<fallback_repository>\nhttps://github.com/macro-inc/macro\n</fallback_repository>"
    ));
}

#[test]
fn the_schema_allows_only_candidate_repositories() {
    let schema = choice_schema(&candidates());
    assert_eq!(
        schema.schema["properties"]["repository"]["enum"],
        json!(candidates()),
    );
}
