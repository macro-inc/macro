use super::*;

const KINDS: [CallKind; 3] = [
    CallKind::Huddle,
    CallKind::InternalMeeting,
    CallKind::ExternalMeeting,
];

fn only(kind: CallKind) -> CallKinds {
    CallKinds {
        huddles: kind == CallKind::Huddle,
        internal_meetings: kind == CallKind::InternalMeeting,
        external_meetings: kind == CallKind::ExternalMeeting,
    }
}

#[test]
fn untouched_settings_record_every_call() {
    let rules = RecordingRules::default();
    for kind in KINDS {
        assert!(rules.records(kind), "{kind:?} should record");
    }
}

#[test]
fn a_call_records_only_when_chosen_by_default_and_not_blocked() {
    for kind in KINDS {
        for other in KINDS {
            let chosen = RecordingRules {
                record_by_default: only(kind),
                blocked: CallKinds::NONE,
            };
            assert_eq!(chosen.records(other), kind == other);

            let blocked = RecordingRules {
                record_by_default: CallKinds::ALL,
                blocked: only(kind),
            };
            assert_eq!(blocked.records(other), kind != other);
        }
    }
}

#[test]
fn clearing_every_default_turns_recording_off() {
    let rules = RecordingRules {
        record_by_default: CallKinds::NONE,
        blocked: CallKinds::NONE,
    };
    for kind in KINDS {
        assert!(!rules.records(kind));
    }
}

#[test]
fn a_team_block_overrides_a_personal_default() {
    let rules = RecordingRules {
        record_by_default: CallKinds::ALL,
        blocked: CallKinds::ALL,
    };
    for kind in KINDS {
        assert!(!rules.records(kind));
    }
}

#[test]
fn a_patch_changes_only_the_kinds_it_names() {
    let patched = CallKinds::ALL.patched(CallKindsPatch {
        external_meetings: Some(false),
        ..CallKindsPatch::default()
    });
    assert_eq!(
        patched,
        CallKinds {
            huddles: true,
            internal_meetings: true,
            external_meetings: false,
        }
    );
    assert_eq!(patched.patched(CallKindsPatch::default()), patched);
}

#[test]
fn patches_read_camel_case_and_allow_omitted_kinds() {
    let request: UpdateTeamRecordingPolicyRequest =
        serde_json::from_str(r#"{"blocked":{"internalMeetings":true}}"#).unwrap();
    assert_eq!(
        request.blocked,
        CallKindsPatch {
            internal_meetings: Some(true),
            ..CallKindsPatch::default()
        }
    );
}

#[test]
fn settings_serialize_camel_case() {
    let settings = CallRecordingSettings {
        record_by_default: only(CallKind::Huddle),
        team: Some(TeamRecordingPolicy {
            blocked: only(CallKind::ExternalMeeting),
            can_edit: false,
        }),
    };
    assert_eq!(
        serde_json::to_value(settings).unwrap(),
        serde_json::json!({
            "recordByDefault": {
                "huddles": true,
                "internalMeetings": false,
                "externalMeetings": false,
            },
            "team": {
                "blocked": {
                    "huddles": false,
                    "internalMeetings": false,
                    "externalMeetings": true,
                },
                "canEdit": false,
            },
        })
    );
}
