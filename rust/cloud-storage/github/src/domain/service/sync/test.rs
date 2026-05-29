use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use crate::domain::{
    models::{
        EnrichedGithubPullRequest, GithubAppInstallationSource, GithubError,
        GithubInstallationAccessToken, GithubKey, GithubPullRequestCheckRun,
        GithubPullRequestComment, GithubPullRequestDetails, GithubPullRequestStatus, MacroTaskId,
        TeamTaskReference, ValidatedGithubWebhookEvent,
    },
    ports::{GithubSyncClient, GithubSyncRepo, GithubSyncService},
};
use document_sub_type::DocumentSubType;
use documents::domain::models::EditDocumentServiceArgs;
use documents::domain::{
    content::{DocumentContent, DocumentContentLocation},
    models::{CreateDocumentRepoArgs, DocumentError, LocationQueryParams},
    ports::DocumentService,
    response::{
        CreateDocumentResponseData, DocumentMetadataWithContent, DocumentResponse,
        GetDocumentResponseData, LocationResponseV3,
    },
};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, EntityType, OwnerAccessLevel, ViewAccessLevel,
};
use foreign_entity::domain::{
    models::{
        CreateForeignEntity, ForeignEntity, ForeignEntityError, PatchForeignEntity, SourceId,
    },
    ports::{ForeignEntityListQuery, ForeignEntityService},
};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::{DocumentBasic, DocumentMetadata};
use model_entity::Entity;
use models_permissions::share_permission::access_level::AccessLevel;

use super::*;

/// UUID that corresponds to the short ID `2BuyvtY3aeEvHx4uG8iD51`.
const KNOWN_TASK_UUID: &str = "0d0dc589-f301-43f1-8b11-4ab448ca4bb4";

/// SAFETY: This is used for testing only
/// Minimal RSA private key used only for test JWT signing.
const TEST_PEM: &str = "-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEAky4t+NMylQ8TEjJIKciwvjKWM+5EzSXDkvc+dlNN2g0/wRsr
CTkFE9tQdEpJASbUz8+TRnExM8rbAB3p0tAyhAino2UDYvMRCBH5tGIBxKAPejZ2
pEv63Gzk7xAlbIKyoOqdf/VUs5rNOsiB+l6/0Dbi2nBXFEjbQTNt33LOY6Smqu5f
tcvN9gxHMr+m+vhnuUraL39sP0AWEhml/aw+LLIPlO1Cfp/on0sxRGmd0bhqTVWa
o3fVqp8xqopQ3nCkZaYu6EUIzdg/ioktPEgY3kul/IS2QvJAfLAmi20/ahMLXJ+v
izWM11Qs4jwfjKDxtXBgU70bv3WMC4aaU6o7JQIDAQABAoIBAHXS5UiqQncj3z+U
80JIAH3y313pZDja/4s61U1CeTOTobNEvZofhJoV232NLo52eK14Xk1pNlthDRs1
10dGFvquNw3OQvzG256bTUyDnSi8fkd3LFlw3f3ySv+67ErHApth1v5l9w3lYmCp
vawih+n21nrKrlt1y9iRhGb6cJFBOsF8lmcFo9ijEzbRyaW+ou8J0ty9GNuwioET
RaimVOo0nct0lrN4A269C+LqHLRUpj2MdxYEH4+1ziSCRDhCIQhPxd0ylpcXVEYP
XubG5Kad8bueXn9HPtvkhxJJ0P9rD0M6+enPh5CdFPRg1qQchsoqSvRDxN4kwf5k
XzbLw8ECgYEAxDQrvwDaGDMpcMrNaxtyatUfLi4uuinDNYuK+45XqMSWKXehINMc
5bva0WBT3brKAdAoDRmZtfDiVvwc6Z59/WBSh+Zq29iLftazUhgCLejWFdIVO/SE
vAx6v3Ctyl0XgrkkV2wtKtpj9T8EU+8O9HnduP075VXrMmOwrh8/qbECgYEAwAkz
UG1fTs29BIbtAXauqhp14QM+J91viSQ7kzRIyElxp7S9IkAWWzei5K4piJGxBGBg
QwgviN0cpK8URtfFIXQijzcYMwKhf0RqPrX9Kwh+9FGHcK0SHCx3JMdzkhtNrkR3
1w+cjhP3VqsoZo/+reT7Wy6E4FlcrY6Rbo2qkbUCgYBZJiNibC6spEKGH3/q1NPO
Ovwp7Y4JxIQQRlFmL60g4AIi4VpzIbmVoR+x1wUEUKUM4dnw6drv0n3lbDRu6jbw
891MJqQTNHddsIxWFtaWqZ7s10ISte3BzCHR7o7ozheqrBkZJ+v19rlIa9O5l3vC
FcVrEpUuhTWS9b0HwOcaYQKBgCuOqq32cOS9876gIAfx9IIuyEgGZUXDizXvGvgz
psKPLhFdBH1NTgTYpMD74/3PFfipJ4xsweNoS8Pq1k2PSW5iGiij1YBUe28ThIm+
27K0FZ+zEmZzSyVKzKdx+fvM55y8ePY120u6qaJl5h8FUD3/LygqcAc3HbdcHA6Y
YXT1AoGAUyOZ7RPz8dLHWMA0+bRM4XGNxbyIjULKC/Fjf9bM3GIUWG8klxmBkCQJ
MEt9yPb3VfwFUyBSNJt4C6zDrnd+62oT+A9aJHJcUDUjqdBsmZamDu7xBAeLGxsn
sNRx7TF4iOEBkdJgBUoY4X/rZ+51FQOrdZGqeWo+8TjBhMQN7b4=
-----END RSA PRIVATE KEY-----";

/// Recorded update_task_status call.
#[derive(Debug, Clone)]
struct TaskStatusCall {
    entity_id: String,
    status: String,
}

struct StubDocumentService {
    task_status_calls: Mutex<Vec<TaskStatusCall>>,
}

impl StubDocumentService {
    fn new() -> Self {
        Self {
            task_status_calls: Mutex::new(Vec::new()),
        }
    }

    fn task_status_calls(&self) -> Vec<TaskStatusCall> {
        self.task_status_calls.lock().unwrap().clone()
    }

    fn task_metadata(document_id: &str) -> DocumentMetadata {
        DocumentMetadata {
            document_id: document_id.to_string(),
            document_version_id: 1,
            owner: MacroUserIdStr::try_from_email("test@example.com").unwrap(),
            document_name: "My Task".to_string(),
            file_type: Some("md".to_string()),
            sha: None,
            project_id: None,
            project_name: None,
            branched_from_id: None,
            branched_from_version_id: None,
            document_family_id: None,
            document_bom: None,
            modification_data: None,
            created_at: None,
            updated_at: None,
            deleted_at: None,
            sub_type: Some(DocumentSubType::Task),
        }
    }
}

