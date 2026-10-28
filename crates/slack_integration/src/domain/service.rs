//! Administrator use cases. Receipts scope every repository operation; storage
//! only sees persisted manifest entries. Readiness is committed by the repository
//! with its outbox, never by sending a queue message from this service.

use std::collections::HashSet;

use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt, EntityType};

use super::{models::*, ports::*};

#[cfg(test)]
mod test;

/// Admin orchestration with a team-scoped backend rollout predicate. The host
/// supplies current configuration; frontend feature flags confer no authority.
#[derive(Clone)]
pub struct SlackImportService<R, S, L, N, A, G> {
    repo: R,
    storage: S,
    ledger: L,
    notifier: N,
    authorizer: A,
    enabled: G,
    limits: ImportLimits,
}

impl<R, S, L, N, A, G> SlackImportService<R, S, L, N, A, G> {
    /// Construct with effective limits shared by the repository and browser.
    /// Reject unusable configuration before serving requests.
    pub fn new(
        repo: R,
        storage: S,
        ledger: L,
        notifier: N,
        authorizer: A,
        enabled: G,
        limits: ImportLimits,
    ) -> Result<Self, ImportError> {
        if limits.registration_batch == 0
            || limits.registration_batch > 50
            || limits.conversations == 0
            || limits.zip_entries == 0
            || limits.part_records == 0
            || limits.database_batch_messages == 0
            || limits.record_bytes == 0
            || limits.part_bytes < limits.record_bytes
            || limits.json_bytes == 0
            || limits.database_batch_bytes < limits.record_bytes
            || limits.selected_bytes < limits.part_bytes.max(limits.json_bytes)
            || limits.selected_bytes > i64::MAX as u64
        {
            return Err(ImportError::InvalidInput);
        }
        Ok(Self {
            repo,
            storage,
            ledger,
            notifier,
            authorizer,
            enabled,
            limits,
        })
    }
}

impl<R, S, L, N, A, G> SlackImportService<R, S, L, N, A, G>
where
    R: ImportRepo,
    S: ImportStorage,
    L: ImportLedger,
    N: ImportNotifier,
    A: ImportAuthorizer + ImportProgressAccess,
    G: Fn(TeamId) -> bool + Send + Sync + 'static,
{
    async fn disclose_targets(
        &self,
        access: &EntityAccessReceipt<AdminTeamRole>,
        jobs: &mut [ImportProgress],
    ) {
        let targets: Vec<_> = jobs
            .iter()
            .flat_map(|job| &job.conversations)
            .filter_map(|conversation| conversation.channel_id)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let mut visible = HashSet::new();
        if let Ok(viewer) = access.get_authenticated_user() {
            for batch in targets.chunks(500) {
                // A disclosure outage must not turn a committed write into a failed
                // mutation. Keep progress and source metadata, but fail closed on IDs.
                match self.authorizer.participating_targets(viewer, batch).await {
                    Ok(ids) => visible.extend(ids),
                    Err(error) => {
                        tracing::warn!(error = ?error.current_context(), "Slack import target disclosure unavailable")
                    }
                }
            }
        }
        for conversation in jobs.iter_mut().flat_map(|job| &mut job.conversations) {
            if conversation.status == ConversationStatus::Skipped
                || conversation
                    .channel_id
                    .is_some_and(|id| !visible.contains(&id))
            {
                conversation.channel_id = None;
            }
        }
    }

    fn team(&self, access: &EntityAccessReceipt<AdminTeamRole>) -> Result<TeamId, ImportError> {
        if access.entity().entity_type != EntityType::Team {
            return Err(ImportError::AdminRequired);
        }
        access
            .entity()
            .entity_id
            .parse()
            .map_err(|_| ImportError::AdminRequired)
    }

    fn require_enabled(&self, team: TeamId) -> Result<(), ImportError> {
        if !(self.enabled)(team) {
            return Err(ImportError::Disabled);
        }
        Ok(())
    }

    async fn notify(&self, team: TeamId, progress: &ImportProgress) {
        // The caller may be another administrator. Never notify that caller in
        // place of the original requester, and revalidate the requester first.
        let result: PortResult<()> = async {
            let Some(requester) = self.repo.requested_by(team, progress.job_id).await? else {
                return Ok(());
            };
            self.authorizer.require_admin(team, &requester).await?;
            self.notifier
                .invalidate(
                    &requester,
                    team,
                    progress.job_id,
                    progress.revision,
                    progress.status,
                )
                .await
        }
        .await;
        let _ = result.inspect_err(|error| {
            tracing::warn!(error = ?error.current_context(), "Slack import invalidation failed; polling remains available");
        });
    }
}

