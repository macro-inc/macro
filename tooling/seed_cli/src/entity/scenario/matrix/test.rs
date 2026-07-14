use models_permissions::share_permission::access_level::AccessLevel;

use super::*;

fn example() -> ScenarioSpec {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("seed/scenarios/team-perms.json");
    let content = std::fs::read_to_string(path).expect("example scenario file exists");
    ScenarioSpec::parse(&content).expect("example scenario is valid")
}

fn row<'a>(rows: &'a [ExpectedRow], label: &str) -> &'a ExpectedRow {
    rows.iter()
        .find(|row| row.label == label)
        .unwrap_or_else(|| panic!("row {label} exists"))
}

fn level(rows: &[ExpectedRow], label: &str, user: &str) -> Option<AccessLevel> {
    row(rows, label).levels.get(user).copied()
}

#[test]
fn expected_matrix_covers_owner_team_channel_public_edges() {
    let spec = example();
    let rows = expected_matrix(&spec);

    // Documents.
    assert_eq!(
        level(&rows, "document:q3-plan", "alice"),
        Some(AccessLevel::Owner)
    );
    // bob and carol inherit view through the project's team share.
    assert_eq!(
        level(&rows, "document:q3-plan", "bob"),
        Some(AccessLevel::View)
    );
    assert_eq!(
        level(&rows, "document:q3-plan", "carol"),
        Some(AccessLevel::View)
    );
    assert_eq!(level(&rows, "document:q3-plan", "dave"), None);
    assert_eq!(level(&rows, "document:q3-plan", "eve"), None);

    // design-doc: dave has a direct edit share; channel share + mention give
    // eng members view; carol/eve see nothing.
    assert_eq!(
        level(&rows, "document:design-doc", "dave"),
        Some(AccessLevel::Edit)
    );
    assert_eq!(
        level(&rows, "document:design-doc", "bob"),
        Some(AccessLevel::View)
    );
    assert_eq!(level(&rows, "document:design-doc", "carol"), None);
    assert_eq!(level(&rows, "document:design-doc", "eve"), None);

    // Public document is visible to everyone.
    for user in ["alice", "bob", "carol", "dave", "eve"] {
        assert!(level(&rows, "document:handbook", user).is_some(), "{user}");
    }
    assert_eq!(
        level(&rows, "document:handbook", "eve"),
        Some(AccessLevel::View)
    );

    // Unshared document stays private.
    assert_eq!(
        level(&rows, "document:bob-notes", "bob"),
        Some(AccessLevel::Owner)
    );
    for user in ["alice", "carol", "dave", "eve"] {
        assert_eq!(level(&rows, "document:bob-notes", user), None, "{user}");
    }

    // Chats.
    assert_eq!(
        level(&rows, "chat:alice-ai", "carol"),
        Some(AccessLevel::View)
    );
    assert_eq!(level(&rows, "chat:alice-ai", "bob"), None);

    // Calls: channel members get edit, the creator's team gets view.
    assert_eq!(
        level(&rows, "call:eng-standup", "alice"),
        Some(AccessLevel::Owner)
    );
    assert_eq!(
        level(&rows, "call:eng-standup", "bob"),
        Some(AccessLevel::Edit)
    );
    assert_eq!(
        level(&rows, "call:eng-standup", "carol"),
        Some(AccessLevel::View)
    );
    assert_eq!(
        level(&rows, "call:eng-standup", "dave"),
        Some(AccessLevel::Edit)
    );
    assert_eq!(level(&rows, "call:eng-standup", "eve"), None);

    // dave created dm-huddle but has no team, so no team share exists.
    assert_eq!(
        level(&rows, "call:dm-huddle", "dave"),
        Some(AccessLevel::Owner)
    );
    assert_eq!(
        level(&rows, "call:dm-huddle", "alice"),
        Some(AccessLevel::Edit)
    );
    assert_eq!(level(&rows, "call:dm-huddle", "bob"), None);

    // Email: owner and delegate both act as owners; nobody else sees it.
    assert_eq!(
        level(&rows, "email:alice-inbox/welcome", "alice"),
        Some(AccessLevel::Owner)
    );
    assert_eq!(
        level(&rows, "email:alice-inbox/welcome", "bob"),
        Some(AccessLevel::Owner)
    );
    assert_eq!(level(&rows, "email:alice-inbox/welcome", "carol"), None);

    // Channels resolve to view for active participants only.
    assert_eq!(level(&rows, "channel:eng", "dave"), Some(AccessLevel::View));
    assert_eq!(level(&rows, "channel:eng", "carol"), None);
    assert_eq!(
        level(&rows, "channel:acme-hq", "carol"),
        Some(AccessLevel::View)
    );
    assert_eq!(level(&rows, "channel:acme-hq", "dave"), None);
}

#[test]
fn expected_matrix_row_count_matches_entities() {
    let spec = example();
    let rows = expected_matrix(&spec);
    let email_threads: usize = spec.emails.values().map(|a| a.threads.len()).sum();
    let expected = spec.channels.len()
        + spec.projects.len()
        + spec.documents.len()
        + spec.chats.len()
        + spec.calls.len()
        + email_threads;
    assert_eq!(rows.len(), expected);
}
