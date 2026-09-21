use super::*;

#[test]
fn legacy_claude_links_are_derived_without_changing_other_providers() {
    let mut external = ExternalSession {
        provider: "claude-cloud".into(),
        external_id: "cse_demo".into(),
        external_name: None,
        external_url: None,
        last_run_id: None,
    };
    assert_eq!(
        external.web_url().as_deref(),
        Some("https://claude.ai/code/cse_demo")
    );
    external.external_id = "cse_x/../../other".into();
    assert!(external.web_url().is_none());
    external.provider = "claude-cloud-create-pending".into();
    external.external_id = "cse_demo".into();
    assert!(external.web_url().is_none());
    external.provider = "cursor".into();
    assert!(external.web_url().is_none());
    external.external_url = Some("https://cursor.com/agents/bc-test".into());
    assert_eq!(external.web_url(), external.external_url);
}
