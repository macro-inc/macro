use std::sync::{Arc, Mutex};

use channels::domain::{
    dm::{EnsureDmsSummary, ensure_dms_for_joining_member},
    ports::ChannelMutationErr,
};
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::domain::model::{Team, TeamMember, TeamRole};

#[derive(Clone)]
enum RosterResponse {
    Team(TeamWithMembers),
    Missing,
    Storage,
}

#[derive(Clone)]
struct RecordingRoster {
    response: RosterResponse,
}

impl TeamRoster for RecordingRoster {
    fn team_with_members(
        &self,
        _: &Uuid,
    ) -> impl Future<Output = Result<TeamWithMembers, TeamError>> + Send {
        let response = self.response.clone();
        async move {
            match response {
                RosterResponse::Team(team) => Ok(team),
                RosterResponse::Missing => Err(TeamError::TeamDoesNotExist),
                RosterResponse::Storage => Err(TeamError::StorageLayerError(anyhow::anyhow!(
                    "roster unavailable"
                ))),
            }
        }
    }
}

#[derive(Clone, Default)]
struct RecordingChannels {
    calls: Arc<Mutex<Vec<channels::domain::dm::EnsureDms>>>,
    summary: EnsureDmsSummary,
    fail: bool,
}

impl TeammateDirectMessages for RecordingChannels {
    fn ensure_dms(
        &self,
        command: channels::domain::dm::EnsureDms,
    ) -> impl Future<Output = Result<EnsureDmsSummary, ChannelMutationErr>> + Send {
        self.calls.lock().expect("calls mutex").push(command);
        let summary = self.summary;
        let fail = self.fail;
        async move {
            if fail {
                Err(ChannelMutationErr::Repo(anyhow::anyhow!(
                    "ensure direct messages failed"
                )))
            } else {
                Ok(summary)
            }
        }
    }
}

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{email}")).unwrap()
}

fn roster(
    team_id: Uuid,
    owner: &MacroUserIdStr<'static>,
    members: &[&MacroUserIdStr<'static>],
) -> RecordingRoster {
    RecordingRoster {
        response: RosterResponse::Team(TeamWithMembers {
            team: Team::new(
                team_id,
                "DM Team".to_string(),
                "DM_TEAM".to_string(),
                owner.clone(),
                false,
                true,
            ),
            members: members
                .iter()
                .map(|member| TeamMember {
                    team_id,
                    user_id: (*member).clone(),
                    role: TeamRole::Member,
                })
                .collect(),
        }),
    }
}

#[tokio::test]
async fn joining_member_gets_a_star_of_distinct_teammates() {
    let team_id = Uuid::from_u128(1);
    let owner = user("owner@example.com");
    let joiner = user("joiner@example.com");
    let teammate = user("teammate@example.com");
    let channels = RecordingChannels::default();
    let service = TeammateDmServiceImpl::new(
        roster(team_id, &owner, &[&owner, &teammate, &teammate, &joiner]),
        channels.clone(),
    );

    let summary = service
        .ensure_for_joined_member(&team_id, &joiner)
        .await
        .unwrap();

    assert_eq!(
        summary,
        EnsureDmsSummary {
            created: 0,
            existing: 0,
            failed: 0,
        }
    );
    assert_eq!(
        channels.calls.lock().unwrap().clone(),
        vec![ensure_dms_for_joining_member(joiner, vec![owner, teammate])]
    );
}

#[tokio::test]
async fn missing_team_is_not_retried() {
    let service = TeammateDmServiceImpl::new(
        RecordingRoster {
            response: RosterResponse::Missing,
        },
        RecordingChannels::default(),
    );

    let error = service
        .ensure_for_joined_member(&Uuid::from_u128(2), &user("joiner@example.com"))
        .await
        .unwrap_err();

    assert!(matches!(error, TeammateDmError::TeamDoesNotExist));
    assert!(!error.is_transient());
}

#[tokio::test]
async fn roster_and_channel_failures_are_retried() {
    let team_id = Uuid::from_u128(3);
    let owner = user("owner@example.com");
    let joiner = user("joiner@example.com");

    let roster_error = TeammateDmServiceImpl::new(
        RecordingRoster {
            response: RosterResponse::Storage,
        },
        RecordingChannels::default(),
    )
    .ensure_for_joined_member(&team_id, &joiner)
    .await
    .unwrap_err();
    assert!(roster_error.is_transient());

    let channel_error = TeammateDmServiceImpl::new(
        roster(team_id, &owner, &[&joiner]),
        RecordingChannels {
            fail: true,
            ..Default::default()
        },
    )
    .ensure_for_joined_member(&team_id, &joiner)
    .await
    .unwrap_err();
    assert!(channel_error.is_transient());

    let partial = TeammateDmServiceImpl::new(
        roster(team_id, &owner, &[&owner, &joiner]),
        RecordingChannels {
            summary: EnsureDmsSummary {
                created: 0,
                existing: 0,
                failed: 1,
            },
            ..Default::default()
        },
    )
    .ensure_for_joined_member(&team_id, &joiner)
    .await
    .unwrap_err();
    assert!(matches!(
        partial,
        TeammateDmError::Partial { failed: 1, .. }
    ));
    assert!(partial.is_transient());
}
