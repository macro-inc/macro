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
    // erin is a full-edit-access teammate: direct edit share on Alice's docs.
    assert_eq!(
        level(&rows, "document:q3-plan", "erin"),
        Some(AccessLevel::Edit)
    );
    assert_eq!(
        level(&rows, "document:design-doc", "erin"),
        Some(AccessLevel::Edit)
    );
    assert_eq!(
        level(&rows, "document:handbook", "erin"),
        Some(AccessLevel::Edit)
    );

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
fn mentions_grant_channel_view_to_projects_and_calls() {
    let spec = ScenarioSpec::parse(
        &serde_json::json!({
            "scenario": "mention-check",
            "users": {
                "owner": { "email": "owner@x.local" },
                "peer": { "email": "peer@x.local" },
                "member": { "email": "member@x.local" }
            },
            "channels": {
                "dm": { "type": "direct_message", "members": ["owner", "peer"] },
                "room": { "type": "private", "owner": "owner", "members": ["member"] }
            },
            "projects": { "plans": { "owner": "owner" } },
            "calls": { "huddle": { "channel": "dm", "created_by": "owner" } },
            "messages": [
                { "channel": "room", "from": "owner", "text": "fyi",
                  "mentions": ["project:plans", "call:huddle"] }
            ]
        })
        .to_string(),
    )
    .unwrap();
    let rows = expected_matrix(&spec);

    // `member` is only in `room`; the mentions there grant view on both the
    // project and the call, mirroring what seeding the message does.
    assert_eq!(
        level(&rows, "project:plans", "member"),
        Some(AccessLevel::View)
    );
    assert_eq!(
        level(&rows, "call:huddle", "member"),
        Some(AccessLevel::View)
    );

    // The call's own channel keeps edit; the mention's view doesn't lower it.
    assert_eq!(level(&rows, "call:huddle", "peer"), Some(AccessLevel::Edit));
    assert_eq!(
        level(&rows, "call:huddle", "owner"),
        Some(AccessLevel::Owner)
    );

    // `peer` isn't in `room`, so the mention grants them nothing.
    assert_eq!(level(&rows, "project:plans", "peer"), None);
}

#[test]
fn expected_matrix_row_count_matches_entities() {
    let spec = example();
    let rows = expected_matrix(&spec);
    let email_threads: usize = spec.emails.values().map(|a| a.threads.len()).sum();
    let expected = spec.channels.len()
        + spec.projects.len()
        + spec.documents.len()
        + spec.tasks.len()
        + spec.chats.len()
        + spec.calls.len()
        + email_threads;
    assert_eq!(rows.len(), expected);
}

#[test]
fn task_expectations_cover_team_share_and_inheritance() {
    let spec = example();
    let rows = expected_matrix(&spec);

    // ship-tags: alice owns it; the team gets comment via share_with_team;
    // the project's team view is subsumed by comment; dave/eve see nothing.
    // erin is an assignee, but her edit comes from the direct share, not the
    // assignment.
    assert_eq!(
        level(&rows, "task:ship-tags", "alice"),
        Some(AccessLevel::Owner)
    );
    assert_eq!(
        level(&rows, "task:ship-tags", "bob"),
        Some(AccessLevel::Comment)
    );
    assert_eq!(
        level(&rows, "task:ship-tags", "carol"),
        Some(AccessLevel::Comment)
    );
    assert_eq!(level(&rows, "task:ship-tags", "dave"), None);
    assert_eq!(level(&rows, "task:ship-tags", "eve"), None);
    // erin has a direct edit share, which wins over the team's comment.
    assert_eq!(
        level(&rows, "task:ship-tags", "erin"),
        Some(AccessLevel::Edit)
    );

    // fix-perms: dave's personal task shared to the eng channel; assigning
    // alice grants nothing by itself — her view comes from the channel.
    assert_eq!(
        level(&rows, "task:fix-perms", "dave"),
        Some(AccessLevel::Owner)
    );
    assert_eq!(
        level(&rows, "task:fix-perms", "alice"),
        Some(AccessLevel::View)
    );
    assert_eq!(level(&rows, "task:fix-perms", "carol"), None);

    // write-docs: alice owns it, carol is the assignee and sees it through
    // the team share.
    assert_eq!(
        level(&rows, "task:write-docs", "alice"),
        Some(AccessLevel::Owner)
    );
    assert_eq!(
        level(&rows, "task:write-docs", "carol"),
        Some(AccessLevel::Comment)
    );
    assert_eq!(level(&rows, "task:write-docs", "dave"), None);
    assert_eq!(
        level(&rows, "task:write-docs", "erin"),
        Some(AccessLevel::Edit)
    );
}
