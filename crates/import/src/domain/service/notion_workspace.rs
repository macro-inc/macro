//! Importing a Notion workspace: inventory, triage, a reviewed plan, and the
//! write that turns the plan into folders, documents, tasks and databases.
//!
//! Planning and writing both run detached from the request that started
//! them, recorded on the user's Notion run row: `running` while planning,
//! `ready` once a plan is staged, `importing` while writing, then
//! `completed`, `failed` or `dismissed` (cancelled). The process running a
//! job holds a lease on the run; when it dies or shuts down, another process
//! adopts the run and resumes the job (`run`), and every step checks the row
//! so a cancel from any process stops the job.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use agent_session::domain::model::AgentSessionId;
use futures::{FutureExt, StreamExt, stream};
use import_notion::domain::inventory::{all_users, inventory};
use import_notion::domain::model::{
    ImportScope, NotionDataSource, NotionId, NotionPage, NotionUser, PageMarkdown, Paged,
    SearchHit, SearchObject,
};
use import_notion::domain::ports::{NotionApi, NotionConnections, NotionError};
use macro_user_id::user_id::MacroUserIdStr;
use tracing::Instrument;
use uuid::Uuid;

use super::{ImportServiceImpl, NOTION_IMPORT_MODEL, NotionWorkspaceImporter};
use crate::domain::models::{
    ImportEntity, ImportKind, ImportSource, ImportStatus, NotionDecision, NotionImportReport,
    NotionJob, NotionSharing, NotionWriteChoices, RunStatus, ScanCounts, WrittenKind,
};
use crate::domain::ports::{
    CanonicalImportRepo, EntityCreator, ImportError, ImportRepo, NotionPlanRepo, NotionRunRepo,
    Result, SharedEntity, SlackWorkspaceSource, WorkspaceWriter, WrittenObjects,
};
use mcp_select::ConnectorSelect;
use object::{Outcome, Target};
use run::{IMPORT_STOPPED, JobControl, Stop, WriteSet};

mod object;
pub(super) mod plan;
mod report;
use super::workspace::Importer;
use super::workspace::run;
use super::workspace::scan;
pub(super) mod sharing;
pub(super) mod triage;
mod values;
pub(super) mod write;

pub(super) use report::report;
/// How often a running write checks whether the user cancelled it.
pub(super) const CANCEL_CHECK_EVERY: Duration = Duration::from_secs(3);
/// How often progress is pushed to the client while a job runs.
pub(super) const NOTIFY_EVERY: Duration = Duration::from_secs(2);

/// The default: no Notion workspace is reachable, so workspace imports report
/// Notion as not connected.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoNotionConnections;

/// An uninhabited client: [`NoNotionConnections`] never opens one.
pub enum NoNotionApi {}

impl NotionConnections for NoNotionConnections {
    type Api = NoNotionApi;

    async fn for_user(
        &self,
        _user: &MacroUserIdStr<'static>,
    ) -> std::result::Result<Option<Self::Api>, NotionError> {
        Ok(None)
    }
}

impl NotionApi for NoNotionApi {
    async fn search(
        &self,
        _object: SearchObject,
        _cursor: Option<String>,
    ) -> std::result::Result<Paged<SearchHit>, NotionError> {
        match *self {}
    }

    async fn page(&self, _id: &NotionId) -> std::result::Result<NotionPage, NotionError> {
        match *self {}
    }

    async fn page_markdown(
        &self,
        _id: &NotionId,
    ) -> std::result::Result<PageMarkdown, NotionError> {
        match *self {}
    }

    async fn data_source(
        &self,
        _id: &NotionId,
    ) -> std::result::Result<NotionDataSource, NotionError> {
        match *self {}
    }

    async fn database_sources(
        &self,
        _database: &NotionId,
    ) -> std::result::Result<Vec<NotionId>, NotionError> {
        match *self {}
    }

