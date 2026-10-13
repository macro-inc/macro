use super::*;

const KINDS: [CallKind; 4] = [
    CallKind::Huddle,
    CallKind::OneOnOne,
    CallKind::InternalMeeting,
    CallKind::ExternalMeeting,
];

fn only(kind: CallKind) -> CallKinds {
    CallKinds {
        huddles: kind == CallKind::Huddle,
        one_on_ones: kind == CallKind::OneOnOne,
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
            one_on_ones: true,
            internal_meetings: true,
            external_meetings: false,
        }
    );
    assert_eq!(patched.patched(CallKindsPatch::default()), patched);
}

#[test]
fn patches_read_camel_case_and_allow_omitted_fields() {
    let request: UpdateTeamCallPolicyRequest =
        serde_json::from_str(r#"{"recordingBlocked":{"oneOnOnes":true}}"#).unwrap();
    assert_eq!(
        request,
        UpdateTeamCallPolicyRequest {
            recording_blocked: CallKindsPatch {
                one_on_ones: Some(true),
                ..CallKindsPatch::default()
            },
            huddle_sharing_blocked: None,
        }
    );
    let request: UpdateCallSettingsRequest =
        serde_json::from_str(r#"{"refuseOneOnOneRecording":true}"#).unwrap();
    assert_eq!(
        request,
        UpdateCallSettingsRequest {
            refuse_one_on_one_recording: Some(true),
            ..UpdateCallSettingsRequest::default()
        }
    );
    let request: UpdateCallSettingsRequest =
        serde_json::from_str(r#"{"shareByDefault":{"externalMeetings":"invited"}}"#).unwrap();
    assert_eq!(
        request.share_by_default,
        ShareByDefaultPatch {
            external_meetings: Some(ShareAudience::Invited),
            ..ShareByDefaultPatch::default()
        }
    );
}

#[test]
fn untouched_settings_share_each_kind_with_its_default_audience() {
    let defaults = ShareByDefault::default();
    assert_eq!(defaults.audience(CallKind::Huddle), ShareAudience::Channel);
    assert_eq!(
        defaults.audience(CallKind::OneOnOne),
        ShareAudience::Participants
    );
    assert_eq!(
        defaults.audience(CallKind::InternalMeeting),
        ShareAudience::Invited
    );
    assert_eq!(
        defaults.audience(CallKind::ExternalMeeting),
        ShareAudience::Team
    );
}

#[test]
fn each_kind_takes_only_the_audiences_it_can_have() {
    use ShareAudience::*;
    for (kind, allowed) in [
        (CallKind::Huddle, vec![Channel, Team]),
        (CallKind::OneOnOne, vec![Participants, Team]),
        (CallKind::InternalMeeting, vec![Participants, Invited, Team]),
        (CallKind::ExternalMeeting, vec![Participants, Invited, Team]),
    ] {
        for audience in [Participants, Channel, Invited, Team] {
            assert_eq!(
                kind.allows(audience),
                allowed.contains(&audience),
                "{kind:?} with {audience:?}"
            );
        }
        assert!(kind.allows(ShareByDefault::default().audience(kind)));
    }
}

#[test]
fn a_share_patch_changes_only_the_kinds_it_names_and_refuses_bad_audiences() {
    let patched = ShareByDefault::default()
        .patched(ShareByDefaultPatch {
            one_on_ones: Some(ShareAudience::Team),
            ..ShareByDefaultPatch::default()
        })
        .unwrap();
    assert_eq!(
        patched,
        ShareByDefault {
            one_on_ones: ShareAudience::Team,
            ..ShareByDefault::default()
        }
    );
    assert_eq!(
        ShareByDefault::default().patched(ShareByDefaultPatch {
            huddles: Some(ShareAudience::Participants),
            ..ShareByDefaultPatch::default()
        }),
        Err(CallKind::Huddle)
    );
    assert_eq!(
        ShareByDefault::default().patched(ShareByDefaultPatch {
            one_on_ones: Some(ShareAudience::Invited),
            ..ShareByDefaultPatch::default()
        }),
        Err(CallKind::OneOnOne)
    );
}

#[test]
fn audiences_round_trip_through_their_stored_names() {
    use ShareAudience::*;
    for audience in [Participants, Channel, Invited, Team] {
        assert_eq!(ShareAudience::from_name(audience.as_str()), Some(audience));
    }
    assert_eq!(ShareAudience::from_name("everyone"), None);
}

#[test]
fn huddles_start_shared_only_when_their_kind_goes_to_the_team_and_not_blocked() {
    let team = ShareByDefault {
        huddles: ShareAudience::Team,
        one_on_ones: ShareAudience::Team,
        ..ShareByDefault::default()
    };
    for (share_by_default, blocked, kind, shares) in [
        (team, false, CallKind::Huddle, true),
        (team, false, CallKind::OneOnOne, true),
        (team, true, CallKind::Huddle, false),
        (team, true, CallKind::OneOnOne, false),
        (ShareByDefault::default(), false, CallKind::Huddle, false),
        (ShareByDefault::default(), false, CallKind::OneOnOne, false),
    ] {
        let preferences = CallPreferences {
            share_by_default,
            huddle_sharing_blocked: blocked,
            ..CallPreferences::default()
        };
        assert_eq!(
            preferences.shares_huddle_with_team(kind),
            shares,
            "{kind:?} blocked={blocked}"
        );
    }
}

#[test]
fn untouched_preferences_record_share_by_default_and_refuse_nothing() {
    let preferences = CallPreferences::default();
    assert_eq!(preferences.recording, RecordingRules::default());
    assert_eq!(preferences.share_by_default, ShareByDefault::default());
    assert!(!preferences.huddle_sharing_blocked);
    assert!(!preferences.refuses_one_on_one_recording);
}

#[test]
fn settings_serialize_camel_case() {
    let settings = CallSettings {
        record_by_default: only(CallKind::Huddle),
        share_by_default: ShareByDefault::default(),
        refuse_one_on_one_recording: true,
        team: Some(TeamCallPolicy {
            recording_blocked: only(CallKind::ExternalMeeting),
            huddle_sharing_blocked: true,
            can_edit: false,
        }),
    };
    assert_eq!(
        serde_json::to_value(settings).unwrap(),
        serde_json::json!({
            "recordByDefault": {
                "huddles": true,
                "oneOnOnes": false,
                "internalMeetings": false,
                "externalMeetings": false,
            },
            "shareByDefault": {
                "huddles": "channel",
                "oneOnOnes": "participants",
                "internalMeetings": "invited",
                "externalMeetings": "team",
            },
            "refuseOneOnOneRecording": true,
            "team": {
                "recordingBlocked": {
                    "huddles": false,
                    "oneOnOnes": false,
                    "internalMeetings": false,
                    "externalMeetings": true,
                },
                "huddleSharingBlocked": true,
                "canEdit": false,
            },
        })
    );
}

#[test]
fn a_recorder_answers_for_every_kind_since_it_started() {
    use CallKind::{ExternalMeeting, InternalMeeting, OneOnOne};
    let attendance = |more_than_two, external| MeetingAttendance {
        more_than_two,
        external,
    };
    for (since, seen, kinds) in [
        (OneOnOne, attendance(false, false), vec![OneOnOne]),
        (
            OneOnOne,
            attendance(true, false),
            vec![OneOnOne, InternalMeeting],
        ),
        (
            OneOnOne,
            attendance(false, true),
            vec![OneOnOne, ExternalMeeting],
        ),
        (
            OneOnOne,
            attendance(true, true),
            vec![OneOnOne, InternalMeeting, ExternalMeeting],
        ),
        (
            InternalMeeting,
            attendance(true, true),
            vec![InternalMeeting, ExternalMeeting],
        ),
        (
            ExternalMeeting,
            attendance(false, true),
            vec![ExternalMeeting],
        ),
        (
            ExternalMeeting,
            attendance(true, true),
            vec![ExternalMeeting],
        ),
    ] {
        assert_eq!(seen.kinds_since(since), kinds, "{since:?} with {seen:?}");
    }
}
