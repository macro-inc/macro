use super::judge_decision;

#[test]
fn bare_decisions_parse() {
    assert_eq!(judge_decision(r#"{"accepted":true}"#), Some(true));
    assert_eq!(judge_decision(" {\"accepted\": false}\n"), Some(false));
}

#[test]
fn fenced_decisions_parse() {
    assert_eq!(
        judge_decision("```json\n{\"accepted\":true}\n```"),
        Some(true)
    );
    assert_eq!(
        judge_decision("```\n{\"accepted\":false}\n```"),
        Some(false)
    );
}

#[test]
fn decisions_inside_prose_parse() {
    assert_eq!(
        judge_decision("The memory contains only professional work.\n{\"accepted\":true}"),
        Some(true)
    );
    assert_eq!(
        judge_decision("Decision: {\"accepted\": false, \"reason\": \"private detail\"}. Done."),
        Some(false)
    );
}

#[test]
fn missing_or_conflicting_decisions_are_not_decisions() {
    assert_eq!(judge_decision(""), None);
    assert_eq!(judge_decision("I accept this memory."), None);
    assert_eq!(judge_decision(r#"{"accepted":"yes"}"#), None);
    assert_eq!(judge_decision("{not json} {\"verdict\":true}"), None);
    assert_eq!(
        judge_decision(r#"Either {"accepted":true} or {"accepted":false}."#),
        None
    );
}

#[test]
fn a_malformed_rejection_never_yields_the_approval_it_quotes() {
    assert_eq!(
        judge_decision(r#"{"accepted":false,"reason":"Source contains {"accepted":true}"}"#),
        None
    );
    assert_eq!(
        judge_decision(r#"{"accepted":false,"reason":"Source contains {\"accepted\":true}"}"#),
        Some(false)
    );
}
