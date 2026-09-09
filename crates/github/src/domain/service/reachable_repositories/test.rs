use super::*;
use crate::domain::models::{
    AppJwt, EnrichedGithubPullRequest, GithubAppInstallationSource, GithubAuthenticatedUser,
    GithubInstallationAccessToken, GithubKey, GithubPullRequestDetails, GithubSetupAccessToken,
    GithubUserInstallation, MacroTaskId, ResolvedTeamTaskReference, TeamTaskReference,
};
use std::collections::HashMap;
use std::sync::Mutex as StdMutex;

/// SAFETY: test-only key, shared with the installation-token service's tests.
const TEST_PEM: &str = include_str!("../installation_tokens/test_key.pem");

const PERSONAL_INSTALLATION: &str = "42";
const TEAM_INSTALLATION: &str = "77";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id")
}

fn config() -> InstallationTokenConfig {
    InstallationTokenConfig {
        client_id: "Iv1.testclient".to_owned(),
        private_key_pem: TEST_PEM.to_owned(),
    }
}

fn repository(owner: &str, name: &str) -> GithubRepository {
    GithubRepository {
        owner: owner.to_owned(),
        name: name.to_owned(),
        html_url: format!("https://github.com/{owner}/{name}"),
        default_branch: Some("main".to_owned()),
        private: true,
    }
}

/// Answers the two lookups this service makes and refuses the rest: a call to
/// anything else would mean the service reached further into the repository
/// than listing needs.
struct FakeRepo {
    /// Installation id to the sources that installed it.
    installations: Vec<(String, Vec<GithubAppInstallationSource>)>,
    teams: Vec<uuid::Uuid>,
}

impl GithubSyncRepo for FakeRepo {
    type Err = anyhow::Error;

    async fn get_user_team_ids(&self, _macro_id: &str) -> Result<Vec<uuid::Uuid>, Self::Err> {
        Ok(self.teams.clone())
    }

    async fn get_installation_ids_for_sources(
        &self,
        macro_id: &str,
        team_ids: &[uuid::Uuid],
    ) -> Result<Vec<String>, Self::Err> {
        Ok(self
            .installations
            .iter()
            .filter(|(_, sources)| {
                sources.iter().any(|source| match source {
                    GithubAppInstallationSource::User(user) => user == macro_id,
                    GithubAppInstallationSource::Team(team) => team_ids.contains(team),
                })
            })
            .map(|(installation_id, _)| installation_id.clone())
            .collect())
    }

    async fn get_installation_sources(
        &self,
        _installation_id: &str,
    ) -> Result<Vec<GithubAppInstallationSource>, Self::Err> {
        unimplemented!("listing goes from user to installations, not the other way")
    }

    async fn get_task_ids(&self, _github_key: GithubKey) -> Result<Vec<MacroTaskId>, Self::Err> {
        unimplemented!("listing repositories does not read tasks")
    }

    async fn upsert_task_ids(
        &self,
        _github_key: GithubKey,
        _task_ids: &[MacroTaskId],
    ) -> Result<(), Self::Err> {
        unimplemented!("listing repositories does not write tasks")
    }

    async fn filter_duplicate_tasks(
        &self,
        _github_key: GithubKey,
        _task_ids: &[MacroTaskId],
    ) -> Result<Vec<MacroTaskId>, Self::Err> {
        unimplemented!("listing repositories does not read tasks")
    }

    async fn resolve_team_task_references(
        &self,
        _installation_id: &str,
        _references: &[TeamTaskReference],
    ) -> Result<Vec<ResolvedTeamTaskReference>, Self::Err> {
        unimplemented!("listing repositories does not resolve task references")
    }

    async fn get_macro_ids_by_github_user_ids(
        &self,
        _github_user_ids: &[String],
    ) -> Result<HashMap<String, Vec<String>>, Self::Err> {
        unimplemented!("listing repositories does not map github users")
    }

    async fn get_macro_ids_by_github_logins(
        &self,
        _github_logins: &[String],
    ) -> Result<HashMap<String, Vec<String>>, Self::Err> {
        unimplemented!("listing repositories does not map github logins")
    }

    async fn get_team_member_ids(
        &self,
        _team_id: uuid::Uuid,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
        unimplemented!("listing repositories does not list team members")
    }

    async fn upsert_installation_sources(
        &self,
        _installation_id: &str,
        _sources: &[GithubAppInstallationSource],
    ) -> Result<(), Self::Err> {
        unimplemented!("listing repositories does not change installations")
    }

