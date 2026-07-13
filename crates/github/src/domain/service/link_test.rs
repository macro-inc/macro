use std::sync::{Arc, Mutex};

use chrono::Utc;
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use foreign_entity::domain::{
    models::{
        CreateForeignEntity, ForeignEntity, ForeignEntityError, PatchForeignEntity, SourceId,
    },
    ports::{ForeignEntityListQuery, ForeignEntityService},
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};

use crate::domain::{
    models::{
        EnrichedGithubPullRequest, GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE, GithubAccessToken,
        GithubError, GithubExchangeTokenResponse, GithubLink, GithubPullRequestDetails,
        GithubPullRequestRef, GithubUserInfo,
    },
    ports::{Auth, GithubLinkService, GithubOauth, GithubRepo},
};

use super::{GithubLinkConfig, GithubLinkServiceImpl};

#[derive(Clone)]
struct StubGithubRepo {
    state: Arc<Mutex<StubGithubRepoState>>,
}

struct StubGithubRepoState {
    /// Link returned by `get_github_link_by_user_id` (None → "no rows returned").
    link_by_user_id: Option<GithubLink>,
    /// Link returned by `get_github_link_by_github_user_id` (None → "no rows returned").
    link_by_github_user_id: Option<GithubLink>,
    /// Value returned by `count_github_links_by_github_user_id`.
    link_count: i64,
    inserted_links: Vec<GithubLink>,
    delete_github_link_calls: u32,
    delete_in_progress_user_link_calls: u32,
}

impl Default for StubGithubRepoState {
    fn default() -> Self {
        Self {
            link_by_user_id: None,
            link_by_github_user_id: None,
            link_count: 1,
            inserted_links: Vec::new(),
            delete_github_link_calls: 0,
            delete_in_progress_user_link_calls: 0,
        }
    }
}

impl StubGithubRepo {
    fn new(state: StubGithubRepoState) -> Self {
        Self {
            state: Arc::new(Mutex::new(state)),
        }
    }

    fn linked(link: GithubLink) -> Self {
        Self::new(StubGithubRepoState {
            link_by_user_id: Some(link),
            ..StubGithubRepoState::default()
        })
    }

    fn unlinked() -> Self {
        Self::new(StubGithubRepoState::default())
    }

    /// Sets the link returned by `get_github_link_by_github_user_id`.
    fn with_account_owner(self, owner: GithubLink) -> Self {
        self.state.lock().unwrap().link_by_github_user_id = Some(owner);
        self
    }

    /// Sets the value returned by `count_github_links_by_github_user_id`.
    fn with_link_count(self, link_count: i64) -> Self {
        self.state.lock().unwrap().link_count = link_count;
        self
    }

    fn inserted_links(&self) -> Vec<GithubLink> {
        self.state.lock().unwrap().inserted_links.clone()
    }

    fn delete_github_link_calls(&self) -> u32 {
        self.state.lock().unwrap().delete_github_link_calls
    }

    fn delete_in_progress_user_link_calls(&self) -> u32 {
        self.state
            .lock()
            .unwrap()
            .delete_in_progress_user_link_calls
    }
}

impl GithubRepo for StubGithubRepo {
    type Err = anyhow::Error;

    async fn get_github_link_by_user_id<'a>(
        &self,
        _macro_user_id: &MacroUserId<Lowercase<'a>>,
    ) -> Result<GithubLink, Self::Err> {
        self.state
            .lock()
            .unwrap()
            .link_by_user_id
            .clone()
            .ok_or_else(|| anyhow::anyhow!("no rows returned"))
    }

    async fn get_github_link_by_github_user_id(
        &self,
        _github_user_id: &str,
    ) -> Result<GithubLink, Self::Err> {
        self.state
            .lock()
            .unwrap()
            .link_by_github_user_id
            .clone()
            .ok_or_else(|| anyhow::anyhow!("no rows returned"))
    }

    async fn count_github_links_by_github_user_id(
        &self,
        _github_user_id: &str,
    ) -> Result<i64, Self::Err> {
        Ok(self.state.lock().unwrap().link_count)
    }

    async fn get_github_link_by_id(&self, _id: &uuid::Uuid) -> Result<GithubLink, Self::Err> {
        Err(anyhow::anyhow!("not implemented"))
    }

    async fn insert_github_link(&self, link: &GithubLink) -> Result<(), Self::Err> {
        self.state.lock().unwrap().inserted_links.push(link.clone());
        Ok(())
    }

    async fn delete_in_progress_user_link(
        &self,
        _in_progress_link_id: &uuid::Uuid,
    ) -> Result<(), Self::Err> {
        self.state
            .lock()
            .unwrap()
            .delete_in_progress_user_link_calls += 1;
        Ok(())
    }

    async fn delete_github_link(&self, _link_id: &uuid::Uuid) -> Result<(), Self::Err> {
        self.state.lock().unwrap().delete_github_link_calls += 1;
        Ok(())
    }
}

