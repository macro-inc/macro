use super::*;
use crate::domain::team_logo::{
    TeamLogoFile, TeamLogoFileFuture, TeamLogoFiles, TeamLogoLookupError,
};

const ADMIN: &str = "macro|admin@example.com";

/// Static files by id, recording every lookup.
#[derive(Debug, Default)]
struct FakeLogoFiles {
    files: HashMap<uuid::Uuid, TeamLogoFile>,
    lookups: Mutex<Vec<uuid::Uuid>>,
}

impl TeamLogoFiles for FakeLogoFiles {
    fn get_logo_file(&self, file_id: uuid::Uuid) -> TeamLogoFileFuture<'_> {
        self.lookups.lock().unwrap().push(file_id);
        let file = self.files.get(&file_id).cloned();
        Box::pin(async move { Ok(file) })
    }
}

fn logo_request(logo_file_id: Option<Option<uuid::Uuid>>) -> PatchTeamRequest {
    PatchTeamRequest {
        member_crm_access: None,
        name: None,
        slug: None,
        user_role_updates: None,
        default_link_share: None,
        language: None,
        logo_file_id,
    }
}

/// Patches the team as `ADMIN` with `files` as static file storage, returning
/// the result, the files looked up, and how many times the repository was
/// asked to update the team.
async fn patch_logo(
    files: Vec<(uuid::Uuid, TeamLogoFile)>,
    logo_file_id: Option<Option<uuid::Uuid>>,
) -> (Result<(), TeamError>, Vec<uuid::Uuid>, usize) {
    let repo = MockTeamRepository::new(Vec::new(), "Test Team", Arc::new(Mutex::new(Vec::new())));
    let repo_calls = repo.patch_team_name_calls.clone();
    let logo_files = Arc::new(FakeLogoFiles {
        files: files.into_iter().collect(),
        lookups: Mutex::new(Vec::new()),
    });
    let service = TeamServiceImpl::new(
        repo,
        MockCustomerRepository::default(),
        RecordingChannelService::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    )
    .with_logo_files(logo_files.clone());
    let actor = MacroUserIdStr::parse_from_str(ADMIN).unwrap();

    let result = service
        .patch_team(
            test_team_receipt::<AdminTeamRole>(uuid::Uuid::from_u128(1), &actor),
            &logo_request(logo_file_id),
        )
        .await;

    let lookups = logo_files.lookups.lock().unwrap().clone();
    let repo_calls = repo_calls.lock().unwrap().len();
    (result, lookups, repo_calls)
}

#[tokio::test]
async fn an_admin_sets_an_image_they_uploaded_as_the_logo() {
    let logo = uuid::Uuid::from_u128(10);
    let file = TeamLogoFile {
        owner_id: ADMIN.to_string(),
        content_type: "image/png".to_string(),
    };

    let (result, lookups, repo_calls) = patch_logo(vec![(logo, file)], Some(Some(logo))).await;

    result.unwrap();
    assert_eq!(lookups, vec![logo]);
    assert_eq!(repo_calls, 1);
}

#[tokio::test]
async fn removing_or_omitting_the_logo_looks_up_no_file() {
    let (result, lookups, repo_calls) = patch_logo(Vec::new(), Some(None)).await;
    result.unwrap();
    assert!(lookups.is_empty());
    assert_eq!(repo_calls, 1);

    let (result, lookups, _) = patch_logo(Vec::new(), None).await;
    result.unwrap();
    assert!(lookups.is_empty());
}

#[tokio::test]
async fn a_logo_that_is_missing_not_the_callers_or_not_an_image_is_refused() {
    let missing = uuid::Uuid::from_u128(20);
    let someone_elses = uuid::Uuid::from_u128(21);
    let svg = uuid::Uuid::from_u128(22);
    let pdf = uuid::Uuid::from_u128(23);
    let files = || {
        vec![
            (
                someone_elses,
                TeamLogoFile {
                    owner_id: "macro|other@example.com".to_string(),
                    content_type: "image/png".to_string(),
                },
            ),
            (
                svg,
                TeamLogoFile {
                    owner_id: ADMIN.to_string(),
                    content_type: "image/svg+xml".to_string(),
                },
            ),
            (
                pdf,
                TeamLogoFile {
                    owner_id: ADMIN.to_string(),
                    content_type: "application/pdf".to_string(),
                },
            ),
        ]
    };

    for refused in [missing, someone_elses, svg, pdf] {
        let (result, _, repo_calls) = patch_logo(files(), Some(Some(refused))).await;

        assert!(
            matches!(result, Err(TeamError::BadRequest(_))),
            "{refused} should be refused, got {result:?}"
        );
        assert_eq!(
            repo_calls, 0,
            "a refused logo must leave the team unchanged"
        );
    }
}

#[tokio::test]
async fn an_unwired_service_refuses_to_set_a_logo() {
    let repo = MockTeamRepository::new(Vec::new(), "Test Team", Arc::new(Mutex::new(Vec::new())));
    let repo_calls = repo.patch_team_name_calls.clone();
    let service = TeamServiceImpl::new(
        repo,
        MockCustomerRepository::default(),
        RecordingChannelService::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    );
    let actor = MacroUserIdStr::parse_from_str(ADMIN).unwrap();

    let result = service
        .patch_team(
            test_team_receipt::<AdminTeamRole>(uuid::Uuid::from_u128(1), &actor),
            &logo_request(Some(Some(uuid::Uuid::from_u128(30)))),
        )
        .await;

    assert!(matches!(result, Err(TeamError::StorageLayerError(_))));
    assert!(repo_calls.lock().unwrap().is_empty());
}

/// Static file storage that never answers.
#[derive(Debug)]
struct UnreachableLogoFiles;

impl TeamLogoFiles for UnreachableLogoFiles {
    fn get_logo_file(&self, _file_id: uuid::Uuid) -> TeamLogoFileFuture<'_> {
        Box::pin(async {
            Err(TeamLogoLookupError::Unavailable(anyhow::anyhow!(
                "static file service timed out"
            )))
        })
    }
}

#[tokio::test]
async fn a_storage_outage_while_checking_the_logo_is_retryable_and_applies_nothing() {
    let repo = MockTeamRepository::new(Vec::new(), "Test Team", Arc::new(Mutex::new(Vec::new())));
    let repo_calls = repo.patch_team_name_calls.clone();
    let service = TeamServiceImpl::new(
        repo,
        MockCustomerRepository::default(),
        RecordingChannelService::default(),
        MockUserRolesAndPermissionsService::default(),
        Arc::new(MockNotificationIngress::new(HashSet::new())),
        NoOpCrmEnqueuer,
        NoOpTeamCrmSettingsRepository,
    )
    .with_logo_files(Arc::new(UnreachableLogoFiles));
    let actor = MacroUserIdStr::parse_from_str(ADMIN).unwrap();

    let result = service
        .patch_team(
            test_team_receipt::<AdminTeamRole>(uuid::Uuid::from_u128(1), &actor),
            &logo_request(Some(Some(uuid::Uuid::from_u128(40)))),
        )
        .await;

    assert!(matches!(result, Err(TeamError::LogoLookupUnavailable(_))));
    assert!(repo_calls.lock().unwrap().is_empty());
}
