use super::*;
use crate::domain::models::AppJwt;
use crate::domain::models::{
    EnrichedGithubPullRequest, GithubAuthenticatedUser, GithubKey, GithubPullRequestDetails,
    GithubSetupAccessToken, GithubUserInstallation, MacroTaskId, ResolvedTeamTaskReference,
    TeamTaskReference,
};
use std::collections::HashMap;
use std::sync::Mutex;

/// SAFETY: test-only key, matching the one the sync service's tests sign with.
const TEST_PEM: &str = include_str!("test_key.pem");

const INSTALLATION: u64 = 42;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id")
}

fn config() -> InstallationTokenConfig {
    InstallationTokenConfig {
        client_id: "Iv1.testclient".to_owned(),
        private_key_pem: TEST_PEM.to_owned(),
    }
}

fn permissions() -> Vec<(&'static str, &'static str)> {
    vec![("contents", "write")]
}

/// Answers the two lookups this service makes and refuses the rest: a call to
/// anything else would mean the service reached further into the repository
/// than minting a token needs.
struct FakeRepo {
    sources: Vec<GithubAppInstallationSource>,
    teams: Vec<uuid::Uuid>,
}

impl GithubSyncRepo for FakeRepo {
    type Err = anyhow::Error;

    async fn get_installation_sources(
        &self,
        installation_id: &str,
    ) -> Result<Vec<GithubAppInstallationSource>, Self::Err> {
        assert_eq!(installation_id, INSTALLATION.to_string());
        Ok(self.sources.clone())
    }

    async fn get_user_team_ids(&self, _macro_id: &str) -> Result<Vec<uuid::Uuid>, Self::Err> {
        Ok(self.teams.clone())
    }

    async fn get_task_ids(&self, _github_key: GithubKey) -> Result<Vec<MacroTaskId>, Self::Err> {
        unimplemented!("minting a token does not read tasks")
    }

    async fn upsert_task_ids(
        &self,
        _github_key: GithubKey,
        _task_ids: &[MacroTaskId],
    ) -> Result<(), Self::Err> {
        unimplemented!("minting a token does not write tasks")
    }

    async fn filter_duplicate_tasks(
        &self,
        _github_key: GithubKey,
        _task_ids: &[MacroTaskId],
    ) -> Result<Vec<MacroTaskId>, Self::Err> {
        unimplemented!("minting a token does not read tasks")
    }

    async fn resolve_team_task_references(
        &self,
        _installation_id: &str,
        _references: &[TeamTaskReference],
    ) -> Result<Vec<ResolvedTeamTaskReference>, Self::Err> {
        unimplemented!("minting a token does not resolve task references")
    }

    async fn get_macro_ids_by_github_user_ids(
        &self,
        _github_user_ids: &[String],
    ) -> Result<HashMap<String, Vec<String>>, Self::Err> {
        unimplemented!("minting a token does not map github users")
    }

    async fn get_macro_ids_by_github_logins(
        &self,
        _github_logins: &[String],
    ) -> Result<HashMap<String, Vec<String>>, Self::Err> {
        unimplemented!("minting a token does not map github logins")
    }

    async fn get_team_member_ids(
        &self,
        _team_id: uuid::Uuid,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
        unimplemented!("minting a token does not list team members")
    }

    async fn upsert_installation_sources(
        &self,
        _installation_id: &str,
        _sources: &[GithubAppInstallationSource],
    ) -> Result<(), Self::Err> {
        unimplemented!("minting a token does not change installations")
    }

    async fn delete_installation_sources(&self, _installation_id: &str) -> Result<(), Self::Err> {
        unimplemented!("minting a token does not change installations")
    }

    async fn upsert_installation_request(
        &self,
        _github_user_id: &str,
        _source: &GithubAppInstallationSource,
    ) -> Result<(), Self::Err> {
        unimplemented!("minting a token does not change installation requests")
    }

    async fn get_installation_request(
        &self,
        _github_user_id: &str,
    ) -> Result<Option<GithubAppInstallationSource>, Self::Err> {
        unimplemented!("minting a token does not read installation requests")
    }

    async fn delete_installation_request(&self, _github_user_id: &str) -> Result<(), Self::Err> {
        unimplemented!("minting a token does not change installation requests")
    }
}

/// Records what it was asked to mint, so a test can assert the scope.
struct FakeClient {
    installation: Option<u64>,
    minted: Mutex<Vec<(u64, String, Vec<(String, String)>)>>,
}

impl FakeClient {
    fn installed() -> Self {
        Self {
            installation: Some(INSTALLATION),
            minted: Mutex::default(),
        }
    }

    fn not_installed() -> Self {
        Self {
            installation: None,
            minted: Mutex::default(),
        }
    }

    fn mint_count(&self) -> usize {
        self.minted.lock().expect("lock").len()
    }
}

impl GithubSyncClient for FakeClient {
    async fn get_repository_installation(
        &self,
        _jwt: &AppJwt,
        _owner: &str,
        _repository: &str,
    ) -> Result<Option<u64>, GithubError> {
        Ok(self.installation)
    }

    async fn generate_scoped_installation_access_token(
        &self,
        _jwt: &AppJwt,
        installation_id: u64,
        repository: &str,
        permissions: &[(&str, &str)],
    ) -> Result<GithubInstallationAccessToken, GithubError> {
        self.minted.lock().expect("lock").push((
            installation_id,
            repository.to_owned(),
            permissions
                .iter()
                .map(|(permission, level)| ((*permission).to_owned(), (*level).to_owned()))
                .collect(),
        ));

        Ok(GithubInstallationAccessToken {
            token: "ghs-scoped".to_owned(),
            expires_at: "2099-01-01T00:00:00Z".to_owned(),
        })
    }