    async fn delete_installation_sources(&self, _installation_id: &str) -> Result<(), Self::Err> {
        unimplemented!("listing repositories does not change installations")
    }

    async fn upsert_installation_request(
        &self,
        _github_user_id: &str,
        _source: &GithubAppInstallationSource,
    ) -> Result<(), Self::Err> {
        unimplemented!("listing repositories does not change installation requests")
    }

    async fn get_installation_request(
        &self,
        _github_user_id: &str,
    ) -> Result<Option<GithubAppInstallationSource>, Self::Err> {
        unimplemented!("listing repositories does not read installation requests")
    }

    async fn delete_installation_request(&self, _github_user_id: &str) -> Result<(), Self::Err> {
        unimplemented!("listing repositories does not change installation requests")
    }
}

/// An installation id and the permissions a token was minted with.
type MintedToken = (u64, Vec<(String, String)>);

/// Serves a canned listing per installation and records what it was asked to
/// mint, so a test can assert the scope of the tokens used to read them.
struct FakeClient {
    repositories: HashMap<u64, Vec<GithubRepository>>,
    minted: StdMutex<Vec<MintedToken>>,
    listed: StdMutex<Vec<String>>,
}

impl FakeClient {
    fn new(repositories: HashMap<u64, Vec<GithubRepository>>) -> Self {
        Self {
            repositories,
            minted: StdMutex::default(),
            listed: StdMutex::default(),
        }
    }

    /// The token handed out for an installation, and the one its listing is
    /// looked up by.
    fn token_for(installation_id: u64) -> String {
        format!("ghs-{installation_id}")
    }
}

impl GithubSyncClient for FakeClient {
    async fn generate_installation_wide_access_token(
        &self,
        _jwt: &AppJwt,
        installation_id: u64,
        permissions: &[(&str, &str)],
    ) -> Result<GithubInstallationAccessToken, GithubError> {
        self.minted.lock().expect("lock").push((
            installation_id,
            permissions
                .iter()
                .map(|(permission, level)| ((*permission).to_owned(), (*level).to_owned()))
                .collect(),
        ));

        Ok(GithubInstallationAccessToken {
            token: Self::token_for(installation_id),
            expires_at: "2099-01-01T00:00:00Z".to_owned(),
        })
    }

    async fn list_installation_repositories(
        &self,
        access_token: &str,
    ) -> Result<Vec<GithubRepository>, GithubError> {
        self.listed
            .lock()
            .expect("lock")
            .push(access_token.to_owned());

        let installation_id = access_token
            .strip_prefix("ghs-")
            .and_then(|id| id.parse::<u64>().ok())
            .expect("a token this fake minted");

        Ok(self
            .repositories
            .get(&installation_id)
            .cloned()
            .unwrap_or_default())
    }

    async fn generate_scoped_installation_access_token(
        &self,
        _jwt: &AppJwt,
        _installation_id: u64,
        _repository: &str,
        _permissions: &[(&str, &str)],
    ) -> Result<GithubInstallationAccessToken, GithubError> {
        unimplemented!("a listing spans the whole installation")
    }

    async fn get_repository_installation(
        &self,
        _jwt: &AppJwt,
        _owner: &str,
        _repository: &str,
    ) -> Result<Option<u64>, GithubError> {
        unimplemented!("installations come from our own records, not from GitHub")
    }

    async fn exchange_setup_code(
        &self,
        _client_id: &str,
        _client_secret: &str,
        _code: &str,
    ) -> Result<GithubSetupAccessToken, GithubError> {
        unimplemented!("listing repositories does not exchange setup codes")
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
        unimplemented!("listing repositories does not need a github user")
    }

    async fn generate_installation_access_token(
        &self,
        _jwt: &AppJwt,
        _installation_id: u64,
    ) -> Result<GithubInstallationAccessToken, GithubError> {
        unimplemented!("a listing token carries only the permissions it needs")
    }

    async fn create_pr_comment(
        &self,
        _access_token: &str,
        _owner: &str,
        _repo: &str,
        _pull_number: u64,
        _body: &str,
    ) -> Result<(), GithubError> {
        unimplemented!("listing repositories does not comment")
    }

    async fn get_pull_request_details(
        &self,
        _access_token: &str,
        _owner: &str,
        _repo: &str,
        _number: u64,
    ) -> Result<GithubPullRequestDetails, GithubError> {
        unimplemented!("listing repositories does not read pull requests")
    }

    async fn list_open_pull_requests(
        &self,
        _access_token: &str,
    ) -> Result<Vec<EnrichedGithubPullRequest>, GithubError> {
        unimplemented!("listing repositories does not list pull requests")
    }
}