#[derive(Clone, Default)]
struct StubGithubOauth {
    state: Arc<Mutex<StubGithubOauthState>>,
}

#[derive(Default)]
struct StubGithubOauthState {
    token_is_expired: bool,
    validated_tokens: Vec<String>,
    pull_request_detail_calls: Vec<PullRequestDetailCall>,
    pull_request_details: Option<GithubPullRequestDetails>,
    pull_request_detail_error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PullRequestDetailCall {
    access_token: String,
    owner: String,
    repo: String,
    number: u64,
}

impl StubGithubOauth {
    fn new(token_is_expired: bool) -> Self {
        Self {
            state: Arc::new(Mutex::new(StubGithubOauthState {
                token_is_expired,
                ..StubGithubOauthState::default()
            })),
        }
    }

    fn validated_tokens(&self) -> Vec<String> {
        self.state.lock().unwrap().validated_tokens.clone()
    }

    fn pull_request_detail_calls(&self) -> Vec<PullRequestDetailCall> {
        self.state.lock().unwrap().pull_request_detail_calls.clone()
    }

    fn fail_pull_request_details(&self, error: &str) {
        self.state.lock().unwrap().pull_request_detail_error = Some(error.to_string());
    }
}

fn default_pull_request_details() -> GithubPullRequestDetails {
    GithubPullRequestDetails {
        title: "Add token validation".to_string(),
        state: "open".to_string(),
        merged_at: None,
        additions: 12,
        deletions: 3,
        author_login: None,
        author_id: None,
        description: None,
        comments: None,
        checks: None,
        participant_github_user_ids: None,
    }
}

impl GithubOauth for StubGithubOauth {
    type Err = anyhow::Error;

    fn construct_oauth_url<T: serde::Serialize + std::fmt::Debug + 'static>(
        &self,
        _client_id: &str,
        _redirect_uri: &str,
        _state: T,
    ) -> Result<String, Self::Err> {
        Ok("https://github.example/oauth".to_string())
    }

    async fn exchange_oauth_code_for_tokens(
        &self,
        _client_id: &str,
        _client_secret: &str,
        _redirect_uri: &str,
        _code: &str,
    ) -> Result<GithubExchangeTokenResponse, Self::Err> {
        Ok(GithubExchangeTokenResponse {
            access_token: "access-token".to_string(),
            token_type: "bearer".to_string(),
            scope: "repo user:email".to_string(),
            refresh_token: None,
            expires_in: None,
            refresh_token_expires_in: None,
        })
    }

    async fn get_user_info(&self, _access_token: &str) -> Result<GithubUserInfo, Self::Err> {
        Ok(GithubUserInfo {
            id: 1,
            login: "octocat".to_string(),
            email: None,
            name: None,
        })
    }

    async fn is_access_token_expired(&self, access_token: &str) -> Result<bool, Self::Err> {
        let mut state = self.state.lock().unwrap();
        state.validated_tokens.push(access_token.to_string());
        Ok(state.token_is_expired)
    }

    async fn get_pull_request_details(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
        number: u64,
    ) -> Result<GithubPullRequestDetails, Self::Err> {
        let mut state = self.state.lock().unwrap();
        state.pull_request_detail_calls.push(PullRequestDetailCall {
            access_token: access_token.to_string(),
            owner: owner.to_string(),
            repo: repo.to_string(),
            number,
        });

        if let Some(error) = &state.pull_request_detail_error {
            return Err(anyhow::anyhow!(error.clone()));
        }

        Ok(state
            .pull_request_details
            .clone()
            .unwrap_or_else(default_pull_request_details))
    }
}

