use super::*;
use crate::domain::agent_invites::{AgentInviteDecision, AgentInviteRollout};

#[derive(Debug)]
struct RecordingRollout {
    enabled: bool,
    callers: Arc<Mutex<Vec<MacroUserIdStr<'static>>>>,
}

impl AgentInviteRollout for RecordingRollout {
    fn enabled<'a>(&'a self, caller: &'a MacroUserIdStr<'_>) -> AgentInviteDecision<'a> {
        self.callers
            .lock()
            .expect("callers")
            .push(caller.clone().into_owned());
        Box::pin(async { self.enabled })
    }
}

#[tokio::test]
async fn agent_invites_fail_closed_before_persistence_and_human_invites_skip_rollout() {
    for enabled in [None, Some(false), Some(true)] {
        let team_id = uuid::Uuid::from_u128(9901);
        let inviter = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
        let repo = MockTeamRepository::new(vec![], "Test Team", Arc::new(Mutex::new(vec![])));
        let invitations = repo.invite_users_to_team_calls.clone();
        let callers = Arc::new(Mutex::new(vec![]));
        let mut service = TeamServiceImpl::new(
            repo,
            MockCustomerRepository::default(),
            RecordingChannelService::default(),
            MockUserRolesAndPermissionsService::default(),
            Arc::new(MockNotificationIngress::new(HashSet::new())),
            NoOpCrmEnqueuer,
            NoOpTeamCrmSettingsRepository,
        );
        if let Some(enabled) = enabled {
            service = service.with_agent_invite_rollout(Arc::new(RecordingRollout {
                enabled,
                callers: callers.clone(),
            }));
        }
        let emails = [Email::parse_from_str("invitee@example.com")
            .unwrap()
            .lowercase()];
        let result = service
            .invite_users_to_team(
                test_team_receipt::<MemberTeamRole>(team_id, &inviter),
                non_empty::NonEmpty::new(emails.as_slice()).unwrap(),
                true,
            )
            .await;
        if enabled == Some(true) {
            result.expect("enabled invitation");
            assert_eq!(*invitations.lock().unwrap(), 1);
        } else {
            assert!(matches!(
                result,
                Err(InviteUsersToTeamError::AgentsNotEnabled)
            ));
            assert_eq!(*invitations.lock().unwrap(), 0);
        }
        let expected = if enabled.is_some() {
            vec![inviter.clone()]
        } else {
            vec![]
        };
        assert_eq!(*callers.lock().unwrap(), expected);
        let before = *invitations.lock().unwrap();
        service
            .invite_users_to_team(
                test_team_receipt::<MemberTeamRole>(team_id, &inviter),
                non_empty::NonEmpty::new(emails.as_slice()).unwrap(),
                false,
            )
            .await
            .expect("human invitation");
        assert_eq!(*invitations.lock().unwrap(), before + 1);
        assert_eq!(*callers.lock().unwrap(), expected);
    }
}
