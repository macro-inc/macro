use super::*;

#[test]
fn the_inbox_lists_signal_mail_prs_listed_agents_and_projects() {
    let filter = inbox_filter();
    assert!(filter.document_filter.is_none(), "snippets are included");
    assert!(filter.email_filter.tree.is_some());
    assert!(filter.foreign_entity_filter.is_some());
    assert!(
        filter.agent_session_filter.is_some(),
        "agent sessions are opted in"
    );
    assert!(filter.initiative_filter.is_some(), "projects are opted in");
}

#[test]
fn channel_threads_are_never_groups() {
    assert!(!CANDIDATE_TYPES.contains(&EntityType::ChannelMessage));
    assert!(CANDIDATE_TYPES.contains(&EntityType::Channel));
}