#[derive(Clone)]
struct StubAuth {
    access_token: String,
    state: Arc<Mutex<StubAuthState>>,
}

#[derive(Default)]
struct StubAuthState {
    link_user_calls: u32,
    delete_user_link_calls: u32,
}

impl StubAuth {
    fn new(access_token: &str) -> Self {
        Self {
            access_token: access_token.to_string(),
            state: Arc::new(Mutex::new(StubAuthState::default())),
        }
    }

    fn link_user_calls(&self) -> u32 {
        self.state.lock().unwrap().link_user_calls
    }

    fn delete_user_link_calls(&self) -> u32 {
        self.state.lock().unwrap().delete_user_link_calls
    }
}

impl Auth for StubAuth {
    type Err = anyhow::Error;

    async fn link_user(
        &self,
        _fusionauth_user_id: &uuid::Uuid,
        _idp_id: &str,
        _github_user_id: &str,
        _username: &str,
        _access_token: &str,
    ) -> Result<(), Self::Err> {
        self.state.lock().unwrap().link_user_calls += 1;
        Ok(())
    }

    async fn delete_user_link(
        &self,
        _github_link: &GithubLink,
        _github_idp_id: &str,
    ) -> Result<(), Self::Err> {
        self.state.lock().unwrap().delete_user_link_calls += 1;
        Ok(())
    }

    async fn retreive_access_token(
        &self,
        _fusionauth_user_id: &uuid::Uuid,
        _github_idp_id: &str,
    ) -> Result<GithubAccessToken, Self::Err> {
        Ok(GithubAccessToken::new(self.access_token.clone()))
    }
}

#[derive(Clone, Default)]
struct StubForeignEntityService {
    state: Arc<Mutex<StubForeignEntityState>>,
}

