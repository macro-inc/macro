//! Serving a pull request's changes: read once from GitHub per base and head, then from storage.
//!
//! A changeset's id and patch key are derived from the pull request and both commits, so every
//! user, team, and agent session reading the same range shares one stored copy. The patch
//! object may expire; reading it again re-reads the diff, as long as the pull request still has
//! that base and head.

use std::num::NonZeroU64;

use chrono::Utc;
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use git_patch::{
    BudgetedPatch, MAX_FILE_PATCH_BYTES, MAX_PATCH_BYTES, budget_patch, parse_git_patch, totals,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::{
    models::{
        ChangesetRange, GithubPullRequestChangesError, GithubPullRequestChangeset,
        GithubPullRequestDiff, GithubPullRequestDiffError, PullRequestRef, RepositorySlug,
        StoredGithubPullRequest, changeset_id, changeset_patch_key, github_key_of,
    },
    ports::{
        GithubPullRequestChanges, GithubPullRequestChangesetRepository,
        GithubPullRequestChangesets, GithubPullRequestDiffReader, GithubPullRequestPatchStore,
        GithubPullRequestService,
    },
};

#[cfg(test)]
mod test;

/// Stores pull request changesets: the summary in `changesets`, the patch in `patches`, read
/// from GitHub through `reader` once per base and head.
pub struct GithubPullRequestChangesetStore<Reader, Changesets, Patches> {
    reader: Reader,
    changesets: Changesets,
    patches: Patches,
}

impl<Reader, Changesets, Patches> GithubPullRequestChangesetStore<Reader, Changesets, Patches>
where
    Reader: GithubPullRequestDiffReader,
    Changesets: GithubPullRequestChangesetRepository,
    Patches: GithubPullRequestPatchStore,
{
    /// Build the store from its ports.
    pub fn new(reader: Reader, changesets: Changesets, patches: Patches) -> Self {
        Self {
            reader,
            changesets,
            patches,
        }
    }

    async fn stored(
        &self,
        id: Uuid,
    ) -> Result<Option<GithubPullRequestChangeset>, GithubPullRequestChangesError> {
        self.changesets
            .get_changeset(id)
            .await
            .map_err(|error| GithubPullRequestChangesError::Storage(error.into()))
    }

    /// Store the changes `diff` holds, unless their range is already stored.
    async fn store(
        &self,
        pull_request: &PullRequestRef,
        diff: GithubPullRequestDiff,
    ) -> Result<GithubPullRequestChangeset, GithubPullRequestChangesError> {
        let (base_sha, head_sha) = range_commits(&diff.range)?;
        let id = changeset_id(pull_request, base_sha, head_sha);
        if let Some(existing) = self.stored(id).await? {
            return Ok(existing);
        }

        let budgeted = budget(&diff.patch);
        let (additions, deletions) = totals(&budgeted.files);
        let patch_key = (!budgeted.patch.is_empty())
            .then(|| changeset_patch_key(pull_request, base_sha, head_sha));
        if let Some(key) = &patch_key {
            self.patches
                .put_patch(key, &budgeted.patch)
                .await
                .map_err(|error| GithubPullRequestChangesError::Storage(error.into()))?;
        }
        let changeset = GithubPullRequestChangeset {
            id,
            github_key: github_key_of(pull_request),
            pull_request: pull_request.clone(),
            range: diff.range,
            files: budgeted.files,
            additions,
            deletions,
            patch_bytes: budgeted.patch.len() as u64,
            truncated: budgeted.truncated,
            patch_key,
            captured_at: Utc::now(),
        };
        self.changesets
            .insert_changeset(&changeset)
            .await
            .map_err(|error| GithubPullRequestChangesError::Storage(error.into()))?;
        Ok(changeset)
    }
}

impl<Reader, Changesets, Patches> GithubPullRequestChangesets
    for GithubPullRequestChangesetStore<Reader, Changesets, Patches>
where
    Reader: GithubPullRequestDiffReader,
    Changesets: GithubPullRequestChangesetRepository,
    Patches: GithubPullRequestPatchStore,
{
    async fn changeset(
        &self,
        id: Uuid,
    ) -> Result<Option<GithubPullRequestChangeset>, GithubPullRequestChangesError> {
        self.stored(id).await
    }

    #[tracing::instrument(
        err,
        skip(self, user, pull_request),
        fields(repository = %pull_request.repository, number = %pull_request.number)
    )]
    async fn capture(
        &self,
        user: &MacroUserIdStr<'static>,
        pull_request: &PullRequestRef,
    ) -> Result<GithubPullRequestChangeset, GithubPullRequestChangesError> {
        let diff = self.reader.read(user, pull_request).await?;
        self.store(pull_request, diff).await
    }

    #[tracing::instrument(err, skip(self, user))]
    async fn patch(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<String, GithubPullRequestChangesError> {
        let changeset = self
            .stored(id)
            .await?
            .ok_or(GithubPullRequestChangesError::NotFound)?;
        let Some(key) = changeset.patch_key.as_deref() else {
            return Ok(String::new());
        };
        if let Some(patch) = self
            .patches
            .get_patch(key)
            .await
            .map_err(|error| GithubPullRequestChangesError::Storage(error.into()))?
        {
            return Ok(patch);
        }

        // The stored copy expired: GitHub still has it only while the pull request has the same
        // base and head.
        let diff = self.reader.read(user, &changeset.pull_request).await?;
        let (base_sha, head_sha) = range_commits(&diff.range)?;
        if changeset_id(&changeset.pull_request, base_sha, head_sha) != id {
            return Err(GithubPullRequestChangesError::Moved);
        }
        let budgeted = budget(&diff.patch);
        self.patches
            .put_patch(key, &budgeted.patch)
            .await
            .map_err(|error| GithubPullRequestChangesError::Storage(error.into()))?;
        Ok(budgeted.patch)
    }
}