    async fn exchange_setup_code(
        &self,
        _client_id: &str,
        _client_secret: &str,
        _code: &str,
    ) -> Result<GithubSetupAccessToken, GithubError> {
        unimplemented!("minting a token does not exchange setup codes")
    }

    async fn list_user_installations(
        &self,
        _access_token: &str,
    ) -> Result<Vec<GithubUserInstallation>, GithubError> {
        unimplemented!("ownership comes from our own records, not from GitHub")
    }

    async fn get_authenticated_user(
        &self,
        _access_token: &str,
    ) -> Result<GithubAuthenticatedUser, GithubError> {
        unimplemented!("minting a token does not need a github user")
    }

    async fn generate_installation_access_token(
        &self,
        _jwt: &AppJwt,
        _installation_id: u64,
    ) -> Result<GithubInstallationAccessToken, GithubError> {
        unimplemented!("this service only ever mints scoped tokens")
    }

    async fn create_pr_comment(
        &self,
        _access_token: &str,
        _owner: &str,
        _repo: &str,
        _pull_number: u64,
        _body: &str,
    ) -> Result<(), GithubError> {
        unimplemented!("minting a token does not comment")
    }

    async fn get_pull_request_details(
        &self,
        _access_token: &str,
        _owner: &str,
        _repo: &str,
        _number: u64,
    ) -> Result<GithubPullRequestDetails, GithubError> {
        unimplemented!("minting a token does not read pull requests")
    }

    async fn list_open_pull_requests(
        &self,
        _access_token: &str,
    ) -> Result<Vec<EnrichedGithubPullRequest>, GithubError> {
        unimplemented!("minting a token does not list pull requests")
    }
}

fn service(
    sources: Vec<GithubAppInstallationSource>,
    teams: Vec<uuid::Uuid>,
    client: FakeClient,
) -> InstallationTokenService<FakeRepo, FakeClient> {
    InstallationTokenService::new(config(), FakeRepo { sources, teams }, client)
}

#[tokio::test]
async fn mints_for_an_installation_the_user_installed_themselves() {
    let service = service(
        vec![GithubAppInstallationSource::User(user().to_string())],
        vec![],
        FakeClient::installed(),
    );

    let token = service
        .for_repository(&user(), "macro-inc", "macro", &permissions())
        .await
        .expect("minted");

    assert_eq!(token.token, "ghs-scoped");
}

#[tokio::test]
async fn mints_for_an_installation_owned_by_one_of_the_users_teams() {
    let team = uuid::Uuid::from_u128(7);
    let service = service(
        vec![GithubAppInstallationSource::Team(team)],
        vec![team],
        FakeClient::installed(),
    );

    service
        .for_repository(&user(), "macro-inc", "macro", &permissions())
        .await
        .expect("minted");
}

/// The check that stops any session minting a token for any repository our App
/// happens to be installed on.
#[tokio::test]
async fn refuses_an_installation_belonging_to_someone_else() {
    let service = service(
        vec![GithubAppInstallationSource::Team(uuid::Uuid::from_u128(1))],
        vec![uuid::Uuid::from_u128(2)],
        FakeClient::installed(),
    );

    let error = service
        .for_repository(&user(), "someone-else", "private", &permissions())
        .await
        .expect_err("refused");

    assert!(matches!(error, GithubError::RepositoryUnavailable));
}

#[tokio::test]
async fn refuses_a_repository_the_app_is_not_installed_on() {
    let service = service(vec![], vec![], FakeClient::not_installed());

    let error = service
        .for_repository(&user(), "macro-inc", "macro", &permissions())
        .await
        .expect_err("refused");

    assert!(matches!(error, GithubError::RepositoryUnavailable));
}

/// A refusal must not mint first and check afterwards.
#[tokio::test]
async fn refusing_mints_nothing() {
    let client = FakeClient::installed();
    let service = service(
        vec![GithubAppInstallationSource::Team(uuid::Uuid::from_u128(1))],
        vec![],
        client,
    );

    service
        .for_repository(&user(), "someone-else", "private", &permissions())
        .await
        .expect_err("refused");

    assert_eq!(service.client.mint_count(), 0);
}

#[tokio::test]
async fn scopes_the_token_to_the_one_repository_and_the_asked_for_permissions() {
    let service = service(
        vec![GithubAppInstallationSource::User(user().to_string())],
        vec![],
        FakeClient::installed(),
    );

    service
        .for_repository(
            &user(),
            "macro-inc",
            "macro",
            &[("contents", "write"), ("pull_requests", "write")],
        )
        .await
        .expect("minted");

    let minted = service.client.minted.lock().expect("lock").clone();
    assert_eq!(
        minted,
        vec![(
            INSTALLATION,
            "macro".to_owned(),
            vec![
                ("contents".to_owned(), "write".to_owned()),
                ("pull_requests".to_owned(), "write".to_owned()),
            ]
        )]
    );
}

#[test]
fn reads_the_expiry_github_sent() {
    let token = GithubInstallationAccessToken {
        token: "ghs-scoped".to_owned(),
        expires_at: "2099-01-01T00:00:00Z".to_owned(),
    };

    assert_eq!(
        token.expires_at().expect("parsed").to_rfc3339(),
        "2099-01-01T00:00:00+00:00"
    );
}

#[test]
fn an_unparseable_expiry_is_an_error() {
    let token = GithubInstallationAccessToken {
        token: "ghs-scoped".to_owned(),
        expires_at: "whenever".to_owned(),
    };

    assert!(matches!(token.expires_at(), Err(GithubError::Internal(_))));
}
