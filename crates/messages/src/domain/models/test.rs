use super::*;

#[test]
fn parent_identifiers_are_validated_and_round_trip() {
    for (kind, id) in [
        ("channel", "0194e3b0-121a-7000-8000-000000000001"),
        ("document", "legacy-document-id"),
        ("initiative", "0194e3b0-121a-7000-8000-000000000003"),
    ] {
        let parent = MessageParent::parse(kind, id).unwrap();
        assert_eq!(parent.entity_type(), kind);
        assert_eq!(parent.entity_id(), id);
        assert_eq!(
            serde_json::from_value::<MessageParent>(serde_json::to_value(&parent).unwrap())
                .unwrap(),
            parent
        );
    }
    for (kind, id) in [
        ("user", "macro|example@example.com"),
        ("channel", "not-a-uuid"),
        ("initiative", "not-a-uuid"),
        ("project", "0194e3b0-121a-7000-8000-000000000003"),
        ("email_thread", "not-a-uuid"),
        ("document", ""),
        ("document", " leading-space"),
        ("document", "control\ncharacter"),
    ] {
        assert!(MessageParent::parse(kind, id).is_err());
    }
    assert!(serde_json::from_str::<MessageParent>(r#"{"type":"document","id":""}"#).is_err());
}

#[test]
fn email_threads_are_not_message_parents() {
    let id = "0194e3b0-121a-7000-8000-000000000002";
    for kind in ["email_thread", "email"] {
        assert!(MessageParent::parse(kind, id).is_err());
        assert!(
            serde_json::from_value::<MessageParent>(serde_json::json!({
                "type": kind,
                "id": id,
            }))
            .is_err()
        );
    }
}

#[test]
fn anchors_require_a_known_kind_and_stable_uuid() {
    let mark_id = Uuid::from_u128(123);
    let anchor = ThreadAnchor::Markdown {
        mark_id,
        marked_text: None,
    };
    assert_eq!(
        serde_json::to_value(anchor).unwrap(),
        serde_json::json!({ "type": "markdown", "mark_id": mark_id })
    );
    for invalid in [
        serde_json::json!({ "type": "arbitrary", "anchor_id": mark_id }),
        serde_json::json!({ "type": "markdown", "mark_id": "DISCUSSION:old" }),
        serde_json::json!({ "type": "markdown", "mark_id": mark_id, "is_comment": false }),
    ] {
        assert!(serde_json::from_value::<ThreadAnchor>(invalid).is_err());
    }
}

#[test]
fn a_marked_text_snapshot_is_trimmed_bounded_and_optional() {
    assert_eq!(
        marked_text_snapshot("  the exact phrase  "),
        Some("the exact phrase".to_owned())
    );
    assert_eq!(marked_text_snapshot("   \n  "), None);
    // A range longer than the limit keeps its first characters and says so.
    let long = "é".repeat(MARKED_TEXT_LIMIT + 10);
    let snapshot = marked_text_snapshot(&long).unwrap();
    assert_eq!(snapshot.chars().count(), MARKED_TEXT_LIMIT + 1);
    assert!(snapshot.ends_with('\u{2026}'));
    // A range exactly at the limit is whole, so nothing claims it was cut.
    let exact = "é".repeat(MARKED_TEXT_LIMIT);
    assert_eq!(marked_text_snapshot(&exact), Some(exact));
}

#[test]
fn a_markdown_anchor_carries_its_normalized_snapshot() {
    let mark_id = Uuid::from_u128(321);
    let anchor = NewThreadAnchor::Markdown {
        mark_id,
        marked_text: Some("  anchored words  ".to_owned()),
    };
    assert_eq!(
        anchor.reference(),
        ThreadAnchor::Markdown {
            mark_id,
            marked_text: Some("anchored words".to_owned()),
        }
    );
    let blank = NewThreadAnchor::Markdown {
        mark_id,
        marked_text: Some("   ".to_owned()),
    };
    assert_eq!(
        blank.reference(),
        ThreadAnchor::Markdown {
            mark_id,
            marked_text: None,
        }
    );
}

#[test]
fn a_stored_anchor_without_a_snapshot_still_reads() {
    // Threads created or imported before snapshots existed keep only a mark id.
    let mark_id = Uuid::from_u128(456);
    let stored = serde_json::json!({ "type": "markdown", "mark_id": mark_id });
    assert_eq!(
        serde_json::from_value::<ThreadAnchor>(stored).unwrap(),
        ThreadAnchor::Markdown {
            mark_id,
            marked_text: None,
        }
    );
    let with_text =
        serde_json::json!({ "type": "markdown", "mark_id": mark_id, "marked_text": "marked" });
    assert_eq!(
        serde_json::from_value::<ThreadAnchor>(with_text).unwrap(),
        ThreadAnchor::Markdown {
            mark_id,
            marked_text: Some("marked".to_owned()),
        }
    );
}