impl DocumentService for StubDocumentService {
    async fn internal_get_basic_document(
        &self,
        _document_id: &str,
    ) -> Result<DocumentBasic, DocumentError> {
        unimplemented!()
    }
    async fn get_short_id(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, DocumentError> {
        unimplemented!()
    }
    async fn get_task_branch_name(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _document_name: String,
    ) -> Result<documents::domain::models::TaskBranchName, DocumentError> {
        unimplemented!()
    }
    async fn get_task_github_pull_requests(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _document_context: &DocumentBasic,
    ) -> Result<documents::domain::models::GithubPullRequestsResponse, DocumentError> {
        unimplemented!()
    }
    async fn get_project_children(
        &self,
        _project_id: &str,
    ) -> Result<Vec<Entity<'static>>, DocumentError> {
        unimplemented!()
    }
    async fn get_project_name(&self, _project_id: &str) -> Result<String, DocumentError> {
        unimplemented!()
    }
    async fn get_document(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<GetDocumentResponseData, DocumentError> {
        let document_id = receipt.entity().entity_id.clone();
        if document_id == KNOWN_TASK_UUID {
            Ok(GetDocumentResponseData {
                document_metadata: DocumentMetadataWithContent::new(
                    Self::task_metadata(&document_id),
                    DocumentContent::ready(DocumentContentLocation::SyncService),
                ),
                user_access_level: AccessLevel::Owner,
                view_location: None,
            })
        } else {
            Err(DocumentError::NotFound(document_id))
        }
    }
    async fn get_document_location(
        &self,
        _ctx: &DocumentBasic,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _params: LocationQueryParams,
    ) -> Result<LocationResponseV3, DocumentError> {
        unimplemented!()
    }
    async fn delete_document(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _project_id: Option<String>,
    ) -> Result<(), DocumentError> {
        unimplemented!()
    }
    async fn get_document_text(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, DocumentError> {
        unimplemented!()
    }
    async fn create_document(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _args: CreateDocumentRepoArgs,
        _job_id: Option<String>,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        unimplemented!()
    }

    async fn get_document_content(
        &self,
        _document_context: &DocumentBasic,
    ) -> Result<DocumentContent, DocumentError> {
        unimplemented!()
    }
    async fn update_task_status(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        status: &str,
    ) -> Result<(), DocumentError> {
        self.task_status_calls.lock().unwrap().push(TaskStatusCall {
            entity_id: receipt.entity().entity_id.clone(),
            status: status.to_string(),
        });
        Ok(())
    }

    async fn edit_document(
        &self,
        _entity_access_receipt: EntityAccessReceipt<EditAccessLevel>,
        _document_basic: DocumentBasic,
        _request: EditDocumentServiceArgs,
    ) -> Result<(), DocumentError> {
        Ok(())
    }

    async fn copy_document(
        &self,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
        _document_context: DocumentBasic,
        _user_id: MacroUserIdStr<'static>,
        _document_name: String,
        _query_version_id: Option<i64>,
        _sync_version_id: Option<model::sync_service::SyncServiceVersionID>,
    ) -> Result<DocumentResponse, DocumentError> {
        unimplemented!()
    }

    async fn get_document_comments(
        &self,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<documents::domain::models::CommentThread>, DocumentError> {
        unimplemented!()
    }

    async fn handle_task_properties(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _document_id: &str,
        _request: &documents::domain::models::CreateTaskRequest,
    ) -> Result<(), DocumentError> {
        unimplemented!()
    }
}

/// Stateful stub repo that tracks task IDs per github key.
struct StubSyncRepo {
    tasks: Mutex<HashMap<String, HashSet<String>>>,
    /// Maps (installation_id, normalized team_slug, team_task_id) -> task ID.
    team_task_references: Mutex<HashMap<(String, String, i32), MacroTaskId>>,
    /// Maps github_user_id -> macro_id for installation event lookups.
    github_links: Mutex<HashMap<String, String>>,
    /// Maps macro_id -> team_ids for installation event lookups.
    user_teams: Mutex<HashMap<String, Vec<uuid::Uuid>>>,
    /// Current github_app_installation source rows keyed by installation id.
    installation_source_rows: Mutex<HashMap<String, HashSet<GithubAppInstallationSource>>>,
    /// Recorded installation source upserts: (installation_id, sources).
    installation_sources: Mutex<Vec<(String, Vec<GithubAppInstallationSource>)>>,
}

impl StubSyncRepo {
    fn new() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
            team_task_references: Mutex::new(HashMap::new()),
            github_links: Mutex::new(HashMap::new()),
            user_teams: Mutex::new(HashMap::new()),
            installation_source_rows: Mutex::new(HashMap::new()),
            installation_sources: Mutex::new(Vec::new()),
        }
    }

    fn with_github_link(self, github_user_id: &str, macro_id: &str) -> Self {
        self.github_links
            .lock()
            .unwrap()
            .insert(github_user_id.to_string(), macro_id.to_string());
        self
    }

    fn with_user_teams(self, macro_id: &str, team_ids: Vec<uuid::Uuid>) -> Self {
        self.user_teams
            .lock()
            .unwrap()
            .insert(macro_id.to_string(), team_ids);
        self
    }

    fn with_team_task_reference(
        self,
        installation_id: &str,
        team_slug: &str,
        team_task_id: i32,
        task_id: MacroTaskId,
    ) -> Self {
        self.team_task_references.lock().unwrap().insert(
            (
                installation_id.to_string(),
                team_slug.to_ascii_lowercase(),
                team_task_id,
            ),
            task_id,
        );
        self
    }

    fn with_installation_sources(
        self,
        installation_id: &str,
        sources: Vec<GithubAppInstallationSource>,
    ) -> Self {
        {
            let mut rows = self.installation_source_rows.lock().unwrap();
            let row_sources = rows.entry(installation_id.to_string()).or_default();
            row_sources.extend(sources);
        }
        self
    }

    fn installation_sources(&self) -> Vec<(String, Vec<GithubAppInstallationSource>)> {
        self.installation_sources.lock().unwrap().clone()
    }
}

impl GithubSyncRepo for StubSyncRepo {
    type Err = anyhow::Error;

    async fn get_task_ids(&self, github_key: GithubKey) -> Result<Vec<MacroTaskId>, Self::Err> {
        let tasks = self.tasks.lock().unwrap();
        let ids = tasks
            .get(github_key.as_ref())
            .map(|set| {
                set.iter()
                    .filter_map(|s| MacroTaskId::from_short_uuid(s))
                    .collect()
            })
            .unwrap_or_default();
        Ok(ids)
    }

    async fn upsert_task_ids(
        &self,
        github_key: GithubKey,
        task_ids: &[MacroTaskId],
    ) -> Result<(), Self::Err> {
        let mut tasks = self.tasks.lock().unwrap();
        let set = tasks.entry(github_key.as_ref().to_string()).or_default();
        for id in task_ids {
            set.insert(id.short_uuid.clone());
        }
        Ok(())
    }

    async fn filter_duplicate_tasks(
        &self,
        github_key: GithubKey,
        task_ids: &[MacroTaskId],
    ) -> Result<Vec<MacroTaskId>, Self::Err> {
        let tasks = self.tasks.lock().unwrap();
        let existing = tasks.get(github_key.as_ref());
        Ok(task_ids
            .iter()
            .filter(|t| {
                existing
                    .map(|set| !set.contains(&t.short_uuid))
                    .unwrap_or(true)
            })
            .cloned()
            .collect())
    }

    async fn resolve_team_task_references(
        &self,
        installation_id: &str,
        references: &[TeamTaskReference],
    ) -> Result<Vec<MacroTaskId>, Self::Err> {
        let team_task_references = self.team_task_references.lock().unwrap();
        let mut seen = HashSet::new();
        let mut resolved = Vec::new();

        for reference in references {
            let key = (
                installation_id.to_string(),
                reference.team_slug.to_ascii_lowercase(),
                reference.team_task_id,
            );
            if let Some(task_id) = team_task_references.get(&key)
                && seen.insert(task_id.clone())
            {
                resolved.push(task_id.clone());
            }
        }

        Ok(resolved)
    }

