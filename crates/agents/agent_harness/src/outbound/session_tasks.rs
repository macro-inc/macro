//! A session's task, as the `documents` and `github` crates know it.
//!
//! Whether the owner may view a task, whether a document is a task, and which pull requests
//! a task has belong to the `documents` crate; how a pull request is linked to a task, and
//! which reference the webhook recognizes, belong to the `github` crate. These adapters only
//! translate between those services and the session's ports.

use std::sync::Arc;

use documents::domain::models::{DocumentError, GithubPullRequest};
use documents::domain::ports::DocumentService;
use entity_access::domain::models::{AccessError, EntityType, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use github::domain::models::{
    GithubKey, MacroTaskId, TeamTaskReference, pull_request_task_reference,
};
use github::domain::ports::GithubSyncRepo;
use github::domain::service::PullRequestTaskLinkService;
use macro_user_id::user_id::MacroUserIdStr;

use agent_session::domain::session_task::{
    PullRequestState, SessionTaskError, TaskDirectory, TaskDocumentId, TaskFacts, TaskPullRequest,
    TaskPullRequestLinker,
};

#[cfg(test)]
mod test;

/// [`TaskDirectory`] over the documents service, checked with entity access.
pub struct DocumentTaskDirectory<Documents, Access> {
    documents: Arc<Documents>,
    access: Arc<Access>,
}

impl<Documents, Access> DocumentTaskDirectory<Documents, Access> {
    /// Read tasks through `documents` after `access` grants the viewer a view receipt.
    pub fn new(documents: Arc<Documents>, access: Arc<Access>) -> Self {
        Self { documents, access }
    }
}

impl<Documents, Access> DocumentTaskDirectory<Documents, Access>
where
    Documents: DocumentService,
    Access: EntityAccessService,
{
    async fn view(
        &self,
        viewer: &MacroUserIdStr<'static>,
        task: &TaskDocumentId,
    ) -> Result<
        (
            entity_access::domain::models::EntityAccessReceipt<ViewAccessLevel>,
            model::document::DocumentBasic,
        ),
        SessionTaskError,
    > {
        let receipt = self
            .access
            .generate_entity_access_receipt::<ViewAccessLevel>(
                viewer,
                None,
                task.as_str(),
                EntityType::Document,
            )
            .await
            .map_err(access_error)?;
        let document = self
            .documents
            .internal_get_basic_document(task.as_str())
            .await
            .map_err(document_error)?;
        Ok((receipt, document))
    }
}

impl<Documents, Access> TaskDirectory for DocumentTaskDirectory<Documents, Access>
where
    Documents: DocumentService,
    Access: EntityAccessService,
{
    async fn task(
        &self,
        viewer: &MacroUserIdStr<'static>,
        task: &TaskDocumentId,
    ) -> Result<TaskFacts, SessionTaskError> {
        let (receipt, document) = self.view(viewer, task).await?;
        let identity = self
            .documents
            .get_task_identity(receipt, &document)
            .await
            .map_err(document_error)?;
        let short = MacroTaskId::from_short_uuid(&identity.short_id).ok_or_else(|| {
            SessionTaskError::Unavailable(rootcause::report!(
                "task short id {} is not a short uuid",
                identity.short_id
            ))
        })?;
        let team = identity
            .team_task
            .and_then(|team| TeamTaskReference::new(&team.team_slug, team.task_num));
        Ok(TaskFacts {
            id: task.clone(),
            title: identity.title,
            reference: pull_request_task_reference(&short, team.as_ref()),
            short_id: identity.short_id,
        })
    }

    async fn pull_requests(
        &self,
        viewer: &MacroUserIdStr<'static>,
        task: &TaskDocumentId,
    ) -> Result<Vec<TaskPullRequest>, SessionTaskError> {
        let (receipt, document) = self.view(viewer, task).await?;
        let response = self
            .documents
            .get_task_github_pull_requests(receipt, &document)
            .await
            .map_err(document_error)?;
        Ok(response
            .pull_requests
            .into_iter()
            .map(task_pull_request)
            .collect())
    }
}

/// A task's pull request as the session tools show it.
fn task_pull_request(pull_request: GithubPullRequest) -> TaskPullRequest {
    let state = pull_request
        .status
        .as_deref()
        .and_then(|status| match status {
            "open" => Some(PullRequestState::Open),
            "closed" => Some(PullRequestState::Closed),
            "merged" => Some(PullRequestState::Merged),
            unknown => {
                tracing::warn!(status = unknown, github_key = %pull_request.github_key, "unknown pull request status");
                None
            }
        });
    TaskPullRequest {
        url: pull_request.url,
        title: pull_request.name,
        state,
    }
}

/// A hidden task and a missing one are the same answer.
fn access_error(error: AccessError) -> SessionTaskError {
    match error {
        AccessError::Unauthorized
        | AccessError::UnauthorizedWithMessage(_)
        | AccessError::NotFound(_) => SessionTaskError::TaskNotFound,
        AccessError::BadRequest(_) => SessionTaskError::InvalidTaskReference,
        AccessError::Unavailable(report) | AccessError::Internal(report) => {
            SessionTaskError::Unavailable(report)
        }
    }
}

fn document_error(error: DocumentError) -> SessionTaskError {
    match error {
        DocumentError::NotFound(_) | DocumentError::Unauthorized | DocumentError::Gone => {
            SessionTaskError::TaskNotFound
        }
        // The documents service refuses task operations on other documents as a bad request.
        DocumentError::BadRequest(_) => SessionTaskError::NotATask,
        other => SessionTaskError::Unavailable(rootcause::report!("{other}")),
    }
}

/// [`TaskPullRequestLinker`] over the `github` crate's link service.
pub struct GithubTaskPullRequestLinker<Repo> {
    links: PullRequestTaskLinkService<Repo>,
}

impl<Repo: GithubSyncRepo> GithubTaskPullRequestLinker<Repo> {
    /// Wrap the `github` crate's link service.
    pub fn new(links: PullRequestTaskLinkService<Repo>) -> Self {
        Self { links }
    }
}

impl<Repo: GithubSyncRepo> TaskPullRequestLinker for GithubTaskPullRequestLinker<Repo> {
    async fn link(&self, github_key: &str, task: &TaskFacts) -> Result<(), SessionTaskError> {
        let malformed = || {
            SessionTaskError::Unavailable(rootcause::report!(
                "not an owner/repo/pull/number key: {github_key}"
            ))
        };
        let Some((owner, repo, number)) = github_key.split_once('/').and_then(|(owner, rest)| {
            rest.split_once("/pull/")
                .map(|(repo, number)| (owner, repo, number))
        }) else {
            return Err(malformed());
        };
        let number: u64 = number.parse().map_err(|_| malformed())?;
        let short = MacroTaskId::from_short_uuid(&task.short_id).ok_or_else(|| {
            SessionTaskError::Unavailable(rootcause::report!(
                "task short id {} is not a short uuid",
                task.short_id
            ))
        })?;
        self.links
            .link(GithubKey::new(owner, repo, number), short)
            .await
            .map_err(|error| SessionTaskError::Unavailable(rootcause::report!("{error}")))
    }
}
