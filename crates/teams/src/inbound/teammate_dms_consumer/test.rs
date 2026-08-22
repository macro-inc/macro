use super::*;
use crate::domain::{
    events::{
        TeamJoinMethod, TeamMemberJoinedMetadata, TeamMemberRemovedMetadata, TeamUpdatedMetadata,
    },
    model::TeamRole,
    teammate_dms::TeammateDmError,
};
use channels::domain::dm::EnsureDmsSummary;
use macro_event_broker::{Event, MacroEvent as _, MacroEventCollection as _, MessageParts};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Clone, Default)]
struct RecordingTeammateDms {
    calls: Arc<Mutex<Vec<(Uuid, String)>>>,
    error: Option<fn() -> TeammateDmError>,
}

impl TeammateDmService for RecordingTeammateDms {
    fn ensure_for_joined_member(
        &self,
        team_id: &Uuid,
        member_id: &MacroUserIdStr<'_>,
    ) -> impl std::future::Future<Output = Result<EnsureDmsSummary, TeammateDmError>> + Send {
        self.calls
            .lock()
            .unwrap()
            .push((*team_id, member_id.as_ref().to_string()));
        let error = self.error.map(|make_error| make_error());
        async move {
            match error {
                Some(error) => Err(error),
                None => Ok(EnsureDmsSummary::default()),
            }
        }
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

fn team_id() -> Uuid {
    Uuid::parse_str("3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90").unwrap()
}

fn member_joined() -> TeamTopicEvent {
    TeamTopicEvent::MemberJoined(TeamMemberJoinedMetadata {
        team_id: team_id(),
        member_id: user("macro|joiner@acme.com"),
        role: TeamRole::Member,
        join_method: TeamJoinMethod::DomainAutoJoin,
    })
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
        DeclaredMacroEvent::TeamMacroEvent(event) => {
            assert_eq!(event.event().event, member_joined());
        }
    }
}

#[tokio::test]
async fn member_joined_calls_the_service() {
    let service = RecordingTeammateDms::default();

    handle_team_event(&service, &member_joined()).await.unwrap();

    assert_eq!(
        service.calls.lock().unwrap().clone(),
        vec![(team_id(), "macro|joiner@acme.com".to_string())]
    );
}

#[tokio::test]
async fn other_team_events_are_ignored() {
    let service = RecordingTeammateDms::default();

    handle_team_event(
        &service,
        &TeamTopicEvent::Updated(TeamUpdatedMetadata {
            team_id: team_id(),
            actor_user_id: user("macro|admin@acme.com"),
            name: Some("Acme".to_string()),
            slug: None,
        }),
    )
    .await
    .unwrap();
    handle_team_event(
        &service,
        &TeamTopicEvent::MemberRemoved(TeamMemberRemovedMetadata {
            team_id: team_id(),
            member_id: user("macro|joiner@acme.com"),
            removed_by: user("macro|admin@acme.com"),
            role: TeamRole::Member,
        }),
    )
    .await
    .unwrap();

    assert!(service.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn missing_team_is_not_transient() {
    let service = RecordingTeammateDms {
        error: Some(|| TeammateDmError::TeamDoesNotExist),
        ..Default::default()
    };

    handle_team_event(&service, &member_joined())
        .await
        .unwrap_err();
    assert_eq!(service.calls.lock().unwrap().len(), 1);
}
