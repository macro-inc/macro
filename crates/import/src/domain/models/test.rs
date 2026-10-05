use super::*;
use std::str::FromStr;

#[test]
fn enums_round_trip_through_strings() {
    for source in ImportSource::all() {
        assert_eq!(
            ImportSource::from_str(source.as_ref()).unwrap(),
            source,
            "source {}",
            source.as_ref()
        );
    }
    for status in [
        ImportStatus::Staged,
        ImportStatus::Importing,
        ImportStatus::Imported,
        ImportStatus::Discarded,
    ] {
        assert_eq!(
            ImportStatus::from_str(status.as_ref()).unwrap(),
            status,
            "status {}",
            status.as_ref()
        );
    }
    for initiator in [
        Initiator::Onboarding,
        Initiator::Chat,
        Initiator::Archive,
        Initiator::Manual,
    ] {
        assert_eq!(Initiator::from_str(initiator.as_ref()).unwrap(), initiator);
    }
    for run in [
        RunStatus::Running,
        RunStatus::Ready,
        RunStatus::Importing,
        RunStatus::Completed,
        RunStatus::Failed,
        RunStatus::Dismissed,
    ] {
        assert_eq!(RunStatus::from_str(run.as_ref()).unwrap(), run);
    }
}

#[test]
fn manual_initiator_uses_snake_case() {
    assert_eq!(Initiator::Manual.as_ref(), "manual");
    assert_eq!(Initiator::from_str("manual").unwrap(), Initiator::Manual);
    assert_eq!(serde_json::to_value(Initiator::Manual).unwrap(), "manual");
    assert_eq!(
        serde_json::from_value::<Initiator>(serde_json::json!("manual")).unwrap(),
        Initiator::Manual
    );
}

#[test]
fn slack_user_ids_are_validated() {
    for id in ["U0123ABCD", "W0123ABCD"] {
        assert_eq!(SlackUserId::new(id).unwrap().as_str(), id);
    }
    for id in [
        "",
        "U",
        "W",
        "C0123ABCD",
        "u0123abcd",
        "U0123abcd",
        " U0123ABCD",
        "U0123ABCD ",
        "U../123",
        "Ué",
    ] {
        assert!(SlackUserId::new(id).is_none(), "{id}");
    }
    assert!(SlackUserId::new(&format!("U{}", "A".repeat(64))).is_none());
}

#[test]
fn canonical_slack_ids_reject_names_and_wrong_namespaces() {
    for id in ["C0123456789", "GABC123", "D123", "C1"] {
        assert_eq!(SlackConversationId::new(id).unwrap().as_str(), id);
    }
    for id in [
        "",
        "C",
        "general",
        "#general",
        "#C0123456789",
        "Channels",
        " C123",
        "C123 ",
        "T123",
        "C../123",
        "Cé",
    ] {
        assert!(SlackConversationId::new(id).is_none(), "{id}");
    }
    assert!(SlackConversationId::new(&format!("C{}", "A".repeat(64))).is_none());
    assert_eq!(SlackWorkspaceId::new("T123").unwrap().as_str(), "T123");
    for id in ["", "T", "team", "Tlower", "C123", " T123"] {
        assert!(SlackWorkspaceId::new(id).is_none(), "{id}");
    }
}

#[test]
fn normalize_foreign_id_per_source() {
    // Linear: trimmed pass-through, blank means none.
    assert_eq!(
        ImportSource::Linear.normalize_foreign_id(" ENG-142 "),
        Some("ENG-142".into())
    );
    assert_eq!(ImportSource::Linear.normalize_foreign_id("  "), None);

    // Notion: page id out of the URL, both undashed-slug and dashed-UUID
    // forms, normalized to undashed lowercase; unparseable URL keys whole;
    // a bare page id passes through lowercased.
    let id = "0123456789abcdef0123456789ABCDEF";
    assert_eq!(
        ImportSource::Notion
            .normalize_foreign_id(&format!("https://www.notion.so/acme/Page-Title-{id}?pvs=4")),
        Some(id.to_lowercase())
    );
    assert_eq!(
        ImportSource::Notion
            .normalize_foreign_id("https://notion.so/01234567-89ab-cdef-0123-456789abcdef"),
        Some("0123456789abcdef0123456789abcdef".into())
    );
    assert_eq!(
        ImportSource::Notion.normalize_foreign_id("https://www.notion.so/acme/weird-page"),
        Some("https://www.notion.so/acme/weird-page".into())
    );
    assert_eq!(
        ImportSource::Notion.normalize_foreign_id(id),
        Some(id.to_lowercase())
    );

    // Slack: channel ids pass through; bare or #-prefixed names normalize
    // to a single leading # so they can't collide with a real Cxxxx id.
    assert_eq!(
        ImportSource::Slack.normalize_foreign_id("C0123456789"),
        Some("C0123456789".into())
    );
    assert_eq!(
        ImportSource::Slack.normalize_foreign_id("eng"),
        Some("#eng".into())
    );
    assert_eq!(
        ImportSource::Slack.normalize_foreign_id("#eng"),
        Some("#eng".into())
    );
}

