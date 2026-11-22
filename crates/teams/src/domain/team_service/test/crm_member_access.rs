use super::*;
use crate::domain::{crm_member_access::CrmAccessRollout, model::PatchTeamMemberCrmAccess};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Default)]
struct Rollout(AtomicBool);

impl CrmAccessRollout for Rollout {
    fn require_enabled(
        &self,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<(), TeamError>> + Send + '_>> {
        Box::pin(async {
            if self.0.load(Ordering::SeqCst) {
                Ok(())
            } else {
                Err(TeamError::CrmAccessChangesUnavailable)
            }
        })
    }
}

#[tokio::test]
async fn preference_changes_wait_for_rollout_without_other_patch_effects() {
    let repo = MockTeamRepository::new(Vec::new(), "Test Team", Arc::new(Mutex::new(Vec::new())));
    let changes = repo.crm_access_changes.clone();
    let names = repo.patch_team_name_calls.clone();
    let service = TeamServiceImpl::new(
        repo,
        MockCustomerRepository::default(),
        RecordingChannelService::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );
    let team_id = uuid::Uuid::from_u128(1);
    let actor = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let request = PatchTeamRequest {
        member_crm_access: Some(PatchTeamMemberCrmAccess {
            user_id: MacroUserIdStr::parse_from_str("macro|member@example.com")
                .unwrap()
                .into_owned(),
            enabled: false,
        }),
        name: Some("Updated team".into()),
        slug: None,
        user_role_updates: None,
        default_link_share: None,
        language: None,
        prevent_completing_blocked_tasks: None,
    };
    assert!(matches!(
        service
            .patch_team(test_team_receipt(team_id, &actor), &request)
            .await,
        Err(TeamError::CrmAccessChangesUnavailable)
    ));
    assert!(changes.lock().unwrap().is_empty());
    assert!(names.lock().unwrap().is_empty());

    let rollout = Arc::new(Rollout::default());
    let service = service.with_crm_access_rollout(rollout.clone());
    rollout.0.store(true, Ordering::SeqCst);
    service
        .patch_team(test_team_receipt(team_id, &actor), &request)
        .await
        .unwrap();
    assert_eq!(changes.lock().unwrap().len(), 1);
    assert!(!changes.lock().unwrap()[0].3);

    rollout.0.store(false, Ordering::SeqCst);
    assert!(matches!(
        service
            .patch_team(test_team_receipt(team_id, &actor), &request)
            .await,
        Err(TeamError::CrmAccessChangesUnavailable)
    ));
    assert_eq!(changes.lock().unwrap().len(), 1);
    assert_eq!(names.lock().unwrap().len(), 1);
}
