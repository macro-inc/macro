use super::{ChannelLabel, ChannelLabelsScope, SmartTagChannelMatch};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

#[test]
fn shared_labels_accept_only_channels_owned_by_their_team() {
    let team_id = Uuid::now_v7();
    let scope = ChannelLabelsScope::Team(team_id);

    assert!(scope.can_label_channel("team", Some(team_id)));
    assert!(!scope.can_label_channel("team", Some(Uuid::now_v7())));
    assert!(!scope.can_label_channel("direct_message", None));
}

#[test]
fn private_labels_accept_team_channels_and_reject_direct_messages() {
    let user_id = MacroUserIdStr::try_from("macro|labels@macro.com".to_owned()).unwrap();
    let scope = ChannelLabelsScope::User(user_id);

    assert!(scope.can_label_channel("team", Some(Uuid::now_v7())));
    assert!(!scope.can_label_channel("direct_message", None));
}

#[test]
fn personal_scope_accepts_visible_channel_types_except_dms() {
    let user = MacroUserIdStr::try_from("macro|personal@macro.com".to_owned()).unwrap();
    let scope = ChannelLabelsScope::User(user);
    for channel_type in ["team", "public", "private"] {
        assert!(scope.can_label_channel(channel_type, None));
    }
    assert!(!scope.can_label_channel("direct_message", None));
}

#[test]
fn legacy_responses_omit_section_only_fields() {
    let legacy = ChannelLabel {
        id: Uuid::now_v7(),
        team_id: None,
        name: "Legacy".into(),
        rule: None,
        sort_order: 0.0,
        channel_ids: Vec::new(),
        explicit_channel_ids: None,
        channel_count: 0,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    let serialized = serde_json::to_value(&legacy).unwrap();
    assert!(serialized.get("explicitChannelIds").is_none());
    let section = ChannelLabel {
        explicit_channel_ids: Some(Vec::new()),
        ..legacy
    };
    let serialized = serde_json::to_value(&section).unwrap();
    assert_eq!(serialized["explicitChannelIds"], serde_json::json!([]));
    let legacy_match = SmartTagChannelMatch {
        id: Uuid::now_v7(),
        name: "General".into(),
        is_participant: None,
    };
    assert!(
        serde_json::to_value(&legacy_match)
            .unwrap()
            .get("isParticipant")
            .is_none()
    );
    let section_match = SmartTagChannelMatch {
        is_participant: Some(false),
        ..legacy_match
    };
    assert_eq!(
        serde_json::to_value(&section_match).unwrap()["isParticipant"],
        false
    );
}