    async fn get_macro_id_by_github_user_id(
        &self,
        github_user_id: &str,
    ) -> Result<Option<String>, Self::Err> {
        Ok(self
            .github_links
            .lock()
            .unwrap()
            .get(github_user_id)
            .cloned())
    }

    async fn get_user_team_ids(&self, macro_id: &str) -> Result<Vec<uuid::Uuid>, Self::Err> {
        Ok(self
            .user_teams
            .lock()
            .unwrap()
            .get(macro_id)
            .cloned()
            .unwrap_or_default())
    }

    async fn get_installation_sources(
        &self,
        installation_id: &str,
    ) -> Result<Vec<GithubAppInstallationSource>, Self::Err> {
        Ok(self
            .installation_source_rows
            .lock()
            .unwrap()
            .get(installation_id)
            .map(|sources| sources.iter().cloned().collect())
            .unwrap_or_default())
    }

    async fn upsert_installation_sources(
        &self,
        installation_id: &str,
        sources: &[GithubAppInstallationSource],
    ) -> Result<(), Self::Err> {
        {
            let mut rows = self.installation_source_rows.lock().unwrap();
            let row_sources = rows.entry(installation_id.to_string()).or_default();
            row_sources.extend(sources.iter().cloned());
        }
        self.installation_sources
            .lock()
            .unwrap()
            .push((installation_id.to_string(), sources.to_vec()));
        Ok(())
    }
}

/// Recorded PR comment call.
#[derive(Debug, Clone)]
struct PrCommentCall {
    owner: String,
    repo: String,
    pull_number: u64,
    body: String,
}

/// Recorded pull request details call.
#[derive(Debug, Clone)]
struct PullRequestDetailsCall {
    owner: String,
    repo: String,
    number: u64,
}

struct StubSyncClient {
    pr_comments: Mutex<Vec<PrCommentCall>>,
    pull_request_details: Mutex<HashMap<String, GithubPullRequestDetails>>,
    pull_request_details_calls: Mutex<Vec<PullRequestDetailsCall>>,
}

impl StubSyncClient {
    fn new() -> Self {
        Self {
            pr_comments: Mutex::new(Vec::new()),
            pull_request_details: Mutex::new(HashMap::new()),
            pull_request_details_calls: Mutex::new(Vec::new()),
        }
    }

    fn pr_comments(&self) -> Vec<PrCommentCall> {
        self.pr_comments.lock().unwrap().clone()
    }

    fn pull_request_details_calls(&self) -> Vec<PullRequestDetailsCall> {
        self.pull_request_details_calls.lock().unwrap().clone()
    }

    fn set_pull_request_details(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        details: GithubPullRequestDetails,
    ) {
        self.pull_request_details
            .lock()
            .unwrap()
            .insert(Self::pull_request_details_key(owner, repo, number), details);
    }

    fn pull_request_details_key(owner: &str, repo: &str, number: u64) -> String {
        GithubKey::new(owner, repo, number).to_string()
    }
}

impl GithubSyncClient for StubSyncClient {
    async fn generate_installation_access_token(
        &self,
        _jwt: &str,
        _installation_id: u64,
    ) -> Result<GithubInstallationAccessToken, GithubError> {
        Ok(GithubInstallationAccessToken {
            token: "test-token".to_string(),
            expires_at: "2099-01-01T00:00:00Z".to_string(),
        })
    }

    async fn create_pr_comment(
        &self,
        _access_token: &str,
        owner: &str,
        repo: &str,
        pull_number: u64,
        body: &str,
    ) -> Result<(), GithubError> {
        self.pr_comments.lock().unwrap().push(PrCommentCall {
            owner: owner.to_string(),
            repo: repo.to_string(),
            pull_number,
            body: body.to_string(),
        });
        Ok(())
    }

    async fn get_pull_request_details(
        &self,
        _access_token: &str,
        owner: &str,
        repo: &str,
        number: u64,
    ) -> Result<GithubPullRequestDetails, GithubError> {
        self.pull_request_details_calls
            .lock()
            .unwrap()
            .push(PullRequestDetailsCall {
                owner: owner.to_string(),
                repo: repo.to_string(),
                number,
            });

        self.pull_request_details
            .lock()
            .unwrap()
            .get(&Self::pull_request_details_key(owner, repo, number))
            .cloned()
            .ok_or_else(|| GithubError::Internal(anyhow::anyhow!("missing stub PR details")))
    }
}

fn foreign_entity_id_from_receipt(
    receipt: EntityAccessReceipt<ViewAccessLevel>,
) -> Result<uuid::Uuid, ForeignEntityError> {
    let entity = receipt.entity();
    if entity.entity_type != EntityType::ForeignEntity {
        return Err(ForeignEntityError::BadRequest(format!(
            "expected ForeignEntity receipt, got {:?}",
            entity.entity_type
        )));
    }

    uuid::Uuid::parse_str(&entity.entity_id).map_err(|_| {
        ForeignEntityError::BadRequest("foreign entity receipt id must be a valid UUID".to_string())
    })
}

struct StubForeignEntityService {
    foreign_entities: Mutex<Vec<ForeignEntity>>,
    create_calls: Mutex<Vec<CreateForeignEntity>>,
    patch_calls: Mutex<Vec<(uuid::Uuid, PatchForeignEntity)>>,
}

impl StubForeignEntityService {
    fn new() -> Self {
        Self {
            foreign_entities: Mutex::new(Vec::new()),
            create_calls: Mutex::new(Vec::new()),
            patch_calls: Mutex::new(Vec::new()),
        }
    }

    fn foreign_entities(&self) -> Vec<ForeignEntity> {
        self.foreign_entities.lock().unwrap().clone()
    }

    fn create_calls(&self) -> Vec<CreateForeignEntity> {
        self.create_calls.lock().unwrap().clone()
    }

    fn patch_calls(&self) -> Vec<(uuid::Uuid, PatchForeignEntity)> {
        self.patch_calls.lock().unwrap().clone()
    }
}

impl ForeignEntityService for StubForeignEntityService {
    async fn get_foreign_entity(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        let id = foreign_entity_id_from_receipt(receipt)?;
        self.get_foreign_entity_by_id(id).await
    }

    async fn get_foreign_entity_by_id(
        &self,
        id: uuid::Uuid,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        self.foreign_entities
            .lock()
            .unwrap()
            .iter()
            .find(|entity| entity.id == id)
            .cloned()
            .ok_or(ForeignEntityError::NotFound(id))
    }

    async fn get_foreign_entities_by_foreign_entity_id(
        &self,
        foreign_entity_id: &str,
        foreign_entity_source: Option<&str>,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        Ok(self
            .foreign_entities
            .lock()
            .unwrap()
            .iter()
            .filter(|entity| entity.foreign_entity_id == foreign_entity_id)
            .filter(|entity| {
                foreign_entity_source
                    .map(|source| entity.foreign_entity_source == source)
                    .unwrap_or(true)
            })
            .cloned()
            .collect())
    }

