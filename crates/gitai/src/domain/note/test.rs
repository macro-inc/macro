use super::*;

#[test]
fn reads_sessions_and_their_agent_ids() {
    let note = "hello.txt\n  s_5b121f435f7f3f::t_0b9acda081d542 1\n---\n{\n  \"schema_version\": \"authorship/3.0.0\",\n  \"prompts\": {},\n  \"sessions\": {\n    \"s_5b121f435f7f3f\": {\n      \"agent_id\": {\"tool\": \"claude\", \"id\": \"11111111-1111-4111-8111-111111111111\", \"model\": \"claude-sonnet-4-5-20250929\"},\n      \"human_author\": \"Test Dev <dev@example.com>\"\n    }\n  }\n}";
    assert_eq!(
        note_sessions(note),
        vec![NoteSession {
            session_id: "s_5b121f435f7f3f".to_owned(),
            tool: Some("claude".to_owned()),
            external_session_id: Some("11111111-1111-4111-8111-111111111111".to_owned()),
            model: Some("claude-sonnet-4-5-20250929".to_owned()),
        }]
    );
}

#[test]
fn reads_legacy_prompt_entries() {
    let note = "a.rs\n  0123456789abcdef 1-3\n---\n{\"prompts\": {\"0123456789abcdef\": {\"agent_id\": {\"tool\": \"cursor\", \"id\": \"c1\", \"model\": \"m\"}}}}";
    let sessions = note_sessions(note);
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_id, "0123456789abcdef");
    assert_eq!(sessions[0].tool.as_deref(), Some("cursor"));
}

#[test]
fn a_human_only_or_malformed_note_names_no_session() {
    let human = "README.md\n  h_118bc64884c4da 1\n---\n{\"prompts\": {}, \"humans\": {\"h_118bc64884c4da\": {\"author\": \"Test Dev <dev@example.com>\"}}}";
    assert!(note_sessions(human).is_empty());
    assert!(note_sessions("no separator").is_empty());
    assert!(note_sessions("x\n---\n{not json").is_empty());
}
