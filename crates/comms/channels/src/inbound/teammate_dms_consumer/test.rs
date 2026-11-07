use super::*;
use crate::domain::{dm::EnsureDmsSummary, ports::ChannelMutationErr};
use macro_event_broker::{Event, MacroEvent as _, MacroEventCollection as _, MessageParts};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct RecordingChannels {
    calls: Arc<Mutex<Vec<String>>>,
}

impl TeammateDirectMessages for RecordingChannels {
    fn ensure_dms(
        &self,
        command: crate::domain::dm::EnsureDms,
    ) -> impl std::future::Future<Output = Result<EnsureDmsSummary, ChannelMutationErr>> + Send
    {
        let owners = command
            .into_requests()
            .into_iter()
            .map(|request| request.owner.as_ref().to_string())
            .collect::<Vec<_>>();
        self.calls.lock().unwrap().extend(owners);
        async move { Ok(EnsureDmsSummary::default()) }
    }
}

struct TestMessage<'a> {
    topic: &'a str,
    payload: &'a [u8],
}

impl MessageParts for TestMessage<'_> {
    fn key(&self) -> Option<&str> {
        Some("3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90")
    }

    fn payload(&self) -> Option<&[u8]> {
        Some(self.payload)
    }

    fn topic(&self) -> &str {
        self.topic
    }
}

fn user(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid user id")
}

fn member_joined() -> TeamsTopicForDms {
    TeamsTopicForDms::MemberJoined(MemberJoinedEnvelope::Payload(TeammateDmsJoinedMetadata {
        member_id: user("macro|joiner@acme.com"),
        teammate_ids: vec![
            user("macro|owner@acme.com"),
            user("macro|teammate@acme.com"),
        ],
    }))
}

#[test]
fn subscribes_to_macro_teams() {
    assert_eq!(DeclaredMacroEvent::topics(), ["macro.teams"]);
}

#[test]
fn decodes_member_joined_events() {
    let payload = serde_json::to_vec(&Event::new(member_joined())).expect("serializable");
    let decoded = DeclaredMacroEvent::decode(&TestMessage {
        topic: "macro.teams",
        payload: &payload,
    })
    .expect("decodable");

    match decoded {
        DeclaredMacroEvent::TeamsMacroEventForDms(event) => {
            assert_eq!(event.event().event, member_joined());
        }
    }
}

#[test]
fn decodes_other_team_events_as_ignored() {
    let payload = serde_json::to_vec(&serde_json::json!({
        "event_id": "01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f",
        "schema_version": 1,
        "event_type": "team.updated",
        "metadata": {
            "team_id": "3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90",
            "actor_user_id": "macro|admin@acme.com",
            "name": "Acme",
            "slug": null
        }
    }))
    .expect("serializable");
    let decoded = DeclaredMacroEvent::decode(&TestMessage {
        topic: "macro.teams",
        payload: &payload,
    })
    .expect("decodable");

    match decoded {
        DeclaredMacroEvent::TeamsMacroEventForDms(event) => {
            assert!(matches!(event.event().event, TeamsTopicForDms::Other(_)));
        }
    }
}

#[test]
fn decodes_canonical_member_joined_json() {
    let payload = serde_json::to_vec(&serde_json::json!({
        "event_id": "01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f",
        "schema_version": 1,
        "event_type": "team.member_joined",
        "metadata": {
            "team_id": "3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90",
            "member_id": "macro|joiner@acme.com",
            "teammate_ids": ["macro|owner@acme.com", "macro|teammate@acme.com"],
            "role": "member",
            "join_method": { "type": "domain_auto_join" }
        }
    }))
    .expect("serializable");
    let decoded = DeclaredMacroEvent::decode(&TestMessage {
        topic: "macro.teams",
        payload: &payload,
    })
    .expect("decodable");

    match decoded {
        DeclaredMacroEvent::TeamsMacroEventForDms(event) => {
            assert_eq!(event.event().event, member_joined());
        }
    }
}

#[test]
fn missing_teammate_ids_defaults_to_empty() {
    let payload = serde_json::to_vec(&serde_json::json!({
        "event_id": "01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f",
        "schema_version": 1,
        "event_type": "team.member_joined",
        "metadata": {
            "team_id": "3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90",
            "member_id": "macro|joiner@acme.com",
            "role": "member",
            "join_method": { "type": "domain_auto_join" }
        }
    }))
    .expect("serializable");
    let decoded = DeclaredMacroEvent::decode(&TestMessage {
        topic: "macro.teams",
        payload: &payload,
    })
    .expect("decodable");

    match decoded {
        DeclaredMacroEvent::TeamsMacroEventForDms(event) => {
            assert_eq!(
                event.event().event,
                TeamsTopicForDms::MemberJoined(MemberJoinedEnvelope::Payload(
                    TeammateDmsJoinedMetadata {
                        member_id: user("macro|joiner@acme.com"),
                        teammate_ids: Vec::new(),
                    }
                ))
            );
        }
    }
}

#[tokio::test]
async fn member_joined_ensures_dms_from_payload() {
    let channels = RecordingChannels::default();

    handle_team_event(&channels, &member_joined())
        .await
        .unwrap();

    let calls = channels.calls.lock().unwrap().clone();
    assert_eq!(calls.len(), 2);
    assert!(calls.iter().all(|owner| owner == "macro|joiner@acme.com"));
}

#[tokio::test]
async fn other_team_events_are_ignored() {
    let channels = RecordingChannels::default();

    handle_team_event(
        &channels,
        &TeamsTopicForDms::Other(IgnoredTeamEvent {
            event_type: "team.updated".to_string(),
        }),
    )
    .await
    .unwrap();

    assert!(channels.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn empty_teammate_ids_is_success() {
    let channels = RecordingChannels::default();

    handle_team_event(
        &channels,
        &TeamsTopicForDms::MemberJoined(MemberJoinedEnvelope::Payload(TeammateDmsJoinedMetadata {
            member_id: user("macro|joiner@acme.com"),
            teammate_ids: Vec::new(),
        })),
    )
    .await
    .unwrap();

    assert!(channels.calls.lock().unwrap().is_empty());
}