    async fn get_foreign_entities_for_user(
        &self,
        source_ids: Vec<SourceId>,
        limit: u32,
        _query: ForeignEntityListQuery,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        Ok(self
            .foreign_entities
            .lock()
            .unwrap()
            .iter()
            .filter(|entity| {
                source_ids.iter().any(|source_id| {
                    entity.stored_for_id.as_str() == source_id.id.as_str()
                        && entity.stored_for_auth_entity.as_str() == source_id.auth_entity.as_str()
                })
            })
            .take(limit as usize)
            .cloned()
            .collect())
    }

    async fn create_foreign_entity(
        &self,
        create: CreateForeignEntity,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        let now = chrono::Utc::now();
        let entity = ForeignEntity {
            id: uuid::Uuid::new_v4(),
            foreign_entity_id: create.foreign_entity_id.clone(),
            foreign_entity_source: create.foreign_entity_source.clone(),
            metadata: create.metadata.clone(),
            stored_for_id: create.stored_for_id.clone(),
            stored_for_auth_entity: create.stored_for_auth_entity.clone(),
            created_at: now,
            updated_at: now,
        };

        self.create_calls.lock().unwrap().push(create);
        self.foreign_entities.lock().unwrap().push(entity.clone());
        Ok(entity)
    }

    async fn delete_foreign_entity(&self, id: uuid::Uuid) -> Result<(), ForeignEntityError> {
        let mut foreign_entities = self.foreign_entities.lock().unwrap();
        let original_len = foreign_entities.len();
        foreign_entities.retain(|entity| entity.id != id);

        if foreign_entities.len() == original_len {
            return Err(ForeignEntityError::NotFound(id));
        }

        Ok(())
    }

    async fn patch_foreign_entity(
        &self,
        id: uuid::Uuid,
        patch: PatchForeignEntity,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        self.patch_calls.lock().unwrap().push((id, patch.clone()));

        let mut foreign_entities = self.foreign_entities.lock().unwrap();
        let Some(entity) = foreign_entities.iter_mut().find(|entity| entity.id == id) else {
            return Err(ForeignEntityError::NotFound(id));
        };

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
        entity.updated_at = chrono::Utc::now();

        Ok(entity.clone())
    }
}

type TestGithubSyncService = GithubSyncServiceImpl<
    StubDocumentService,
    StubSyncRepo,
    StubSyncClient,
    StubForeignEntityService,
>;
type TestServiceWithForeignEntityService = (TestGithubSyncService, Arc<StubForeignEntityService>);

fn make_sync_service() -> TestGithubSyncService {
    make_sync_service_with_doc_service().0
}

fn make_sync_service_with_repo(repo: StubSyncRepo) -> TestGithubSyncService {
    let doc_service = Arc::new(StubDocumentService::new());
    let foreign_entity_service = Arc::new(StubForeignEntityService::new());

    GithubSyncServiceImpl::new(
        GithubSyncConfig {
            webhook_secret: "test-webhook-secret".to_string(),
            github_sync_app_url: "test".to_string(),
            sync_app_pem: TEST_PEM.to_string(),
            sync_app_client_id: "test-sync-app-client-id".to_string(),
        },
        doc_service,
        foreign_entity_service,
        repo,
        StubSyncClient::new(),
    )
}

fn make_sync_service_with_doc_service() -> (TestGithubSyncService, Arc<StubDocumentService>) {
    let doc_service = Arc::new(StubDocumentService::new());
    let foreign_entity_service = Arc::new(StubForeignEntityService::new());

    let service = GithubSyncServiceImpl::new(
        GithubSyncConfig {
            webhook_secret: "test-webhook-secret".to_string(),
            github_sync_app_url: "test".to_string(),
            sync_app_pem: TEST_PEM.to_string(),
            sync_app_client_id: "test-sync-app-client-id".to_string(),
        },
        doc_service.clone(),
        foreign_entity_service,
        StubSyncRepo::new(),
        StubSyncClient::new(),
    );
    (service, doc_service)
}

fn make_sync_service_with_foreign_entity_service() -> TestServiceWithForeignEntityService {
    let repo = StubSyncRepo::new().with_installation_sources(
        "12345",
        vec![GithubAppInstallationSource::Team(
            "dddddddd-dddd-dddd-dddd-dddddddddddd".parse().unwrap(),
        )],
    );
    let service = make_sync_service_with_repo(repo);
    let foreign_entity_service = service.foreign_entity_service.clone();

    (service, foreign_entity_service)
}

fn expected_pull_request_metadata(
    title: &str,
    status: GithubPullRequestStatus,
    additions: Option<u64>,
    deletions: Option<u64>,
) -> serde_json::Value {
    serde_json::to_value(EnrichedGithubPullRequest {
        github_key: "my-org/my-repo/pull/42".to_string(),
        owner: "my-org".to_string(),
        repo: "my-repo".to_string(),
        number: 42,
        url: "https://github.com/my-org/my-repo/pull/42".to_string(),
        display_name: "my-org/my-repo#42".to_string(),
        name: Some(title.to_string()),
        status: Some(status),
        additions,
        deletions,
        comments: None,
        checks: None,
    })
    .unwrap()
}

fn expected_pull_request_metadata_from_details(
    details: &GithubPullRequestDetails,
) -> serde_json::Value {
    serde_json::to_value(EnrichedGithubPullRequest {
        github_key: "my-org/my-repo/pull/42".to_string(),
        owner: "my-org".to_string(),
        repo: "my-repo".to_string(),
        number: 42,
        url: "https://github.com/my-org/my-repo/pull/42".to_string(),
        display_name: "my-org/my-repo#42".to_string(),
        name: Some(details.title.clone()),
        status: Some(details.status()),
        additions: Some(details.additions),
        deletions: Some(details.deletions),
        comments: details.comments.clone(),
        checks: details.checks.clone(),
    })
    .unwrap()
}

fn pull_request_comment(id: u64, body: &str, source: &str) -> GithubPullRequestComment {
    GithubPullRequestComment {
        id,
        body: body.to_string(),
        author_login: Some("octocat".to_string()),
        author_association: Some("MEMBER".to_string()),
        url: Some(format!(
            "https://github.com/my-org/my-repo/pull/42#comment-{id}"
        )),
        created_at: None,
        updated_at: None,
        source: source.to_string(),
    }
}

fn pull_request_check_run(id: u64, name: &str, status: &str) -> GithubPullRequestCheckRun {
    GithubPullRequestCheckRun {
        id,
        name: name.to_string(),
        status: status.to_string(),
        conclusion: Some("success".to_string()),
        url: Some(format!("https://github.com/my-org/my-repo/runs/{id}")),
        started_at: None,
        completed_at: None,
    }
}

fn pull_request_details(
    title: &str,
    additions: u64,
    deletions: u64,
    comments: Option<Vec<GithubPullRequestComment>>,
    checks: Option<Vec<GithubPullRequestCheckRun>>,
) -> GithubPullRequestDetails {
    GithubPullRequestDetails {
        title: title.to_string(),
        state: "open".to_string(),
        merged_at: None,
        additions,
        deletions,
        comments,
        checks,
    }
}

#[tokio::test]
async fn pr_with_task_id_in_title() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" }
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());

    let comments = service.client.pr_comments();
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].owner, "my-org");
    assert_eq!(comments[0].repo, "my-repo");
    assert_eq!(comments[0].pull_number, 42);
    assert_eq!(
        comments[0].body,
        format!("[My Task](https://macro.com/app/task/{KNOWN_TASK_UUID})")
    );
}