#[derive(Default)]
struct StubForeignEntityState {
    entities: Vec<ForeignEntity>,
    fetch_error: Option<String>,
    patch_error: Option<String>,
    fetch_calls: Vec<FetchForeignEntitiesCall>,
    patch_calls: Vec<PatchForeignEntityCall>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FetchForeignEntitiesCall {
    foreign_entity_id: String,
    foreign_entity_source: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
struct PatchForeignEntityCall {
    id: uuid::Uuid,
    patch: PatchForeignEntity,
}

impl StubForeignEntityService {
    fn with_entities(entities: Vec<ForeignEntity>) -> Self {
        Self {
            state: Arc::new(Mutex::new(StubForeignEntityState {
                entities,
                ..StubForeignEntityState::default()
            })),
        }
    }

    fn fail_patches(&self, error: &str) {
        self.state.lock().unwrap().patch_error = Some(error.to_string());
    }

    fn fetch_calls(&self) -> Vec<FetchForeignEntitiesCall> {
        self.state.lock().unwrap().fetch_calls.clone()
    }

    fn patch_calls(&self) -> Vec<PatchForeignEntityCall> {
        self.state.lock().unwrap().patch_calls.clone()
    }

    fn foreign_entity_by_id(&self, id: uuid::Uuid) -> Option<ForeignEntity> {
        self.state
            .lock()
            .unwrap()
            .entities
            .iter()
            .find(|entity| entity.id == id)
            .cloned()
    }
}

fn unimplemented_foreign_entity_error() -> ForeignEntityError {
    ForeignEntityError::Internal(anyhow::anyhow!("not implemented"))
}

impl ForeignEntityService for StubForeignEntityService {
    async fn get_foreign_entity(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        Err(unimplemented_foreign_entity_error())
    }

    async fn get_foreign_entity_by_id(
        &self,
        id: uuid::Uuid,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        self.foreign_entity_by_id(id)
            .ok_or(ForeignEntityError::NotFound(id))
    }

    async fn get_foreign_entities_by_foreign_entity_id(
        &self,
        foreign_entity_id: &str,
        foreign_entity_source: Option<&str>,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        let mut state = self.state.lock().unwrap();
        state.fetch_calls.push(FetchForeignEntitiesCall {
            foreign_entity_id: foreign_entity_id.to_string(),
            foreign_entity_source: foreign_entity_source.map(str::to_string),
        });

        if let Some(error) = &state.fetch_error {
            return Err(ForeignEntityError::Internal(anyhow::anyhow!(error.clone())));
        }

        Ok(state
            .entities
            .iter()
            .filter(|entity| {
                let source_matches = match foreign_entity_source {
                    Some(source) => entity.foreign_entity_source == source,
                    None => true,
                };

                entity.foreign_entity_id == foreign_entity_id && source_matches
            })
            .cloned()
            .collect())
    }

    async fn get_foreign_entities_for_user(
        &self,
        _requesting_user: Option<String>,
        _source_ids: Vec<SourceId>,
        _limit: u32,
        _query: ForeignEntityListQuery,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        Err(unimplemented_foreign_entity_error())
    }

    async fn create_foreign_entity(
        &self,
        _create: CreateForeignEntity,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        Err(unimplemented_foreign_entity_error())
    }

    async fn delete_foreign_entity(&self, _id: uuid::Uuid) -> Result<(), ForeignEntityError> {
        Err(unimplemented_foreign_entity_error())
    }

    async fn patch_foreign_entity(
        &self,
        id: uuid::Uuid,
        patch: PatchForeignEntity,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        let mut state = self.state.lock().unwrap();
        state.patch_calls.push(PatchForeignEntityCall {
            id,
            patch: patch.clone(),
        });

        if let Some(error) = &state.patch_error {
            return Err(ForeignEntityError::Internal(anyhow::anyhow!(error.clone())));
        }

        let entity = state
            .entities
            .iter_mut()
            .find(|entity| entity.id == id)
            .ok_or(ForeignEntityError::NotFound(id))?;

        if let Some(foreign_entity_id) = patch.foreign_entity_id {
            entity.foreign_entity_id = foreign_entity_id;
        }

        if let Some(foreign_entity_source) = patch.foreign_entity_source {
            entity.foreign_entity_source = foreign_entity_source;
        }

        if let Some(metadata) = patch.metadata {
            entity.metadata = metadata;
        }

        if let Some(stored_for_id) = patch.stored_for_id {
            entity.stored_for_id = stored_for_id;
        }

        if let Some(stored_for_auth_entity) = patch.stored_for_auth_entity {
            entity.stored_for_auth_entity = stored_for_auth_entity;
        }

        entity.updated_at = Utc::now();

        Ok(entity.clone())
    }
}

fn test_user_id() -> MacroUserId<Lowercase<'static>> {
    MacroUserIdStr::try_from_email("user@example.com")
        .unwrap()
        .0
}

fn test_link(user_id: &MacroUserId<Lowercase<'static>>) -> GithubLink {
    GithubLink {
        id: uuid::Uuid::nil(),
        macro_id: MacroUserIdStr((*user_id).clone()),
        fusionauth_user_id: uuid::Uuid::nil(),
        github_username: "octocat".to_string(),
        github_user_id: "1".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn owner_link(fusionauth_user_id: uuid::Uuid) -> GithubLink {
    let owner_user_id = MacroUserIdStr::try_from_email("owner@example.com")
        .unwrap()
        .0;
    GithubLink {
        id: uuid::Uuid::from_u128(0xFFFF),
        macro_id: MacroUserIdStr(owner_user_id),
        fusionauth_user_id,
        github_username: "octocat".to_string(),
        github_user_id: "1".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn pull_request_ref() -> GithubPullRequestRef {
    GithubPullRequestRef {
        github_key: "macro/app/pull/7".to_string(),
        owner: "macro".to_string(),
        repo: "app".to_string(),
        number: 7,
        url: "https://github.com/macro/app/pull/7".to_string(),
        display_name: "macro/app#7".to_string(),
    }
}

fn foreign_entity(
    id: uuid::Uuid,
    foreign_entity_id: &str,
    foreign_entity_source: &str,
    metadata: serde_json::Value,
) -> ForeignEntity {
    ForeignEntity {
        id,
        foreign_entity_id: foreign_entity_id.to_string(),
        foreign_entity_source: foreign_entity_source.to_string(),
        metadata,
        stored_for_id: "stored-for-id".to_string(),
        stored_for_auth_entity: "user".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn service(
    repo: StubGithubRepo,
    oauth: StubGithubOauth,
    auth: StubAuth,
) -> GithubLinkServiceImpl<StubGithubRepo, StubGithubOauth, StubAuth, StubForeignEntityService> {
    service_with_foreign_entities(repo, oauth, auth, StubForeignEntityService::default())
}

fn service_with_foreign_entities(
    repo: StubGithubRepo,
    oauth: StubGithubOauth,
    auth: StubAuth,
    foreign_entity_service: StubForeignEntityService,
) -> GithubLinkServiceImpl<StubGithubRepo, StubGithubOauth, StubAuth, StubForeignEntityService> {
    GithubLinkServiceImpl::new(
        repo,
        oauth,
        auth,
        foreign_entity_service,
        GithubLinkConfig {
            client_id: "client-id".to_string(),
            client_secret: "client-secret".to_string(),
            idp_id: "github-idp".to_string(),
        },
    )
}

#[tokio::test]
async fn check_user_link_token_accepts_valid_token() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(false);
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        oauth.clone(),
        StubAuth::new("valid-token"),
    );

    let result = service.check_user_link_token(&user_id).await;

    assert!(result.is_ok());
    assert_eq!(oauth.validated_tokens(), vec!["valid-token".to_string()]);
}

#[tokio::test]
async fn check_user_link_token_returns_reauthentication_required_for_expired_token() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(true);
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        oauth.clone(),
        StubAuth::new("expired-token"),
    );

    let result = service.check_user_link_token(&user_id).await;

    assert!(matches!(result, Err(GithubError::ReauthenticationRequired)));
    assert_eq!(oauth.validated_tokens(), vec!["expired-token".to_string()]);
}

#[tokio::test]
async fn check_user_link_token_returns_no_link_found_without_db_link() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(false);
    let service = service(
        StubGithubRepo::unlinked(),
        oauth.clone(),
        StubAuth::new("valid-token"),
    );

    let result = service.check_user_link_token(&user_id).await;

    assert!(matches!(result, Err(GithubError::NoLinkFound)));
    assert!(oauth.validated_tokens().is_empty());
}

#[tokio::test]
async fn check_user_link_token_enrich_pull_requests_reauthenticates_before_details() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(true);
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        oauth.clone(),
        StubAuth::new("expired-token"),
    );