    async fn query_data_source(
        &self,
        _id: &NotionId,
        _cursor: Option<String>,
    ) -> std::result::Result<Paged<NotionPage>, NotionError> {
        match *self {}
    }

    async fn users(
        &self,
        _cursor: Option<String>,
    ) -> std::result::Result<Paged<NotionUser>, NotionError> {
        match *self {}
    }
}

/// Run states a new plan or write may start from.
const SETTLED: [RunStatus; 4] = [
    RunStatus::Ready,
    RunStatus::Completed,
    RunStatus::Failed,
    RunStatus::Dismissed,
];

/// Pushes progress to the client at most every [`NOTIFY_EVERY`].
struct Throttle(std::sync::Mutex<Option<Instant>>);

impl Throttle {
    fn new() -> Self {
        Self(std::sync::Mutex::new(None))
    }

    fn due(&self) -> bool {
        let Ok(mut last) = self.0.lock() else {
            return false;
        };
        let now = Instant::now();
        match *last {
            Some(previous) if now.duration_since(previous) < NOTIFY_EVERY => false,
            _ => {
                *last = Some(now);
                true
            }
        }
    }
}

impl<R, S, C, W, N> NotionWorkspaceImporter for ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: ConnectorSelect,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    async fn prepare_notion_import(
        &self,
        user: &MacroUserIdStr<'static>,
        scope: ImportScope,
        sharing: Option<NotionSharing>,
        wait: Duration,
    ) -> Result<NotionImportReport> {
        let sharing = match (sharing, self.repo.user_team_id(user).await?) {
            (Some(sharing), _) => sharing,
            (None, None) => NotionSharing::Personal,
            (None, Some(_)) => return Err(ImportError::NotionSharingRequired),
        };
        self.reap_stale_runs(user).await;
        self.adopt_stalled(Some(user)).await;
        if !self
            .repo
            .start_run(user, self.workspace_source, &SETTLED)
            .await?
        {
            return Err(ImportError::NotReady(
                "A workspace import is already being planned or written. Check its status, or cancel it first.",
            ));
        }
        self.hold_new_run(
            user,
            RunStatus::Running,
            &if self.workspace_source == ImportSource::Notion {
                NotionJob::Plan {
                    scope: scope.clone(),
                    sharing,
                }
            } else {
                NotionJob::TrackerPlan { sharing }
            },
        )
        .await?;
        self.notify(user).await;
        let service = self.clone();
        let owner = user.clone();
        let job = self.jobs.tracker.spawn(
            async move { service.plan_workspace(&owner, scope, sharing).await }.in_current_span(),
        );
        // The job keeps going if the wait runs out or the caller goes away.
        let _ = tokio::time::timeout(wait, job).await;
        self.notion_import_report(user).await
    }

    async fn notion_import_report(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<NotionImportReport> {
        self.reap_stale_runs(user).await;
        // A run whose process stopped is picked up here, and rows a stopped
        // write left claimed go back to staged.
        self.adopt_stalled(Some(user)).await;
        if let Err(error) = self.repo.settle_importing(user, IMPORT_STOPPED).await {
            tracing::warn!(error = ?error, "could not settle stopped notion rows");
        }
        self.current_report(user).await
    }

    async fn attach_notion_review(
        &self,
        user: &MacroUserIdStr<'static>,
        review_id: Uuid,
        session_id: AgentSessionId,
    ) -> Result<u64> {
        let attached = self
            .repo
            .attach_review(user, self.workspace_source, review_id, session_id)
            .await?;
        self.notify(user).await;
        Ok(attached)
    }

    async fn start_notion_write(
        &self,
        user: &MacroUserIdStr<'static>,
        review_id: Uuid,
        choices: NotionWriteChoices,
    ) -> Result<NotionImportReport> {
        if self.workspace_source != ImportSource::Notion {
            return self.start_tracker_write(user, review_id, choices).await;
        }
        let staged = self
            .repo
            .list(
                user,
                Some(self.workspace_source),
                Some(ImportStatus::Staged),
            )
            .await?;
        let mut planned: Vec<(ImportEntity, write::WriteItem)> = staged
            .into_iter()
            .filter(|row| row.review_id == Some(review_id))
            .filter_map(|row| write::WriteItem::from_entity(&row).map(|item| (row, item)))
            .collect();
        if planned.is_empty() {
            return Err(ImportError::NotReady(
                "This plan has nothing left to import.",
            ));
        }
        // The owner's sharing changes are recorded on the rows first, so a
        // resumed write shares exactly what they approved.
        let items: Vec<write::WriteItem> = planned.iter().map(|(_, item)| item.clone()).collect();
        let (to_share, to_keep) =
            sharing::sharing_changes(&items, &choices.shared, &choices.personal);
        self.repo
            .set_plan_sharing(user, &to_share, &to_keep)
            .await?;
        for (_, item) in &mut planned {
            if to_share.contains(&item.import_id) {
                item.shared = true;
            } else if to_keep.contains(&item.import_id) {
                item.shared = false;
            }
        }
        let team_id = self.repo.user_team_id(user).await?;
        if !self
            .repo
            .transition_run(
                user,
                self.workspace_source,
                &SETTLED,
                RunStatus::Importing,
                None,
            )
            .await?
        {
            return Err(ImportError::NotReady(
                "A workspace import is already being planned or written.",
            ));
        }
        self.hold_new_run(user, RunStatus::Importing, &NotionJob::Write { review_id })
            .await?;

        let mut to_write = Vec::new();
        for (row, item) in planned {
            let left_out = choices.excluded.contains(&row.id);
            match (left_out, item.decision) {
                (true, _) | (false, NotionDecision::Skip) => {
                    self.repo.discard(user, row.id).await?;
                }
                // Left staged for the agent, which handles it by hand.
                (false, NotionDecision::Hand) => {}
                (false, NotionDecision::Copy | NotionDecision::Tasks) => to_write.push(item),
            }
        }
        let ids: Vec<Uuid> = to_write.iter().map(|item| item.import_id).collect();
        // Shared objects are claimed for the team now, before anything is
        // written, so a teammate writing the same object links to this copy.
        let shared: Vec<Uuid> = to_write
            .iter()
            .filter(|item| item.shared && item.writes())
            .map(|item| item.import_id)
            .collect();
        let claimed: std::collections::HashSet<Uuid> = self
            .repo
            .claim_importing(user, &ids, &shared, team_id)
            .await?
            .into_iter()
            .map(|row| row.id)
            .collect();
        to_write.retain(|item| claimed.contains(&item.import_id));
        self.notify(user).await;

        let service = self.clone();
        let owner = user.clone();
        let set = WriteSet {
            review_id,
            all: to_write.clone(),
            pending: to_write,
        };
        self.jobs
            .tracker
            .spawn(async move { service.write_plan(&owner, set).await }.in_current_span());
        self.notion_import_report(user).await
    }

    async fn cancel_notion_import(&self, user: &MacroUserIdStr<'static>) -> Result<bool> {
        let cancelled = self
            .repo
            .transition_run(
                user,
                self.workspace_source,
                &[RunStatus::Running, RunStatus::Importing],
                RunStatus::Dismissed,
                Some("Cancelled"),
            )
            .await?;
        self.notify(user).await;
        Ok(cancelled)
    }
}

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: ConnectorSelect,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    /// Hold the run that just moved to `status` and record its job, so it
    /// survives this process; fails the run when that is not possible.
    pub(super) async fn hold_new_run(
        &self,
        user: &MacroUserIdStr<'static>,
        status: RunStatus,
        job: &NotionJob,
    ) -> Result<()> {
        if self.take_run(user, job).await? {
            return Ok(());
        }
        self.repo
            .transition_run(
                user,
                self.workspace_source,
                &[status],
                RunStatus::Failed,
                Some(IMPORT_STOPPED),
            )
            .await?;
        Err(ImportError::NotReady(
            "The Notion import could not start. Try it again.",
        ))
    }

    /// Plan and record the outcome on the run.
    pub(super) fn plan_workspace<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'static>,
        scope: ImportScope,
        sharing: NotionSharing,
    ) -> futures::future::BoxFuture<'a, ()> {
        let span = tracing::info_span!(
            "workspace_import.plan",
            source = self.workspace_source.as_ref(),
            %user,
            sharing = sharing.as_ref(),
            already_in_macro = tracing::field::Empty,
            stopped = tracing::field::Empty,
        );
        async move {
            let (control, _held) = self.hold_run(user);
            let outcome = tokio::select! {
                outcome = Importer::plan(self, user, scope, sharing, &control) => Some(outcome),
                () = control.stopped() => None,
            };
            if let Some(reason) = control.reason() {
                tracing::Span::current().record("stopped", reason.as_ref());
            }
            let outcome = match outcome {
                Some(outcome) => outcome,
                // Planning only reads, so the next process plans again.
                None if control.handed_over() => {
                    if control.reason() == Some(Stop::Shutdown) {
                        self.release_run(user).await;
                    }
                    return;
                }
                // Cancelled: the run is `dismissed` already.
                None => Ok(()),
            };
            let (to, error) = match &outcome {
                Ok(()) => (RunStatus::Ready, None),
                Err(error) => {
                    tracing::warn!(error = ?error, "notion import planning failed");
                    (RunStatus::Failed, Some(failure_text(error)))
                }
            };
            // A cancelled run is `dismissed` already, so this moves nothing.
            if let Err(error) = self.end_plan(user, to, error.as_deref()).await {
                tracing::warn!(error = ?error, "could not record the notion planning outcome");
            }
            self.notify(user).await;
        }
        .instrument(span)
        .boxed()
    }

    pub(super) async fn try_plan_workspace(
        &self,
        user: &MacroUserIdStr<'static>,
        scope: ImportScope,
        sharing: NotionSharing,
        control: &JobControl,
    ) -> Result<()> {
        let api = self
            .notion
            .for_user(user)
            .await?
            .ok_or(ImportError::NotionNotConnected)?;
        let (counts, scanned) = tokio::sync::watch::channel(ScanCounts::default());
        let walk = async move {
            let found = inventory(&api, &scope, &|progress| {
                counts.send_replace(ScanCounts {
                    pages: u32::try_from(progress.pages).unwrap_or(u32::MAX),
                    data_sources: u32::try_from(progress.data_sources).unwrap_or(u32::MAX),
                });
            })
            .await;
            // Dropping `counts` here lets the recorder write the final counts.
            drop(counts);
            found
        };
        let (found, ()) = tokio::join!(
            walk,
            scan::record_scan(&self.repo, user, scanned, ImportSource::Notion)
        );
        let found = found?;
        if control.reason().is_some() {
            return Ok(());
        }
        let tree = plan::PlanTree::new(&found);
        let team = self.repo.user_team_id(user).await?.is_some();
        let already_imported = self.already_in_macro(user, &tree).await?;
        tracing::Span::current().record("already_in_macro", already_imported.len());
        // The whole tree is staged before the decision model answers, so the
        // review shows it while each batch is decided.
        self.repo
            .replace_plan(
                user,
                self.workspace_source,
                &tree.staged_rows(sharing, team, &already_imported),
            )
            .await?;
        self.notify(user).await;
        // Objects already in Macro need no decision, so they cost no model call.
        let items = tree.triage_items(&already_imported);
        let usage = ai_usage::UsageContext::new(ai_usage::AiFeature::Import, user.clone());
        let batches = triage::decide(
            &items,
            ImportSource::Notion,
            sharing,
            || {
                let service = self.clone();
                let user = user.clone();
                async move { service.admit_ai(&user).await.map_err(anyhow::Error::from) }
            },
            self.recorder.as_ref(),
            usage,
            NOTION_IMPORT_MODEL,
        );
        self.stage_verdicts(user, &tree, &items, batches, sharing, team, control)
            .await
    }

    /// Write each batch of verdicts onto the staged plan as it arrives, then
    /// give anything the model never answered for the default verdict, so no
    /// row is left undecided once planning is done. Writing a verdict twice
    /// writes the same row, so a resumed plan is safe to stage again.
    #[expect(
        clippy::too_many_arguments,
        reason = "the planning run's state, passed once"
    )]
    pub(super) async fn stage_verdicts(
        &self,
        user: &MacroUserIdStr<'static>,
        tree: &plan::PlanTree,
        items: &[triage::TriageItem],
        batches: impl futures::Stream<Item = HashMap<String, triage::Verdict>>,
        sharing: NotionSharing,
        team: bool,
        control: &JobControl,
    ) -> Result<()> {
        let mut batches = std::pin::pin!(batches);
        let mut decided = std::collections::HashSet::new();
        while let Some(verdicts) = batches.next().await {
            if control.reason().is_some() {
                return Ok(());
            }
            decided.extend(verdicts.keys().cloned());
            self.repo
                .update_plan_rows(
                    user,
                    self.workspace_source,
                    &tree.decided_rows(&verdicts, sharing, team),
                )
                .await?;
            self.notify(user).await;
        }
        let unanswered: HashMap<String, triage::Verdict> = items
            .iter()
            .filter(|item| !decided.contains(&item.key))
            .map(|item| {
                (
                    item.key.clone(),
                    triage::default_verdict(item, "The decision model gave no answer"),
                )
            })
            .collect();
        if !unanswered.is_empty() {
            self.repo
                .update_plan_rows(
                    user,
                    self.workspace_source,
                    &tree.decided_rows(&unanswered, sharing, team),
                )
                .await?;
        }
        Ok(())
    }

    /// Write the plan's pending objects and record the outcome on the run.
    #[tracing::instrument(
        skip(self, set),
        fields(
            %user,
            review_id = %set.review_id,
            items = set.all.len(),
            pending = set.pending.len(),
            stopped = tracing::field::Empty,
            waiting_on_teammates = tracing::field::Empty,
        ),
        name = "workspace_import.write"
    )]
    pub(super) async fn write_plan(&self, user: &MacroUserIdStr<'static>, set: WriteSet) {
        let (control, _held) = self.hold_run(user);
        let outcome = Importer::write(self, user, set.review_id, &control).await;
        if let Some(reason) = control.reason() {
            tracing::Span::current().record("stopped", reason.as_ref());
        }
        // The rows still `importing` belong to whoever resumes the write.
        if control.handed_over() {
            if control.reason() == Some(Stop::Shutdown) {
                self.release_run(user).await;
            }
            return;
        }
        let (to, error) = match &outcome {
            Ok(0) => (RunStatus::Completed, None),
            Ok(failed) => (
                RunStatus::Completed,
                Some(format!(
                    "{failed} of {} objects could not be imported",
                    set.pending.len()
                )),
            ),
            Err(error) => {
                tracing::warn!(error = ?error, "notion import write failed");
                (RunStatus::Failed, Some(failure_text(error)))
            }
        };
        // Anything still claimed (a cancel, or a failure part way) goes back
        // to staged so it can be imported later.
        // Rows waiting on a teammate's copy stay, and link once it is written.
        for item in &set.pending {
            if let Ok(Some(row)) = self.repo.get(user, item.import_id).await
                && row.status == ImportStatus::Importing
                && row.waiting_on.is_none()
            {
                let reason = if outcome.is_ok() {
                    "Cancelled"
                } else {
                    "The import stopped"
                };
                let _ = self
                    .repo
                    .mark_import_failed(user, item.import_id, reason)
                    .await;
            }
        }
        if let Err(error) = self.end_write(user, to, error.as_deref()).await {
            tracing::warn!(error = ?error, "could not record the notion write outcome");
        }
        if self.workspace_source != ImportSource::Notion {
            let _ = self
                .repo
                .settle_importing(user, "The import stopped before this object finished")
                .await;
        }
        self.notify(user).await;
    }

    /// Write every pending object, reusing what earlier attempts wrote;
    /// returns how many failed.
    pub(super) async fn try_write_plan(
        &self,
        user: &MacroUserIdStr<'static>,
        set: &WriteSet,
        control: &JobControl,
    ) -> Result<usize> {
        let api = self
            .notion
            .for_user(user)
            .await?
            .ok_or(ImportError::NotionNotConnected)?;
        let team_id = self.repo.user_team_id(user).await?;
        let people = self.people(&api, user).await;
        let ids: Vec<Uuid> = set.all.iter().map(|item| item.import_id).collect();
        let written = self.repo.written(user, &ids).await?;
        let links = self.links(user, &set.all, &people).await?;
        let root = self.root_folder(user).await?;

        // Folders first, parents before children. A folder is shared only
        // when everything written inside it is; it is shared again on every
        // attempt, which is harmless, so a stop between creating and sharing
        // it heals on resume.
        let layout = write::folder_layout(&set.all);
        let shared_folders = match team_id {
            Some(_) => sharing::shared_folders(&set.all, &layout),
            None => std::collections::HashSet::new(),
        };
        let by_id: HashMap<Uuid, &write::WriteItem> =
            set.all.iter().map(|item| (item.import_id, item)).collect();
        let parents: HashMap<Uuid, Option<Uuid>> = set
            .all
            .iter()
            .map(|item| (item.import_id, item.parent))
            .collect();
        let mut folders: HashMap<Uuid, Uuid> = HashMap::new();
        for folder_row in &layout.folders {
            let Some(item) = by_id.get(folder_row) else {
                continue;
            };
            let progress = write::Progress::new(&self.repo, user, item.import_id, &written);
            let folder = match progress.get(WrittenKind::Folder) {
                Some(folder) => folder,
                None => {
                    let parent = write::folder_for(item, false, &folders, &parents, root);
                    let folder = self
                        .creator
                        .create_folder(user, &item.title, Some(parent))
                        .await?;
                    progress.record(WrittenKind::Folder, folder).await?;
                    folder
                }
            };
            if shared_folders.contains(folder_row) {
                self.creator
                    .share_with_team(user, SharedEntity::Folder(folder))
                    .await?;
            }
            folders.insert(*folder_row, folder);
        }

        let cancel = control.cancel.as_ref();
        let throttle = Throttle::new();
        let databases: tokio::sync::Mutex<HashMap<NotionId, write::WrittenDatabase>> =
            tokio::sync::Mutex::new(HashMap::new());
        let target = Target {
            api: &api,
            team_id,
            place: Place {
                folders: &folders,
                parents: &parents,
                root,
            },
            people: &people,
            links: &links,
            databases: &databases,
            written: &written,
            cancel,
        };
        let outcomes: Vec<Outcome> = stream::iter(set.pending.iter().cloned())
            .map(|item| {
                let target = &target;
                let throttle = &throttle;
                async move {
                    if cancel.stopped() {
                        return Outcome::Done;
                    }
                    let outcome = self.write_or_fail(user, &item, target, control).await;
                    if throttle.due() {
                        self.notify(user).await;
                    }
                    outcome
                }
                .boxed()
            })
            .buffer_unordered(write::WRITE_CONCURRENCY)
            .collect()
            .await;

        // Objects a teammate was writing: link to what they finished, take
        // over what they gave up, and wait on the rest.
        let mut failed = 0;
        let mut waiting = Vec::new();
        for (item, outcome) in set.pending.iter().zip(outcomes) {
            match outcome {
                Outcome::Done => {}
                Outcome::Failed => failed += 1,
                Outcome::Waiting(_) => waiting.push(item),
            }
        }
        tracing::Span::current().record("waiting_on_teammates", waiting.len());
        for item in waiting {
            if cancel.stopped() {
                break;
            }
            if self.settle_waiting(user, item, &target, control).await == Outcome::Failed {
                failed += 1;
            }
        }

        // Databases earlier attempts finished still take part in relations.
        let mut databases = databases.into_inner();
        let finished: Vec<&write::WriteItem> = set
            .all
            .iter()
            .filter(|item| {
                item.kind == ImportKind::DataSource
                    && item.decision == NotionDecision::Copy
                    && !databases.contains_key(&item.notion_id)
            })
            .collect();
        for item in finished {
            let progress = write::Progress::new(&self.repo, user, item.import_id, &written);
            match write::recorded_database(&api, item, &progress).await {
                Ok(Some(database)) => {
                    databases.insert(item.notion_id.clone(), database);
                }
                Ok(None) => {}
                Err(error) => {
                    tracing::warn!(error = ?error, "a written notion database was not reread");
                }
            }
        }
        if !databases.is_empty()
            && !cancel.stopped()
            && let Err(error) =
                write::link_relations(self.creator.as_ref(), &self.repo, user, &databases, cancel)
                    .await
        {
            tracing::warn!(error = ?error, "notion relations were not linked");
        }
        Ok(failed)
    }

    /// The user's "Notion" folder: the one earlier imports made while it
    /// still exists, otherwise a new one.
    async fn root_folder(&self, user: &MacroUserIdStr<'static>) -> Result<Uuid> {
        if let Some(folder) = self.repo.root_folder(user).await?
            && self.creator.folder_exists(user, folder).await?
        {
            return Ok(folder);
        }
        let folder = self
            .creator
            .create_folder(user, write::ROOT_FOLDER, None)
            .await?;
        self.repo.set_root_folder(user, folder).await?;
        Ok(folder)
    }

    /// Notion users matched to the user's team by email. Empty when Notion
    /// will not share emails; people columns then stay empty.
    async fn people(&self, api: &N::Api, user: &MacroUserIdStr<'static>) -> values::PeopleMap {
        let notion_users = match all_users(api).await {
            Ok(users) => users,
            Err(error) => {
                tracing::warn!(error = ?error, "notion users were not read; people stay empty");
                return values::PeopleMap::new();
            }
        };
        let members = self
            .creator
            .team_members(user)
            .await
            .unwrap_or_else(|error| {
                tracing::warn!(error = ?error, "team members were not read; people stay unmatched");
                Vec::new()
            });
        notion_users
            .into_iter()
            .map(|notion_user| {
                let email = notion_user.email.map(|email| email.to_lowercase());
                let macro_user = email.as_ref().and_then(|email| {
                    members
                        .iter()
                        .find(|member| &member.email == email)
                        .map(|member| member.user_id.clone())
                });
                (notion_user.id, values::Person { email, macro_user })
            })
            .collect()
    }

    /// Whether the user cancelled the import.
    pub(super) async fn cancelled(&self, user: &MacroUserIdStr<'static>) -> bool {
        match self.repo.list_runs(user).await {
            Ok(runs) => runs.iter().any(|run| {
                run.source == self.workspace_source && run.status == RunStatus::Dismissed
            }),
            Err(error) => {
                tracing::warn!(error = ?error, "could not read the notion run");
                false
            }
        }
    }
}

/// Where written objects go: the folders made so far and the import's root.
struct Place<'a> {
    folders: &'a HashMap<Uuid, Uuid>,
    parents: &'a HashMap<Uuid, Option<Uuid>>,
    root: Uuid,
}

impl Place<'_> {
    fn folder_for(&self, item: &write::WriteItem, own: bool) -> Uuid {
        write::folder_for(item, own, self.folders, self.parents, self.root)
    }
}

/// A failure as the user reads it on the run or the row.
fn failure_text(error: &ImportError) -> String {
    match error {
        ImportError::Other(error) => super::admission::failure_reason(error),
        other => other.to_string(),
    }
}