/// Serves a pull request's changes to callers holding view access to one of its records.
pub struct GithubPullRequestChangesServiceImpl<PullRequests, Changesets> {
    pull_requests: PullRequests,
    changesets: Changesets,
}

impl<PullRequests, Changesets> GithubPullRequestChangesServiceImpl<PullRequests, Changesets>
where
    PullRequests: GithubPullRequestService,
    Changesets: GithubPullRequestChangesets,
{
    /// Resolve records through `pull_requests` and read changes through `changesets`.
    pub fn new(pull_requests: PullRequests, changesets: Changesets) -> Self {
        Self {
            pull_requests,
            changesets,
        }
    }
}

impl<PullRequests, Changesets> GithubPullRequestChanges
    for GithubPullRequestChangesServiceImpl<PullRequests, Changesets>
where
    PullRequests: GithubPullRequestService,
    Changesets: GithubPullRequestChangesets,
{
    #[tracing::instrument(err, skip(self, receipt))]
    async fn changes(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<GithubPullRequestChangeset, GithubPullRequestChangesError> {
        let user = authenticated_user(&receipt)?;
        let stored = self.pull_requests.get_pull_request(receipt).await?;
        let pull_request = pull_request_ref(&stored)?;

        // Webhooks keep the row's base and head current, so a stored range answers without
        // asking GitHub.
        let base_sha = stored.base.as_ref().and_then(|base| base.sha.as_deref());
        let head_sha = stored.head.as_ref().and_then(|head| head.sha.as_deref());
        if let (Some(base_sha), Some(head_sha)) = (base_sha, head_sha)
            && let Some(changeset) = self
                .changesets
                .changeset(changeset_id(&pull_request, base_sha, head_sha))
                .await?
        {
            return Ok(changeset);
        }

        self.changesets.capture(&user, &pull_request).await
    }

    #[tracing::instrument(err, skip(self, receipt))]
    async fn patch(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        changeset: Uuid,
    ) -> Result<String, GithubPullRequestChangesError> {
        let user = authenticated_user(&receipt)?;
        let stored = self.pull_requests.get_pull_request(receipt).await?;
        let changes = self
            .changesets
            .changeset(changeset)
            .await?
            .ok_or(GithubPullRequestChangesError::NotFound)?;
        if !changes.github_key.eq_ignore_ascii_case(&stored.github_key) {
            return Err(GithubPullRequestChangesError::NotFound);
        }
        self.changesets.patch(&user, changeset).await
    }
}

fn budget(patch: &str) -> BudgetedPatch {
    budget_patch(
        parse_git_patch(patch),
        MAX_PATCH_BYTES,
        MAX_FILE_PATCH_BYTES,
    )
}

/// The base and head commits of `range`; GitHub always reports both for a pull request.
fn range_commits(range: &ChangesetRange) -> Result<(&str, &str), GithubPullRequestChangesError> {
    match (range.base.sha.as_deref(), range.head.sha.as_deref()) {
        (Some(base), Some(head)) => Ok((base, head)),
        _ => Err(GithubPullRequestDiffError::Other(anyhow::anyhow!(
            "GitHub reported no base or head commit"
        ))
        .into()),
    }
}

fn authenticated_user(
    receipt: &EntityAccessReceipt<ViewAccessLevel>,
) -> Result<MacroUserIdStr<'static>, GithubPullRequestChangesError> {
    receipt
        .get_authenticated_user()
        .cloned()
        .map_err(|_| GithubPullRequestChangesError::Unauthorized)
}

fn pull_request_ref(
    stored: &StoredGithubPullRequest,
) -> Result<PullRequestRef, GithubPullRequestChangesError> {
    let number = u64::try_from(stored.number)
        .ok()
        .and_then(NonZeroU64::new)
        .ok_or(GithubPullRequestChangesError::NotFound)?;
    let repository = RepositorySlug::parse(&format!("{}/{}", stored.owner, stored.repo))
        .ok_or(GithubPullRequestChangesError::NotFound)?;
    Ok(PullRequestRef { repository, number })
}