    let result = service
        .enrich_pull_requests(&user_id, vec![pull_request_ref()])
        .await;

    assert!(matches!(result, Err(GithubError::ReauthenticationRequired)));
    assert_eq!(oauth.validated_tokens(), vec!["expired-token".to_string()]);
    assert!(oauth.pull_request_detail_calls().is_empty());
}

#[tokio::test]
async fn enrich_pull_requests_patches_existing_foreign_entities_on_success() {
    let user_id = test_user_id();
    let pull_request = pull_request_ref();
    let first_foreign_entity_id = uuid::Uuid::from_u128(1);
    let second_foreign_entity_id = uuid::Uuid::from_u128(2);
    let skipped_foreign_entity_id = uuid::Uuid::from_u128(3);
    let existing_metadata = serde_json::json!({
        "comments": [
            {
                "id": 42,
                "body": "existing comment",
                "source": "issue_comment"
            }
        ],
        "checks": [
            {
                "id": 99,
                "name": "ci",
                "status": "completed"
            }
        ]
    });
    let foreign_entity_service = StubForeignEntityService::with_entities(vec![
        foreign_entity(
            first_foreign_entity_id,
            &pull_request.github_key,
            GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
            existing_metadata.clone(),
        ),
        foreign_entity(
            second_foreign_entity_id,
            &pull_request.github_key,
            GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
            serde_json::json!({ "other": true }),
        ),
        foreign_entity(
            skipped_foreign_entity_id,
            &pull_request.github_key,
            "github_issue",
            serde_json::json!({ "unchanged": true }),
        ),
    ]);
    let service = service_with_foreign_entities(
        StubGithubRepo::linked(test_link(&user_id)),
        StubGithubOauth::new(false),
        StubAuth::new("valid-token"),
        foreign_entity_service.clone(),
    );

    let pull_requests = service
        .enrich_pull_requests(&user_id, vec![pull_request.clone()])
        .await
        .unwrap();

    assert_eq!(pull_requests.len(), 1);
    let enriched_pull_request = &pull_requests[0];
    assert_eq!(
        enriched_pull_request.name.as_deref(),
        Some("Add token validation")
    );
    assert_eq!(
        foreign_entity_service.fetch_calls(),
        vec![FetchForeignEntitiesCall {
            foreign_entity_id: pull_request.github_key.clone(),
            foreign_entity_source: Some(GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE.to_string()),
        }]
    );

    let patch_calls = foreign_entity_service.patch_calls();
    assert_eq!(patch_calls.len(), 2);
    assert_eq!(patch_calls[0].id, first_foreign_entity_id);
    assert_eq!(patch_calls[1].id, second_foreign_entity_id);

    let first_metadata = foreign_entity_service
        .foreign_entity_by_id(first_foreign_entity_id)
        .unwrap()
        .metadata;
    let expected_first_metadata = enriched_pull_request
        .foreign_entity_metadata(Some(&existing_metadata))
        .unwrap();
    assert_eq!(first_metadata, expected_first_metadata);
    assert_eq!(first_metadata["comments"], existing_metadata["comments"]);
    assert_eq!(first_metadata["checks"], existing_metadata["checks"]);

    let second_metadata = foreign_entity_service
        .foreign_entity_by_id(second_foreign_entity_id)
        .unwrap()
        .metadata;
    assert_eq!(
        second_metadata,
        enriched_pull_request.foreign_entity_metadata(None).unwrap()
    );

    let skipped_metadata = foreign_entity_service
        .foreign_entity_by_id(skipped_foreign_entity_id)
        .unwrap()
        .metadata;
    assert_eq!(skipped_metadata, serde_json::json!({ "unchanged": true }));
}