fn service(
    installations: Vec<(String, Vec<GithubAppInstallationSource>)>,
    teams: Vec<uuid::Uuid>,
    repositories: HashMap<u64, Vec<GithubRepository>>,
) -> ReachableRepositoriesService<FakeRepo, FakeClient> {
    ReachableRepositoriesService::new(
        config(),
        FakeRepo {
            installations,
            teams,
        },
        FakeClient::new(repositories),
    )
}

#[tokio::test]
async fn lists_the_repositories_of_an_installation_the_user_made_themselves() {
    let service = service(
        vec![(
            PERSONAL_INSTALLATION.to_owned(),
            vec![GithubAppInstallationSource::User(user().to_string())],
        )],
        vec![],
        HashMap::from([(42, vec![repository("owner", "personal")])]),
    );

    let repositories = service.for_user(&user()).await.expect("listed");

    assert_eq!(repositories, vec![repository("owner", "personal")]);
}

#[tokio::test]
async fn lists_the_repositories_of_an_installation_one_of_the_users_teams_made() {
    let team = uuid::Uuid::from_u128(7);
    let service = service(
        vec![(
            TEAM_INSTALLATION.to_owned(),
            vec![GithubAppInstallationSource::Team(team)],
        )],
        vec![team],
        HashMap::from([(77, vec![repository("macro-inc", "macro")])]),
    );

    let repositories = service.for_user(&user()).await.expect("listed");

    assert_eq!(repositories, vec![repository("macro-inc", "macro")]);
}

/// Someone else's installation is not the user's to see, and having no claim to
/// anything is an ordinary answer rather than a failure.
#[tokio::test]
async fn a_user_who_reaches_nothing_gets_an_empty_list() {
    let service = service(
        vec![(
            TEAM_INSTALLATION.to_owned(),
            vec![GithubAppInstallationSource::Team(uuid::Uuid::from_u128(1))],
        )],
        vec![uuid::Uuid::from_u128(2)],
        HashMap::from([(77, vec![repository("someone-else", "private")])]),
    );

    let repositories = service.for_user(&user()).await.expect("listed");

    assert!(repositories.is_empty());
}

#[tokio::test]
async fn a_repository_two_installations_both_cover_is_listed_once() {
    let team = uuid::Uuid::from_u128(7);
    let shared = repository("macro-inc", "macro");
    let service = service(
        vec![
            (
                PERSONAL_INSTALLATION.to_owned(),
                vec![GithubAppInstallationSource::User(user().to_string())],
            ),
            (
                TEAM_INSTALLATION.to_owned(),
                vec![GithubAppInstallationSource::Team(team)],
            ),
        ],
        vec![team],
        HashMap::from([
            (42, vec![shared.clone(), repository("owner", "personal")]),
            (77, vec![shared.clone()]),
        ]),
    );

    let repositories = service.for_user(&user()).await.expect("listed");

    assert_eq!(
        repositories,
        vec![shared, repository("owner", "personal")],
        "deduplicated by owner/name and sorted"
    );
}

/// A listing token must not be able to read a line of anyone's code.
#[tokio::test]
async fn reads_the_listing_with_metadata_permission_only() {
    let service = service(
        vec![(
            PERSONAL_INSTALLATION.to_owned(),
            vec![GithubAppInstallationSource::User(user().to_string())],
        )],
        vec![],
        HashMap::from([(42, vec![repository("owner", "personal")])]),
    );

    service.for_user(&user()).await.expect("listed");

    let minted = service.client.minted.lock().expect("lock").clone();
    assert_eq!(
        minted,
        vec![(42, vec![("metadata".to_owned(), "read".to_owned())])]
    );
}

#[tokio::test]
async fn a_second_call_is_served_from_the_cache() {
    let service = service(
        vec![(
            PERSONAL_INSTALLATION.to_owned(),
            vec![GithubAppInstallationSource::User(user().to_string())],
        )],
        vec![],
        HashMap::from([(42, vec![repository("owner", "personal")])]),
    );

    let first = service.for_user(&user()).await.expect("listed");
    let second = service.for_user(&user()).await.expect("listed");

    assert_eq!(first, second);
    assert_eq!(service.client.listed.lock().expect("lock").len(), 1);
}

#[test]
fn the_https_url_is_built_from_owner_and_name() {
    assert_eq!(
        repository("macro-inc", "macro").https_url(),
        "https://github.com/macro-inc/macro"
    );
}