#[tokio::test]
async fn pr_with_task_id_in_branch_name() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 7,
                "title": "some feature",
                "body": "no task ids here",
                "head": { "ref": "macro-2BuyvtY3aeEvHx4uG8iD51" }
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());

    let comments = service.client.pr_comments();
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].pull_number, 7);
}

#[tokio::test]
async fn pr_with_team_task_id_in_branch_name() {
    let task_id = MacroTaskId::from_uuid(&uuid::Uuid::parse_str(KNOWN_TASK_UUID).unwrap());
    let repo = StubSyncRepo::new().with_team_task_reference("12345", "eng", 123, task_id);
    let service = make_sync_service_with_repo(repo);

    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 7,
                "title": "some feature",
                "body": "no legacy task ids here",
                "head": { "ref": "whutch/eng-123-fix-some-bug" }
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());

    let comments = service.client.pr_comments();
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].pull_number, 7);
    assert_eq!(
        comments[0].body,
        format!("[My Task](https://macro.com/app/task/{KNOWN_TASK_UUID})")
    );
}

#[tokio::test]
async fn team_task_id_requires_installation_team_match() {
    let task_id = MacroTaskId::from_uuid(&uuid::Uuid::parse_str(KNOWN_TASK_UUID).unwrap());
    let repo = StubSyncRepo::new().with_team_task_reference("99999", "eng", 123, task_id);
    let service = make_sync_service_with_repo(repo);

    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 7,
                "title": "some feature",
                "body": null,
                "head": { "ref": "whutch/eng-123-fix-some-bug" }
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
    assert!(service.client.pr_comments().is_empty());
}

#[tokio::test]
async fn issue_comment_with_task_id() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "issue_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "issue": {
                "number": 99,
                "title": "some issue",
                "body": null,
                "head": { "ref": "main" }
            },
            "comment": {
                "body": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51"
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());

    let comments = service.client.pr_comments();
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].pull_number, 99);
}

#[tokio::test]
async fn event_with_no_task_ids() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "title": "just a normal PR",
                "body": "nothing special",
                "head": { "ref": "feature/no-task-id" }
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn unknown_event_type_skipped() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "ping".to_string(),
        serde_json::json!({"zen": "Keep it logically awesome."}),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn multiple_task_ids_in_one_event() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "title": "closes MACRO-abc123",
                "body": "also relates to MACRO-def456 and MACRO-ghi789",
                "head": { "ref": "main" }
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn pull_request_review_with_task_id() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request_review".to_string(),
        serde_json::json!({
            "action": "submitted",
            "pull_request": {
                "number": 10,
                "title": "some PR",
                "body": null,
                "head": { "ref": "main" }
            },
            "review": {
                "body": "Approved, relates to MACRO-2BuyvtY3aeEvHx4uG8iD51"
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());

    let comments = service.client.pr_comments();
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].pull_number, 10);
}