#[tokio::test]
async fn enrich_pull_requests_does_not_patch_foreign_entities_on_detail_failure() {
    let user_id = test_user_id();
    let pull_request = pull_request_ref();
    let oauth = StubGithubOauth::new(false);
    oauth.fail_pull_request_details("GitHub details unavailable");
    let foreign_entity_service = StubForeignEntityService::with_entities(vec![foreign_entity(
        uuid::Uuid::from_u128(1),
        &pull_request.github_key,
        GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
        serde_json::json!({}),
    )]);
    let service = service_with_foreign_entities(
        StubGithubRepo::linked(test_link(&user_id)),
        oauth,
        StubAuth::new("valid-token"),
        foreign_entity_service.clone(),
    );
    let expected_pull_request = EnrichedGithubPullRequest::from_reference(pull_request.clone());

    let pull_requests = service
        .enrich_pull_requests(&user_id, vec![pull_request])
        .await
        .unwrap();

    assert_eq!(pull_requests, vec![expected_pull_request]);
    assert!(foreign_entity_service.fetch_calls().is_empty());
    assert!(foreign_entity_service.patch_calls().is_empty());
}

#[tokio::test]
async fn enrich_pull_requests_returns_enriched_response_when_foreign_entity_patch_fails() {
    let user_id = test_user_id();
    let pull_request = pull_request_ref();
    let foreign_entity_service = StubForeignEntityService::with_entities(vec![foreign_entity(
        uuid::Uuid::from_u128(1),
        &pull_request.github_key,
        GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
        serde_json::json!({}),
    )]);
    foreign_entity_service.fail_patches("database unavailable");
    let service = service_with_foreign_entities(
        StubGithubRepo::linked(test_link(&user_id)),
        StubGithubOauth::new(false),
        StubAuth::new("valid-token"),
        foreign_entity_service.clone(),
    );

    let pull_requests = service
        .enrich_pull_requests(&user_id, vec![pull_request])
        .await
        .unwrap();

    assert_eq!(pull_requests.len(), 1);
    assert_eq!(
        pull_requests[0].name.as_deref(),
        Some("Add token validation")
    );
    assert_eq!(foreign_entity_service.patch_calls().len(), 1);
}

#[tokio::test]
async fn link_user_as_sharer_reuses_owner_grant_without_calling_auth() {
    let user_id = test_user_id();
    let owner_fusionauth_user_id = uuid::Uuid::from_u128(0xAAAA_AAAA_AAAA_AAAA_AAAA_AAAA_AAAA_AAAA);
    let arg_fusionauth_user_id = uuid::Uuid::from_u128(0xBBBB_BBBB_BBBB_BBBB_BBBB_BBBB_BBBB_BBBB);

    let repo = StubGithubRepo::unlinked().with_account_owner(owner_link(owner_fusionauth_user_id));
    let auth = StubAuth::new("valid-token");
    let service = service(repo.clone(), StubGithubOauth::new(false), auth.clone());

    let result = service
        .link_user(
            &user_id,
            &arg_fusionauth_user_id,
            &uuid::Uuid::nil(),
            "https://redirect.example",
            "code",
        )
        .await;

    assert!(result.is_ok());

    let inserted = repo.inserted_links();
    assert_eq!(inserted.len(), 1);
    // SHARER reuses the OWNER's fusionauth grant, not the argument.
    assert_eq!(inserted[0].fusionauth_user_id, owner_fusionauth_user_id);
    assert_ne!(inserted[0].fusionauth_user_id, arg_fusionauth_user_id);

    assert_eq!(auth.link_user_calls(), 0);
    assert_eq!(repo.delete_in_progress_user_link_calls(), 1);
}