#[test]
fn connector_slugs_preserve_single_apps_and_accept_both_slack_aliases() {
    assert_eq!(ImportSource::Linear.pipedream_app_slugs(), &["linear"]);
    assert_eq!(ImportSource::Notion.pipedream_app_slugs(), &["notion"]);
    assert_eq!(
        ImportSource::Slack.pipedream_app_slugs(),
        &["slack", "slack_v2"]
    );

    let slack = ImportSource::Slack.connector_ref();
    assert!(slack.matches_pipedream_slug("slack"));
    assert!(slack.matches_pipedream_slug("slack_v2"));
    assert!(!slack.matches_pipedream_slug("slack_bot"));
}

#[test]
fn fixed_entity_type_mapping() {
    assert_eq!(ImportSource::Linear.entity_type(), "task");
    assert_eq!(ImportSource::Notion.entity_type(), "md");
    assert_eq!(ImportSource::Slack.entity_type(), "channel");
}

#[test]
fn validate_metadata_caps_and_drops_unknown_fields() {
    let long = "x".repeat(10_000);
    let raw = serde_json::json!({
        "title": "Roadmap",
        "description": long,
        "surprise_field": "dropped",
    });
    let validated = validate_metadata(ImportSource::Linear, raw).expect("valid linear metadata");
    assert_eq!(validated["title"], "Roadmap");
    assert_eq!(
        validated["description"].as_str().unwrap().len(),
        4_000,
        "long description is capped"
    );
    assert!(validated.get("surprise_field").is_none());

    // Missing required fields error.
    assert!(validate_metadata(ImportSource::Slack, serde_json::json!({"purpose": "x"})).is_err());

    // Participant lists are capped.
    let many: Vec<_> = (0..150)
        .map(|i| serde_json::json!({"name": format!("p{i}")}))
        .collect();
    let validated = validate_metadata(
        ImportSource::Slack,
        serde_json::json!({"name": "eng", "participants": many}),
    )
    .unwrap();
    assert_eq!(validated["participants"].as_array().unwrap().len(), 100);
    assert_eq!(validated["participants"][99]["name"], "p99");
}

#[test]
fn slack_metadata_round_trips_live_membership_fields() {
    let raw = serde_json::json!({
        "name": "eng",
        "channel_id": "C0123ABCD",
        "purpose": "Engineering",
        "participants": [{"name": "Alice", "email": "alice@example.com"}],
        "member_count": 250,
        "archived": true,
        "members_resolved": true,
    });
    let validated = validate_metadata(ImportSource::Slack, raw.clone()).unwrap();
    assert_eq!(validated, raw);
    let metadata: SlackChannelMeta = serde_json::from_value(validated).unwrap();
    assert_eq!(metadata.member_count, Some(250));
    assert!(metadata.archived);
    assert!(metadata.members_resolved);
}

#[test]
fn slack_metadata_defaults_live_membership_fields() {
    let validated =
        validate_metadata(ImportSource::Slack, serde_json::json!({"name": "eng"})).unwrap();
    assert_eq!(validated["member_count"], serde_json::Value::Null);
    assert_eq!(validated["archived"], false);
    assert_eq!(validated["members_resolved"], false);
    assert_eq!(validated["participants"], serde_json::json!([]));
    let metadata: SlackChannelMeta = serde_json::from_value(validated).unwrap();
    assert_eq!(metadata.member_count, None);
    assert!(!metadata.archived);
    assert!(!metadata.members_resolved);
    assert!(metadata.participants.is_empty());
}

#[test]
fn truncation_respects_char_boundaries() {
    // A multi-byte char straddling the cap must not split.
    let s = format!("{}é", "a".repeat(299));
    let capped = truncated(s, 300);
    assert_eq!(
        capped.len(),
        299,
        "é (2 bytes) at byte 299 is dropped whole"
    );
}

#[test]
fn metadata_label_reads_title_or_name() {
    assert_eq!(
        metadata_label(ImportSource::Linear, &serde_json::json!({"title": "T"})),
        "T"
    );
    assert_eq!(
        metadata_label(ImportSource::Slack, &serde_json::json!({"name": "eng"})),
        "eng"
    );
    assert_eq!(
        metadata_label(ImportSource::Notion, &serde_json::json!({})),
        "(unnamed)"
    );
    assert_eq!(
        metadata_label(ImportSource::Notion, &serde_json::json!({"title": "  "})),
        "(unnamed)"
    );
}