impl<R, S, L, N, A, G> ImportService for SlackImportService<R, S, L, N, A, G>
where
    R: ImportRepo,
    S: ImportStorage,
    L: ImportLedger,
    N: ImportNotifier,
    A: ImportAuthorizer + ImportProgressAccess,
    G: Fn(TeamId) -> bool + Send + Sync + 'static,
{
    async fn create(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        command: CreateImport,
    ) -> Result<ImportProgress, ImportError> {
        let team = self.team(&access)?;
        self.require_enabled(team)?;
        // V1 requires a directly authenticated human, not a bot principal or
        // even a user-scoped bot's acting-user context.
        let requester = access
            .get_authenticated_user()
            .map_err(|_| ImportError::AdminRequired)?;
        validate_create(&command, &self.limits)?;
        // Binding comparison and creation are one transaction, including replay
        // checks. A separate preflight binding check would race other creates.
        let mut progress = self
            .repo
            .create(team, requester, &command, &self.limits)
            .await
            .map_err(public_error)?;
        self.notify(team, &progress).await;
        self.disclose_targets(&access, std::slice::from_mut(&mut progress))
            .await;
        Ok(progress)
    }

    async fn register_uploads(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        job: JobId,
        command: RegisterUploads,
    ) -> Result<Vec<UploadGrant>, ImportError> {
        let team = self.team(&access)?;
        self.require_enabled(team)?;
        validate_batch(command.descriptors.iter().map(|d| &d.upload), &self.limits)?;
        for descriptor in &command.descriptors {
            descriptor
                .validate(&self.limits)
                .map_err(|_| ImportError::LimitExceeded)?;
        }
        // The transaction checks selection, immutable seals, closure and total
        // bytes before any signing. Exact retries do not consume quota twice.
        let registered = self
            .repo
            .register(team, job, &command)
            .await
            .map_err(public_error)?;
        let mut grants = Vec::with_capacity(registered.len());
        for upload in registered {
            grants.push(self.storage.grant(&upload).await.map_err(public_error)?);
        }
        Ok(grants)
    }

    async fn complete_uploads(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        job: JobId,
        command: CompleteUploads,
    ) -> Result<ImportProgress, ImportError> {
        let team = self.team(&access)?;
        self.require_enabled(team)?;
        validate_batch(command.uploads.iter(), &self.limits)?;
        // Resolve the ENTIRE batch before issuing any HEAD; an unregistered or
        // wrong-team identity must not trigger storage I/O for a partial batch.
        let registered = self
            .repo
            .uploads(team, job, &command.uploads)
            .await
            .map_err(public_error)?;
        let mut verified = Vec::with_capacity(registered.len());
        for upload in registered {
            verified.push(self.storage.verify(&upload).await.map_err(public_error)?);
        }
        let mut progress = self
            .repo
            .complete(team, job, &verified, command.seal.as_ref())
            .await
            .map_err(public_error)?;
        self.notify(team, &progress).await;
        self.disclose_targets(&access, std::slice::from_mut(&mut progress))
            .await;
        Ok(progress)
    }

    async fn finalize(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        command: JobCommand,
    ) -> Result<ImportProgress, ImportError> {
        let team = self.team(&access)?;
        let mut progress = self
            .repo
            .finalize(team, command.job_id)
            .await
            .map_err(public_error)?;
        self.notify(team, &progress).await;
        self.disclose_targets(&access, std::slice::from_mut(&mut progress))
            .await;
        Ok(progress)
    }

    async fn cancel(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        command: JobCommand,
    ) -> Result<ImportProgress, ImportError> {
        let team = self.team(&access)?;
        let mut progress = self
            .repo
            .cancel(team, command.job_id)
            .await
            .map_err(public_error)?;
        self.notify(team, &progress).await;
        self.disclose_targets(&access, std::slice::from_mut(&mut progress))
            .await;
        Ok(progress)
    }

    async fn progress(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        command: JobCommand,
    ) -> Result<ImportProgress, ImportError> {
        let team = self.team(&access)?;
        let mut progress = self
            .repo
            .progress(team, command.job_id)
            .await
            .map_err(public_error)?
            .ok_or(ImportError::Unavailable)?;
        self.disclose_targets(&access, std::slice::from_mut(&mut progress))
            .await;
        Ok(progress)
    }

    async fn list(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        before: Option<JobId>,
    ) -> Result<ImportPage, ImportError> {
        let team = self.team(&access)?;
        let mut jobs = self.repo.list(team, before).await.map_err(public_error)?;
        self.disclose_targets(&access, &mut jobs).await;
        let next_cursor = if jobs.len() == 50 {
            jobs.last().map(|job| job.job_id)
        } else {
            None
        };
        let source_binding = self
            .ledger
            .source_binding(team)
            .await
            .map_err(public_error)?;
        Ok(ImportPage {
            jobs,
            next_cursor,
            limits: self.limits,
            source_binding,
        })
    }
}

fn public_error(error: rootcause::Report<ImportError>) -> ImportError {
    error.into_current_context()
}

fn validate_batch<'a>(
    uploads: impl Iterator<Item = &'a UploadId>,
    limits: &ImportLimits,
) -> Result<(), ImportError> {
    let mut ids = HashSet::new();
    for upload in uploads {
        if !ids.insert(upload) {
            return Err(ImportError::InvalidInput);
        }
        if ids.len() > limits.registration_batch as usize {
            return Err(ImportError::LimitExceeded);
        }
    }
    Ok(())
}

fn validate_create(command: &CreateImport, limits: &ImportLimits) -> Result<(), ImportError> {
    if command.conversations.is_empty() {
        return Err(ImportError::InvalidInput);
    }
    if command.conversations.len() > limits.conversations as usize {
        return Err(ImportError::LimitExceeded);
    }
    let mut ids = HashSet::new();
    let mut folders = HashSet::new();
    for metadata in &command.conversations {
        if !ids.insert(&metadata.slack_channel_id)
            || !folders.insert(&metadata.folder)
            || metadata.name.trim().is_empty()
            || metadata.name.chars().any(char::is_control)
        {
            return Err(ImportError::InvalidInput);
        }
        if metadata
            .message_count
            .is_some_and(|count| count > i64::MAX as u64)
        {
            return Err(ImportError::LimitExceeded);
        }
        // Do not infer kind from a Slack ID prefix or reject missing timestamps,
        // empty memberships, or unsupported DM pairs: those are valid source
        // metadata and have explicit worker fallback/skip behavior.
    }
    if serde_json::to_vec(command)
        .map_err(|_| ImportError::InvalidInput)?
        .len() as u64
        > limits.json_bytes
    {
        return Err(ImportError::LimitExceeded);
    }
    Ok(())
}