#[tokio::test]
async fn link_user_idempotent_relink_same_account_skips_insert() {
    let user_id = test_user_id();
    let existing = test_link(&user_id);

    let repo = StubGithubRepo::linked(existing.clone());
    let auth = StubAuth::new("valid-token");
    let service = service(repo.clone(), StubGithubOauth::new(false), auth.clone());

    let result = service
        .link_user(
            &user_id,
            &uuid::Uuid::from_u128(0xBBBB_BBBB_BBBB_BBBB_BBBB_BBBB_BBBB_BBBB),
            &uuid::Uuid::nil(),
            "https://redirect.example",
            "code",
        )
        .await;

    let link = result.expect("idempotent relink should succeed");
    // GithubLink does not derive PartialEq; compare identifying fields.
    assert_eq!(link.id, existing.id);
    assert_eq!(link.github_user_id, existing.github_user_id);
    assert_eq!(link.fusionauth_user_id, existing.fusionauth_user_id);

    assert_eq!(auth.link_user_calls(), 0);
    assert_eq!(repo.inserted_links().len(), 0);
    assert_eq!(repo.delete_in_progress_user_link_calls(), 1);
}

#[tokio::test]
async fn link_user_as_owner_creates_grant() {
    let user_id = test_user_id();
    let arg_fusionauth_user_id = uuid::Uuid::from_u128(0xBBBB_BBBB_BBBB_BBBB_BBBB_BBBB_BBBB_BBBB);

    // No link for this user and no existing owner for the github account.
    let repo = StubGithubRepo::unlinked();
    let auth = StubAuth::new("valid-token");
    let service = service(repo.clone(), StubGithubOauth::new(false), auth.clone());

    let result = service
        .link_user(
            &user_id,
            &arg_fusionauth_user_id,
            &uuid::Uuid::nil(),
            "https://redirect.example",
            "code",
        )
        .await;

    assert!(result.is_ok());

    let inserted = repo.inserted_links();
    assert_eq!(inserted.len(), 1);
    // OWNER (first linker) stores the argument's fusionauth grant.
    assert_eq!(inserted[0].fusionauth_user_id, arg_fusionauth_user_id);

    assert_eq!(auth.link_user_calls(), 1);
    assert_eq!(repo.delete_in_progress_user_link_calls(), 1);
}

#[tokio::test]
async fn delete_user_link_sharer_keeps_fusionauth_grant() {
    let user_id = test_user_id();

    let repo = StubGithubRepo::linked(test_link(&user_id)).with_link_count(2);
    let auth = StubAuth::new("valid-token");
    let service = service(repo.clone(), StubGithubOauth::new(false), auth.clone());

    let result = service.delete_user_link(&user_id).await;

    assert!(result.is_ok());
    // Other sharers remain, so the FusionAuth grant must stay in place.
    assert_eq!(auth.delete_user_link_calls(), 0);
    assert_eq!(repo.delete_github_link_calls(), 1);
}

#[tokio::test]
async fn delete_user_link_last_unlinks_fusionauth() {
    let user_id = test_user_id();

    let repo = StubGithubRepo::linked(test_link(&user_id)).with_link_count(1);
    let auth = StubAuth::new("valid-token");
    let service = service(repo.clone(), StubGithubOauth::new(false), auth.clone());

    let result = service.delete_user_link(&user_id).await;

    assert!(result.is_ok());
    // Last/only row for this github account: tear down the FusionAuth grant.
    assert_eq!(auth.delete_user_link_calls(), 1);
    assert_eq!(repo.delete_github_link_calls(), 1);
}