#[tokio::test]
async fn pull_request_review_comment_with_task_id() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request_review_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "comment": {
                "body": "This line is related to MACRO-abc123"
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

// ---------------------------------------------------------------------------
// Deduplication: repo tracks tasks already associated with a PR
// ---------------------------------------------------------------------------

#[tokio::test]
async fn duplicate_comment_not_posted_when_task_already_tracked() {
    let service = make_sync_service();

    let make_event = || {
        ValidatedGithubWebhookEvent::new(
            "pull_request".to_string(),
            serde_json::json!({
                "action": "opened",
                "pull_request": {
                    "number": 42,
                    "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                    "body": null,
                    "head": { "ref": "feature/some-branch" }
                },
                "repository": {
                    "name": "my-repo",
                    "owner": { "login": "my-org" }
                },
                "installation": { "id": 12345 }
            }),
        )
    };

    // First event — comment should be posted
    let event = make_event();
    service.process_webhook_event(&event).await.unwrap();
    assert_eq!(service.client.pr_comments().len(), 1);

    // Second event with same task ID — should NOT post a duplicate
    let event = make_event();
    service.process_webhook_event(&event).await.unwrap();
    assert_eq!(service.client.pr_comments().len(), 1);
}

// ---------------------------------------------------------------------------
// Deduplication: comment mentions task ID already in PR context
// ---------------------------------------------------------------------------

#[tokio::test]
async fn issue_comment_duplicate_task_id_skipped() {
    let service = make_sync_service();

    // First, open the PR with the task ID to populate the repo
    let pr_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 99,
                "title": "fixes MACRO-abc123",
                "body": null,
                "head": { "ref": "main" }
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&pr_event).await.unwrap();

    // Comment mentions the same task ID — should be skipped
    let comment_event = ValidatedGithubWebhookEvent::new(
        "issue_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "issue": {
                "number": 99,
                "title": "fixes MACRO-abc123",
                "body": null,
                "head": { "ref": "main" }
            },
            "comment": {
                "body": "Fixes MACRO-abc123"
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    let result = service.process_webhook_event(&comment_event).await;
    assert!(result.is_ok());
    // No additional comment posted (PR open posted one, comment should not)
    assert_eq!(service.client.pr_comments().len(), 0);
}

#[tokio::test]
async fn issue_comment_new_task_id_not_skipped() {
    let service = make_sync_service();
    // Comment introduces a new task ID not previously tracked
    let event = ValidatedGithubWebhookEvent::new(
        "issue_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "issue": {
                "title": "fixes MACRO-abc123",
                "body": null,
                "head": { "ref": "main" }
            },
            "comment": {
                "body": "Also fixes MACRO-def456"
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn review_duplicate_task_id_skipped_via_pr_context() {
    let service = make_sync_service();
    // PR title already has the task ID. The comment handler upserts PR context
    // tasks, so the review body's mention is considered a duplicate.
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request_review".to_string(),
        serde_json::json!({
            "action": "submitted",
            "pull_request": {
                "title": "MACRO-abc123 fix",
                "body": null,
                "head": { "ref": "main" }
            },
            "review": {
                "body": "Approved, relates to MACRO-abc123"
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn review_comment_mixed_new_and_duplicate() {
    let service = make_sync_service();
    // PR has MACRO-abc123 in branch (will be upserted as PR context),
    // comment mentions both abc123 (dup via context) and def456 (new)
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request_review_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "pull_request": {
                "title": "some fix",
                "body": null,
                "head": { "ref": "feature/macro-abc123" }
            },
            "comment": {
                "body": "Relates to MACRO-abc123 and MACRO-def456"
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

// ---------------------------------------------------------------------------
// Task status updates based on PR action
// ---------------------------------------------------------------------------

#[tokio::test]
async fn pr_opened_sets_task_status_in_review() {
    let (service, doc_service) = make_sync_service_with_doc_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": false
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let status_calls = doc_service.task_status_calls();
    assert_eq!(status_calls.len(), 1);
    assert_eq!(status_calls[0].entity_id, KNOWN_TASK_UUID);
    assert_eq!(status_calls[0].status, "In Review");
}

#[tokio::test]
async fn pr_merged_sets_task_status_completed() {
    let (service, doc_service) = make_sync_service_with_doc_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "closed",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": true
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let status_calls = doc_service.task_status_calls();
    assert_eq!(status_calls.len(), 1);
    assert_eq!(status_calls[0].entity_id, KNOWN_TASK_UUID);
    assert_eq!(status_calls[0].status, "Completed");
}

#[tokio::test]
async fn pr_closed_without_merge_sets_task_status_todo() {
    let (service, doc_service) = make_sync_service_with_doc_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "closed",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": false
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let status_calls = doc_service.task_status_calls();
    assert_eq!(status_calls.len(), 1);
    assert_eq!(status_calls[0].entity_id, KNOWN_TASK_UUID);
    assert_eq!(status_calls[0].status, "Not Started");
}

#[tokio::test]
async fn pr_closed_without_merge_sets_previously_tracked_task_status_todo() {
    let (service, doc_service) = make_sync_service_with_doc_service();

    let opened_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": false
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&opened_event).await.unwrap();

    let closed_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "closed",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": false
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&closed_event).await.unwrap();

    let status_calls = doc_service.task_status_calls();
    assert_eq!(status_calls.len(), 2);
    assert_eq!(status_calls[0].entity_id, KNOWN_TASK_UUID);
    assert_eq!(status_calls[0].status, "In Review");
    assert_eq!(status_calls[1].entity_id, KNOWN_TASK_UUID);
    assert_eq!(status_calls[1].status, "Not Started");
}

#[tokio::test]
async fn issue_comment_on_open_pr_sets_task_status_in_review() {
    let (service, doc_service) = make_sync_service_with_doc_service();
    let event = ValidatedGithubWebhookEvent::new(
        "issue_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "issue": {
                "number": 99,
                "title": "some issue",
                "body": null,
                "state": "open",
                "head": { "ref": "main" }
            },
            "comment": {
                "body": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51"
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let status_calls = doc_service.task_status_calls();
    assert_eq!(status_calls.len(), 1);
    assert_eq!(status_calls[0].entity_id, KNOWN_TASK_UUID);
    assert_eq!(status_calls[0].status, "In Review");
}

#[tokio::test]
async fn issue_comment_on_closed_pr_does_not_update_task_status() {
    let (service, doc_service) = make_sync_service_with_doc_service();
    let event = ValidatedGithubWebhookEvent::new(
        "issue_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "issue": {
                "number": 99,
                "title": "some issue",
                "body": null,
                "state": "closed",
                "head": { "ref": "main" }
            },
            "comment": {
                "body": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51"
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let status_calls = doc_service.task_status_calls();
    assert!(
        status_calls.is_empty(),
        "issue_comment on closed PR should not update task status"
    );
}

#[tokio::test]
async fn pr_merged_updates_status_even_when_already_tracked() {
    let (service, doc_service) = make_sync_service_with_doc_service();

    // First event: PR opened — posts comment and sets "In Review"
    let opened_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": false
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&opened_event).await.unwrap();
    assert_eq!(service.client.pr_comments().len(), 1);
    assert_eq!(doc_service.task_status_calls().len(), 1);
    assert_eq!(doc_service.task_status_calls()[0].status, "In Review");

    // Second event: PR merged — should NOT post a duplicate comment,
    // but SHOULD update status to "Completed"
    let merged_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "closed",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": true
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&merged_event).await.unwrap();

    // Still only 1 comment (no duplicate)
    assert_eq!(service.client.pr_comments().len(), 1);

    // But status was updated twice: "In Review" then "Completed"
    let status_calls = doc_service.task_status_calls();
    assert_eq!(status_calls.len(), 2);
    assert_eq!(status_calls[1].entity_id, KNOWN_TASK_UUID);
    assert_eq!(status_calls[1].status, "Completed");
}

// ---------------------------------------------------------------------------
// PR foreign entity upserts
// ---------------------------------------------------------------------------

#[tokio::test]
async fn pr_opened_upserts_foreign_entity_for_installation_source() {
    let (service, foreign_entity_service) = make_sync_service_with_foreign_entity_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "state": "open",
                "merged": false,
                "additions": 10,
                "deletions": 2
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let foreign_entities = foreign_entity_service.foreign_entities();
    assert_eq!(foreign_entities.len(), 1);

    let foreign_entity = &foreign_entities[0];
    assert_eq!(foreign_entity.foreign_entity_id, "my-org/my-repo/pull/42");
    assert_eq!(
        foreign_entity.foreign_entity_source,
        GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE
    );
    assert_eq!(
        foreign_entity.stored_for_id,
        "dddddddd-dddd-dddd-dddd-dddddddddddd"
    );
    assert_eq!(foreign_entity.stored_for_auth_entity, "team");
    assert_eq!(
        foreign_entity.metadata,
        expected_pull_request_metadata(
            "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
            GithubPullRequestStatus::Open,
            Some(10),
            Some(2),
        )
    );
    assert_eq!(foreign_entity_service.create_calls().len(), 1);
    assert!(foreign_entity_service.patch_calls().is_empty());
}

#[tokio::test]
async fn pr_opened_upserts_foreign_entity_for_user_installation_source() {
    let repo = StubSyncRepo::new().with_installation_sources(
        "77777",
        vec![GithubAppInstallationSource::User(
            "macro|solo@user.com".to_string(),
        )],
    );
    let service = make_sync_service_with_repo(repo);
    let foreign_entity_service = service.foreign_entity_service.clone();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "state": "open",
                "merged": false,
                "additions": 10,
                "deletions": 2
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 77777 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let foreign_entities = foreign_entity_service.foreign_entities();
    assert_eq!(foreign_entities.len(), 1);
    assert_eq!(foreign_entities[0].stored_for_id, "macro|solo@user.com");
    assert_eq!(foreign_entities[0].stored_for_auth_entity, "user");
}

#[tokio::test]
async fn pr_edit_patches_existing_foreign_entity_metadata() {
    let (service, foreign_entity_service) = make_sync_service_with_foreign_entity_service();
    let opened_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "state": "open",
                "merged": false,
                "additions": 10,
                "deletions": 2
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&opened_event).await.unwrap();

    let edited_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "edited",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51 with new title",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "state": "open",
                "merged": false,
                "additions": 25,
                "deletions": 7
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&edited_event).await.unwrap();

    let expected_metadata = expected_pull_request_metadata(
        "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51 with new title",
        GithubPullRequestStatus::Open,
        Some(25),
        Some(7),
    );
    let foreign_entities = foreign_entity_service.foreign_entities();
    assert_eq!(foreign_entities.len(), 1);
    assert_eq!(foreign_entities[0].metadata, expected_metadata);
    assert_eq!(foreign_entity_service.create_calls().len(), 1);

    let patch_calls = foreign_entity_service.patch_calls();
    assert_eq!(patch_calls.len(), 1);
    assert_eq!(patch_calls[0].1.metadata, Some(expected_metadata));
}

#[tokio::test]
async fn pr_closed_upserts_merged_pull_request_metadata() {
    let (service, foreign_entity_service) = make_sync_service_with_foreign_entity_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "closed",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "state": "closed",
                "merged": true,
                "merged_at": "2026-05-27T19:00:00Z",
                "additions": 10,
                "deletions": 2
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let foreign_entities = foreign_entity_service.foreign_entities();
    assert_eq!(foreign_entities.len(), 1);
    assert_eq!(
        foreign_entities[0].metadata,
        expected_pull_request_metadata(
            "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
            GithubPullRequestStatus::Merged,
            Some(10),
            Some(2),
        )
    );
}

#[tokio::test]
async fn pr_event_without_valid_tasks_still_upserts_foreign_entity() {
    let (service, foreign_entity_service) = make_sync_service_with_foreign_entity_service();
    let unknown_task_id = MacroTaskId::from_uuid(
        &uuid::Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap(),
    )
    .to_task_id_string();
    let title = format!("fixes {unknown_task_id}");
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": title.clone(),
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "state": "open",
                "merged": false,
                "additions": 10,
                "deletions": 2
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let foreign_entities = foreign_entity_service.foreign_entities();
    assert_eq!(foreign_entities.len(), 1);
    assert_eq!(
        foreign_entities[0].metadata,
        expected_pull_request_metadata(&title, GithubPullRequestStatus::Open, Some(10), Some(2))
    );
    assert_eq!(foreign_entity_service.create_calls().len(), 1);
    assert!(foreign_entity_service.patch_calls().is_empty());
}

#[tokio::test]
async fn pr_event_without_task_ids_still_upserts_foreign_entity() {
    let (service, foreign_entity_service) = make_sync_service_with_foreign_entity_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "just a normal PR",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "state": "open",
                "merged": false,
                "additions": 10,
                "deletions": 2
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let foreign_entities = foreign_entity_service.foreign_entities();
    assert_eq!(foreign_entities.len(), 1);
    assert_eq!(
        foreign_entities[0].metadata,
        expected_pull_request_metadata(
            "just a normal PR",
            GithubPullRequestStatus::Open,
            Some(10),
            Some(2),
        )
    );
    assert_eq!(foreign_entity_service.create_calls().len(), 1);
    assert!(foreign_entity_service.patch_calls().is_empty());
}

#[tokio::test]
async fn unhandled_pr_action_still_upserts_foreign_entity() {
    let (service, foreign_entity_service) = make_sync_service_with_foreign_entity_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "synchronize",
            "pull_request": {
                "number": 42,
                "title": "sync branch changes",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "state": "open",
                "merged": false,
                "additions": 12,
                "deletions": 3
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let foreign_entities = foreign_entity_service.foreign_entities();
    assert_eq!(foreign_entities.len(), 1);
    assert_eq!(
        foreign_entities[0].metadata,
        expected_pull_request_metadata(
            "sync branch changes",
            GithubPullRequestStatus::Open,
            Some(12),
            Some(3),
        )
    );
    assert_eq!(foreign_entity_service.create_calls().len(), 1);
    assert!(foreign_entity_service.patch_calls().is_empty());
}

#[tokio::test]
async fn foreign_entity_metadata_includes_comments_and_checks_from_sync_client() {
    let (service, foreign_entity_service) = make_sync_service_with_foreign_entity_service();
    let details = pull_request_details(
        "live pull request title",
        30,
        8,
        Some(vec![pull_request_comment(
            101,
            "Looks good",
            "issue_comment",
        )]),
        Some(vec![pull_request_check_run(201, "ci", "completed")]),
    );
    service
        .client
        .set_pull_request_details("my-org", "my-repo", 42, details.clone());

    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "webhook title",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "state": "open",
                "merged": false,
                "additions": 10,
                "deletions": 2
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let foreign_entities = foreign_entity_service.foreign_entities();
    assert_eq!(foreign_entities.len(), 1);
    assert_eq!(
        foreign_entities[0].metadata,
        expected_pull_request_metadata_from_details(&details)
    );

    let detail_calls = service.client.pull_request_details_calls();
    assert_eq!(detail_calls.len(), 1);
    assert_eq!(detail_calls[0].owner, "my-org");
    assert_eq!(detail_calls[0].repo, "my-repo");
    assert_eq!(detail_calls[0].number, 42);
}

#[tokio::test]
async fn foreign_entity_metadata_comment_event_refreshes_without_task_id() {
    let (service, foreign_entity_service) = make_sync_service_with_foreign_entity_service();
    let initial_details = pull_request_details("initial title", 10, 2, None, None);
    service
        .client
        .set_pull_request_details("my-org", "my-repo", 42, initial_details);

    let opened_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "initial title",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "state": "open",
                "merged": false,
                "additions": 10,
                "deletions": 2
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&opened_event).await.unwrap();

    let refreshed_details = pull_request_details(
        "refreshed title",
        12,
        3,
        Some(vec![pull_request_comment(
            102,
            "A new comment",
            "issue_comment",
        )]),
        Some(vec![pull_request_check_run(202, "ci", "completed")]),
    );
    service
        .client
        .set_pull_request_details("my-org", "my-repo", 42, refreshed_details.clone());

    let comment_event = ValidatedGithubWebhookEvent::new(
        "issue_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "issue": {
                "number": 42,
                "title": "initial title",
                "body": null,
                "state": "open",
                "pull_request": {
                    "url": "https://api.github.com/repos/my-org/my-repo/pulls/42"
                }
            },
            "comment": {
                "body": "No task reference in this comment"
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&comment_event).await.unwrap();

    let expected_metadata = expected_pull_request_metadata_from_details(&refreshed_details);
    let foreign_entities = foreign_entity_service.foreign_entities();
    assert_eq!(foreign_entities.len(), 1);
    assert_eq!(foreign_entities[0].metadata, expected_metadata);
    assert!(service.client.pr_comments().is_empty());

    let patch_calls = foreign_entity_service.patch_calls();
    assert_eq!(patch_calls.len(), 1);
    assert_eq!(patch_calls[0].1.metadata, Some(expected_metadata));
}

#[tokio::test]
async fn foreign_entity_metadata_check_run_refreshes_pull_request() {
    let (service, foreign_entity_service) = make_sync_service_with_foreign_entity_service();
    let initial_details = pull_request_details("initial title", 10, 2, None, None);
    service
        .client
        .set_pull_request_details("my-org", "my-repo", 42, initial_details);

    let opened_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "initial title",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "state": "open",
                "merged": false,
                "additions": 10,
                "deletions": 2
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&opened_event).await.unwrap();

    let refreshed_details = pull_request_details(
        "initial title",
        10,
        2,
        None,
        Some(vec![pull_request_check_run(203, "lint", "completed")]),
    );
    service
        .client
        .set_pull_request_details("my-org", "my-repo", 42, refreshed_details.clone());

    let check_run_event = ValidatedGithubWebhookEvent::new(
        "check_run".to_string(),
        serde_json::json!({
            "action": "completed",
            "check_run": {
                "pull_requests": [
                    { "number": 42 }
                ]
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service
        .process_webhook_event(&check_run_event)
        .await
        .unwrap();

    let expected_metadata = expected_pull_request_metadata_from_details(&refreshed_details);
    let foreign_entities = foreign_entity_service.foreign_entities();
    assert_eq!(foreign_entities.len(), 1);
    assert_eq!(foreign_entities[0].metadata, expected_metadata);

    let patch_calls = foreign_entity_service.patch_calls();
    assert_eq!(patch_calls.len(), 1);
    assert_eq!(patch_calls[0].1.metadata, Some(expected_metadata));
}

#[tokio::test]
async fn foreign_entity_metadata_preserves_existing_comments_when_refresh_omits_them() {
    let (service, foreign_entity_service) = make_sync_service_with_foreign_entity_service();
    let initial_details = pull_request_details(
        "initial title",
        10,
        2,
        Some(vec![pull_request_comment(
            103,
            "Keep this comment",
            "review",
        )]),
        Some(vec![pull_request_check_run(204, "ci", "completed")]),
    );
    service
        .client
        .set_pull_request_details("my-org", "my-repo", 42, initial_details.clone());

    let opened_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "initial title",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "state": "open",
                "merged": false,
                "additions": 10,
                "deletions": 2
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&opened_event).await.unwrap();

    let mut partial_details = pull_request_details(
        "partial refresh title",
        11,
        4,
        None,
        Some(vec![pull_request_check_run(205, "ci", "completed")]),
    );
    service
        .client
        .set_pull_request_details("my-org", "my-repo", 42, partial_details.clone());

    let edited_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "edited",
            "pull_request": {
                "number": 42,
                "title": "partial refresh title",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "state": "open",
                "merged": false,
                "additions": 11,
                "deletions": 4
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&edited_event).await.unwrap();

    partial_details.comments = initial_details.comments.clone();
    let expected_metadata = expected_pull_request_metadata_from_details(&partial_details);
    let foreign_entities = foreign_entity_service.foreign_entities();
    assert_eq!(foreign_entities.len(), 1);
    assert_eq!(foreign_entities[0].metadata, expected_metadata);
}

#[tokio::test]
async fn foreign_entity_metadata_non_pr_issue_comment_does_not_create_pull_request() {
    let (service, foreign_entity_service) = make_sync_service_with_foreign_entity_service();
    let event = ValidatedGithubWebhookEvent::new(
        "issue_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "issue": {
                "number": 42,
                "title": "plain issue",
                "body": null,
                "state": "open"
            },
            "comment": {
                "body": "No task reference in this issue comment"
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    assert!(foreign_entity_service.foreign_entities().is_empty());
    assert!(service.client.pull_request_details_calls().is_empty());
}

// ---------------------------------------------------------------------------
// New behavioral tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn pr_close_does_not_post_comment() {
    let (service, doc_service) = make_sync_service_with_doc_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "closed",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": true
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    // No comment posted on close
    assert!(
        service.client.pr_comments().is_empty(),
        "PR close should not post a new bot comment"
    );

    // But status should still be updated
    let status_calls = doc_service.task_status_calls();
    assert_eq!(status_calls.len(), 1);
    assert_eq!(status_calls[0].status, "Completed");
}

#[tokio::test]
async fn pr_open_does_not_search_existing_comments() {
    // On open, only PR title/body/branch are searched — not existing comments.
    // No tasks in the PR text, so nothing should happen.
    let (service, doc_service) = make_sync_service_with_doc_service();

    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "just a normal PR",
                "body": null,
                "head": { "ref": "feature/some-branch" }
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    assert!(service.client.pr_comments().is_empty());
    assert!(doc_service.task_status_calls().is_empty());
}

#[tokio::test]
async fn pr_close_picks_up_task_from_repo() {
    let (service, doc_service) = make_sync_service_with_doc_service();

    // First, open PR with the task to populate the repo
    let open_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": false
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&open_event).await.unwrap();

    // Close with a different title (no task ID in text), but repo remembers it
    let close_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "closed",
            "pull_request": {
                "number": 42,
                "title": "some feature",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": true
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&close_event).await.unwrap();

    // No comment posted on close
    assert_eq!(service.client.pr_comments().len(), 1); // only from open

    // Status should be updated from repo-tracked task
    let status_calls = doc_service.task_status_calls();
    assert_eq!(status_calls.len(), 2); // "In Review" from open, "Completed" from close
    assert_eq!(status_calls[1].entity_id, KNOWN_TASK_UUID);
    assert_eq!(status_calls[1].status, "Completed");
}

#[tokio::test]
async fn comment_deduplicates_against_repo() {
    let (service, _doc_service) = make_sync_service_with_doc_service();

    // Open PR with a task — tracked in repo
    let pr_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 99,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "main" }
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&pr_event).await.unwrap();
    assert_eq!(service.client.pr_comments().len(), 1);

    // A comment mentions the same task ID — should be deduped by the repo
    let comment_event = ValidatedGithubWebhookEvent::new(
        "issue_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "issue": {
                "number": 99,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "state": "open",
                "head": { "ref": "main" }
            },
            "comment": {
                "body": "Also see MACRO-2BuyvtY3aeEvHx4uG8iD51"
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&comment_event).await.unwrap();

    // No additional comment — task was already tracked in repo
    assert_eq!(
        service.client.pr_comments().len(),
        1,
        "comment should not re-trigger for task already tracked in repo"
    );
}

#[tokio::test]
async fn false_positive_macro_prefix_ignored() {
    // "macro-inc" matches the regex but does not correspond to a real task document.
    let (service, doc_service) = make_sync_service_with_doc_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "update macro-inc dependency",
                "body": null,
                "head": { "ref": "feature/update-deps" }
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    assert!(
        service.client.pr_comments().is_empty(),
        "false positive macro- prefix should not trigger a comment"
    );
    assert!(
        doc_service.task_status_calls().is_empty(),
        "false positive macro- prefix should not trigger a status update"
    );
}

// ---------------------------------------------------------------------------
// installation created
// ---------------------------------------------------------------------------

fn installation_created_event(sender_id: u64, installation_id: u64) -> ValidatedGithubWebhookEvent {
    ValidatedGithubWebhookEvent::new(
        "installation".to_string(),
        serde_json::json!({
            "action": "created",
            "installation": { "id": installation_id },
            "sender": { "login": "testuser", "id": sender_id }
        }),
    )
}

#[tokio::test]
async fn installation_created_associates_teams() {
    let team_a: uuid::Uuid = "dddddddd-dddd-dddd-dddd-dddddddddddd".parse().unwrap();
    let team_b: uuid::Uuid = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee".parse().unwrap();

    let repo = StubSyncRepo::new()
        .with_github_link("12345", "macro|user@user.com")
        .with_user_teams("macro|user@user.com", vec![team_a, team_b]);

    let service = make_sync_service_with_repo(repo);
    let event = installation_created_event(12345, 99999);

    service.process_webhook_event(&event).await.unwrap();

    let sources = service.repo.installation_sources();
    assert_eq!(
        sources,
        vec![(
            "99999".to_string(),
            vec![
                GithubAppInstallationSource::Team(team_a),
                GithubAppInstallationSource::Team(team_b),
            ],
        )]
    );
}

#[tokio::test]
async fn installation_created_no_github_link() {
    let service = make_sync_service();
    let event = installation_created_event(99999, 11111);

    // No github link for sender — should succeed without inserting anything
    service.process_webhook_event(&event).await.unwrap();

    assert!(service.repo.installation_sources().is_empty());
}

#[tokio::test]
async fn installation_created_no_teams_associates_user() {
    let repo = StubSyncRepo::new().with_github_link("12345", "macro|user@user.com");
    // user_teams is empty by default

    let service = make_sync_service_with_repo(repo);
    let event = installation_created_event(12345, 11111);

    service.process_webhook_event(&event).await.unwrap();

    let sources = service.repo.installation_sources();
    assert_eq!(
        sources,
        vec![(
            "11111".to_string(),
            vec![GithubAppInstallationSource::User(
                "macro|user@user.com".to_string(),
            )],
        )]
    );
}

#[tokio::test]
async fn installation_deleted_is_skipped() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "installation".to_string(),
        serde_json::json!({
            "action": "deleted",
            "installation": { "id": 12345 },
            "sender": { "login": "testuser", "id": 12345 }
        }),
    );

    // Should not error — just skips
    service.process_webhook_event(&event).await.unwrap();

    assert!(service.repo.installation_sources().is_empty());
}
