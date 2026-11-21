//! Writing an approved plan: folders mirroring the page tree, documents,
//! databases with their rows and relations, and task lists.
//!
//! A write can stop part way (a crash, a deploy) and resume in another
//! process, so it never creates the same thing twice: documents and tasks
//! get ids derived from their ledger row and Notion object, which Macro
//! refuses to create twice, and everything else is recorded as it is made
//! ([`Progress`]) and reused when the write resumes.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use futures::{FutureExt, StreamExt, stream};
use import_notion::domain::inventory::all_rows;
use import_notion::domain::macro_cells::{PeopleMap, capped_name, derived_id};
use import_notion::domain::model::NotionId;
use import_notion::domain::ports::NotionApi;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{
    ImportEntity, ImportKind, NotionDecision, NotionDocMeta, NotionTaskFields, WrittenKind,
    WrittenObject,
};
use crate::domain::ports::{
    ImportVisibility, NotionLinks, NotionPageLink, NotionUserLink, SharedEntity, SourceDates,
    WorkspaceWriter, WrittenObjects,
};

use super::values::{task_body, task_properties};

mod database;
mod reservation;
pub(super) use database::{
    PreparedDatabase, WrittenDatabase, link_relations, prepare_database, recorded_database,
    write_prepared_database,
};

#[cfg(test)]
mod test;

/// Objects written at once.
pub(super) const WRITE_CONCURRENCY: usize = 4;
/// Source-specific reservation failures tolerated within one ledger generation.
pub(super) const RESERVATION_ATTEMPTS: usize = 3;
/// Row bodies fetched at once within one database.
const BODY_CONCURRENCY: usize = 3;
/// Name of the folder every workspace import writes into.
pub(super) const ROOT_FOLDER: &str = "Notion";

/// Ledger entity types for what an import creates.
pub(super) const DOCUMENT_ENTITY: &str = "md";
pub(super) const DATABASE_ENTITY: &str = "database";
pub(super) const FOLDER_ENTITY: &str = "project";

/// A cancellation checkpoint, kept distinct from provider and source errors.
#[derive(Debug, thiserror::Error)]
#[error("Cancelled")]
pub(super) struct Cancelled;

/// Set once the write must stop (the user cancelled, the process is shutting
/// down, or another process took the run over); long writes check it between
/// batches, rows and tasks so a stop takes effect within seconds.
#[derive(Debug, Default)]
pub(in crate::domain::service) struct Cancel(std::sync::atomic::AtomicBool);

impl Cancel {
    /// Mark the import cancelled.
    pub fn stop(&self) {
        self.0.store(true, std::sync::atomic::Ordering::Relaxed);
    }

    /// Whether the import was cancelled.
    pub fn stopped(&self) -> bool {
        self.0.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Fail with "Cancelled" once the import was cancelled.
    pub fn ensure_running(&self) -> anyhow::Result<()> {
        if self.stopped() {
            return Err(Cancelled.into());
        }
        Ok(())
    }
}

/// A plan row ready to write.
#[derive(Debug, Clone, PartialEq)]
pub(in crate::domain::service) struct WriteItem {
    /// The ledger row.
    pub import_id: Uuid,
    /// Planned objects referencing an external source, for placement reporting.
    pub dependency_of: Vec<String>,
    /// The ledger row it sits under, if any.
    pub parent: Option<Uuid>,
    /// The Notion object.
    pub notion_id: NotionId,
    /// A page or a data source.
    pub kind: ImportKind,
    /// The title.
    pub title: String,
    /// What to do with it.
    pub decision: NotionDecision,
    /// For a task list: which columns hold the task fields.
    pub task_fields: NotionTaskFields,
    /// Shared with the user's team once written.
    pub shared: bool,
    /// Whether the owner may change `shared`.
    pub shareable: bool,
    /// A teammate's copy shared with the team stands in for it.
    pub already_imported: bool,
}

impl WriteItem {
    /// Whether writing the plan creates something for this object, rather
    /// than linking a teammate's copy.
    pub fn writes(&self) -> bool {
        matches!(self.decision, NotionDecision::Copy | NotionDecision::Tasks)
            && !self.already_imported
    }

    /// Read a staged ledger row; `None` for rows that are not plan items, or
    /// not decided yet.
    pub fn from_entity(entity: &ImportEntity) -> Option<Self> {
        let meta: NotionDocMeta = serde_json::from_value(entity.metadata.clone()).ok()?;
        let plan = meta.plan?;
        Some(Self {
            import_id: entity.id,
            dependency_of: plan.dependency_of,
            parent: entity.parent_id,
            notion_id: NotionId::parse(&entity.foreign_id)?,
            kind: entity.kind,
            title: meta.title,
            decision: plan.decision?,
            task_fields: plan.task_fields.unwrap_or_default(),
            shared: plan.shared,
            shareable: plan.shareable,
            already_imported: plan.already_imported.is_some(),
        })
    }
}

/// Which folder each written object goes in.
#[derive(Debug, Clone, PartialEq, Default)]
pub(super) struct FolderLayout {
    /// Pages that become folders (they have something under them), in the
    /// order to create them: parents first.
    pub folders: Vec<Uuid>,
}

/// Plan rows that have something being written under them, in an order
/// where every such row's parents come first.
pub(super) fn folder_layout(items: &[WriteItem]) -> FolderLayout {
    let by_id: HashMap<Uuid, &WriteItem> =
        items.iter().map(|item| (item.import_id, item)).collect();
    let mut needs_folder: HashSet<Uuid> = HashSet::new();
    for item in items {
        // Every page above a written object becomes a folder, so the tree
        // survives even when a page in the middle is not written itself.
        let mut current = item.parent;
        let mut guard = 0;
        while let Some(parent) = current {
            guard += 1;
            if guard > items.len() || !needs_folder.insert(parent) {
                break;
            }
            current = by_id.get(&parent).and_then(|parent| parent.parent);
        }
    }
    let mut ordered: Vec<Uuid> = needs_folder.into_iter().collect();
    ordered.sort_by_key(|id| depth(*id, &by_id));
    FolderLayout { folders: ordered }
}

fn depth(id: Uuid, by_id: &HashMap<Uuid, &WriteItem>) -> usize {
    let mut depth = 0;
    let mut current = by_id.get(&id).and_then(|item| item.parent);
    while let Some(parent) = current {
        depth += 1;
        if depth > by_id.len() {
            break;
        }
        current = by_id.get(&parent).and_then(|item| item.parent);
    }
    depth
}

/// The folder `item` goes in: its own when it became one, otherwise its
/// nearest folder above, otherwise the import's root.
pub(super) fn folder_for(
    item: &WriteItem,
    own: bool,
    folders: &HashMap<Uuid, Uuid>,
    parents: &HashMap<Uuid, Option<Uuid>>,
    root: Uuid,
) -> Uuid {
    if own && let Some(folder) = folders.get(&item.import_id) {
        return *folder;
    }
    let mut current = item.parent;
    let mut guard = 0;
    while let Some(parent) = current {
        if let Some(folder) = folders.get(&parent) {
            return *folder;
        }
        guard += 1;
        if guard > parents.len() {
            break;
        }
        current = parents.get(&parent).copied().flatten();
    }
    root
}

/// Where the plan's pages and people resolve in Macro: every page gets the
/// id of the document it becomes (`imported` when it already exists,
/// otherwise [`document_id`], known before anything is written), and every
/// person matched to a teammate their account.
pub(super) fn notion_links(
    items: &[WriteItem],
    imported: &HashMap<NotionId, Uuid>,
    people: &PeopleMap,
) -> NotionLinks {
    let pages = items
        .iter()
        .filter(|item| item.kind != ImportKind::DataSource)
        .map(|item| {
            let link = NotionPageLink {
                document_id: imported
                    .get(&item.notion_id)
                    .copied()
                    .unwrap_or_else(|| document_id(item.import_id)),
                name: item.title.clone(),
            };
            (item.notion_id.clone(), link)
        })
        .collect();
    let users = people
        .iter()
        .filter_map(|(id, person)| {
            let link = NotionUserLink {
                user_id: person.macro_user.clone()?,
                email: person.email.clone()?,
            };
            Some((id.clone(), link))
        })
        .collect();
    NotionLinks {
        pages,
        users,
        databases: Vec::new(),
    }
}

/// The document plan row `import_id` becomes, the same on every attempt.
pub(in crate::domain::service) fn document_id(import_id: Uuid) -> Uuid {
    derived_id(import_id, "document")
}

/// What earlier attempts created for one ledger row, and the record of what
/// this one creates.
pub(super) struct Progress<'a, Store> {
    store: &'a Store,
    user: &'a MacroUserIdStr<'static>,
    import_id: Uuid,
    known: Mutex<HashMap<(WrittenKind, String), Uuid>>,
    warnings: Mutex<Vec<crate::domain::models::FidelityWarning>>,
    losses: Mutex<HashMap<NotionId, HashSet<crate::domain::models::SourceLossFact>>>,
}

impl<'a, Store: WrittenObjects> Progress<'a, Store> {
    /// Progress for ledger row `import_id`, from everything recorded so far.
    pub fn new(
        store: &'a Store,
        user: &'a MacroUserIdStr<'static>,
        import_id: Uuid,
        written: &[WrittenObject],
    ) -> Self {
        let known = written
            .iter()
            .filter(|object| object.import_id == import_id)
            .map(|object| ((object.kind, object.object.clone()), object.macro_id))
            .collect();
        Self {
            store,
            user,
            import_id,
            known: Mutex::new(known),
            warnings: Mutex::new(Vec::new()),
            losses: Mutex::new(HashMap::new()),
        }
    }

    /// Refuse unknown prerequisites before changing an interrupted source.
    pub fn ensure_supported(&self) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.all(WrittenKind::Unsupported).is_empty(),
            crate::domain::models::SourceStopReason::UnsupportedMarker
        );
        Ok(())
    }

    /// The row's own object of `kind`, when an earlier attempt made it.
    pub fn get(&self, kind: WrittenKind) -> Option<Uuid> {
        self.get_for(kind, "")
    }

    /// The object of `kind` for Notion `object`, when an earlier attempt
    /// made it.
    pub fn get_for(&self, kind: WrittenKind, object: &str) -> Option<Uuid> {
        self.known
            .lock()
            .ok()?
            .get(&(kind, object.to_string()))
            .copied()
    }

    /// Every object of `kind` made so far, by Notion object.
    pub fn all(&self, kind: WrittenKind) -> HashMap<String, Uuid> {
        self.known
            .lock()
            .map(|known| {
                known
                    .iter()
                    .filter(|((known_kind, _), _)| *known_kind == kind)
                    .map(|((_, object), id)| (object.clone(), *id))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// A successful reservation releases its bounded retry and outage state.
    pub async fn clear_reservation_failures(&self) -> anyhow::Result<()> {
        if self.all(WrittenKind::DatabaseReservationFailure).is_empty() {
            return Ok(());
        }
        self.store
            .clear_database_reservation_failures(self.user, self.import_id)
            .await?;
        self.known
            .lock()
            .map_err(|_| anyhow::anyhow!("written marker buffer unavailable"))?
            .retain(|(kind, _), _| *kind != WrittenKind::DatabaseReservationFailure);
        Ok(())
    }

    /// Spend one source-scoped attempt; run-wide failures never call this.
    pub async fn reservation_failure(&self) -> anyhow::Result<usize> {
        let count = self.reservation_failures()?;
        if count >= RESERVATION_ATTEMPTS {
            return Ok(RESERVATION_ATTEMPTS);
        }
        let attempt = Uuid::now_v7();
        self.record_all(vec![WrittenObject {
            import_id: self.import_id,
            kind: WrittenKind::DatabaseReservationFailure,
            object: attempt.to_string(),
            macro_id: attempt,
        }])
        .await?;
        Ok(count + 1)
    }

    /// Resolve this source's omitted assignees once, without revisiting user edits.
    fn omitted_assignee_tasks(&self) -> anyhow::Result<HashSet<Uuid>> {
        let mut tasks = HashSet::new();
        for (payload, id) in self.all(WrittenKind::TaskNotice) {
            let notice: crate::domain::models::TaskImportNotice = serde_json::from_str(&payload)?;
            anyhow::ensure!(
                notice.task_id == id,
                "Task notice identity does not match its marker"
            );
            match notice.reason {
                crate::domain::models::TaskImportNoticeReason::PersonalAssigneeOmitted => {
                    tasks.insert(id);
                }
            }
        }
        Ok(tasks)
    }

    /// Record a typed task notice before its written marker makes retries skip it.
    pub async fn record_task_notice(
        &self,
        task: Uuid,
        reason: crate::domain::ports::TaskImportNoticeReason,
    ) -> anyhow::Result<()> {
        self.store
            .record_task_notice(self.user, self.import_id, task, reason)
            .await?;
        Ok(())
    }

    /// Clear historical owner-only omission notices when the source is re-reviewed Shared.
    pub async fn clear_task_notices(&self) -> anyhow::Result<()> {
        self.store
            .clear_task_notices(self.user, self.import_id)
            .await?;
        Ok(())
    }

    /// Buffer phase warnings; only the phase boundary rewrites warning metadata.
    pub async fn warn(&self, warnings: &[String]) -> anyhow::Result<()> {
        self.warn_fidelity(&warnings.iter().cloned().map(Into::into).collect::<Vec<_>>())
            .await
    }

    /// Forward another source's already counted warnings after its access check.
    pub async fn warn_fidelity(
        &self,
        warnings: &[crate::domain::models::FidelityWarning],
    ) -> anyhow::Result<()> {
        self.warnings
            .lock()
            .map_err(|_| anyhow::anyhow!("warning buffer unavailable"))?
            .extend_from_slice(warnings);
        Ok(())
    }

    /// Report a typed source-only stop before recording its failure.
    pub async fn source_stopped(
        &self,
        title: &str,
        reason: crate::domain::models::SourceStopReason,
    ) -> anyhow::Result<()> {
        self.warn_fidelity(&[crate::domain::models::FidelityWarning::SourceStopped {
            title: title.to_owned(),
            reason,
        }])
        .await
    }

    /// Keep a typed loss until the same batch records its completed object.
    pub fn loss(&self, mut fact: crate::domain::models::SourceLossFact) -> anyhow::Result<()> {
        fact.bound_display_text();
        self.losses
            .lock()
            .map_err(|_| anyhow::anyhow!("loss buffer unavailable"))?
            .entry(fact.object.clone())
            .or_default()
            .insert(fact);
        Ok(())
    }

    /// Persist one cumulative snapshot per phase, rebuilding facts after a restart.
    pub async fn flush_warnings(&self) -> anyhow::Result<()> {
        use crate::domain::models::{FidelityWarning, SourceLossFact};
        let mut facts: Vec<SourceLossFact> = self
            .all(WrittenKind::Loss)
            .into_keys()
            .map(|payload| serde_json::from_str(&payload))
            .collect::<std::result::Result<_, _>>()?;
        facts.extend(
            self.losses
                .lock()
                .map_err(|_| anyhow::anyhow!("loss buffer unavailable"))?
                .values()
                .flatten()
                .cloned(),
        );
        let mut warnings = self
            .warnings
            .lock()
            .map_err(|_| anyhow::anyhow!("warning buffer unavailable"))?
            .clone();
        warnings.extend(SourceLossFact::warnings(facts));
        let warnings = FidelityWarning::merge(warnings);
        if !warnings.is_empty() {
            self.store
                .record_warnings(self.user, self.import_id, &warnings)
                .await?;
        }
        Ok(())
    }

    /// Add small loss facts to an existing marker batch, never a per-row warning update.
    pub fn loss_markers(&self, object: &NotionId) -> anyhow::Result<Vec<WrittenObject>> {
        self.losses
            .lock()
            .map_err(|_| anyhow::anyhow!("loss buffer unavailable"))?
            .get(object)
            .into_iter()
            .flatten()
            .map(|fact| {
                Ok(WrittenObject {
                    import_id: self.import_id,
                    kind: WrittenKind::Loss,
                    object: serde_json::to_string(fact)?,
                    macro_id: self.import_id,
                })
            })
            .collect()
    }

    /// Record the row's own object of `kind`.
    pub async fn record(&self, kind: WrittenKind, macro_id: Uuid) -> anyhow::Result<()> {
        self.record_all(vec![WrittenObject::own(self.import_id, kind, macro_id)])
            .await
    }

    /// Record the object of `kind` for Notion row `row`.
    pub async fn record_for(
        &self,
        kind: WrittenKind,
        row: &NotionId,
        macro_id: Uuid,
    ) -> anyhow::Result<()> {
        let mut objects = self.loss_markers(row)?;
        objects.push(WrittenObject::for_row(self.import_id, kind, row, macro_id));
        self.record_all(objects).await
    }

    /// Record `objects`, which must belong to this row.
    pub async fn record_all(&self, objects: Vec<WrittenObject>) -> anyhow::Result<()> {
        let recorded = self.store.record_written(self.user, &objects).await?;
        if let Ok(mut known) = self.known.lock() {
            known.extend(
                recorded
                    .into_iter()
                    .map(|object| ((object.kind, object.object), object.macro_id)),
            );
        }
        Ok(())
    }
}

/// A folder made once for the row: reused when an earlier attempt made it,
/// otherwise created and recorded.
pub(super) async fn folder_once<Writer: WorkspaceWriter, Store: WrittenObjects>(
    writer: &Writer,
    user: &MacroUserIdStr<'static>,
    progress: &Progress<'_, Store>,
    kind: WrittenKind,
    name: &str,
    parent: Option<Uuid>,
    visibility: crate::domain::ports::ImportVisibility,
) -> anyhow::Result<Uuid> {
    if let Some(folder) = progress.get(kind) {
        return Ok(folder);
    }
    let folder = writer.create_folder(user, name, parent, visibility).await?;
    progress.record(kind, folder).await?;
    Ok(folder)
}

/// Write a task list: a folder of Macro tasks, one per row, shared with the
/// team with `share`. Returns the folder id. Rows an earlier attempt already
/// wrote keep their contents; Shared retries reapply their assignees.
#[expect(
    clippy::too_many_arguments,
    reason = "a task list needs its source, destination, people, links and progress"
)]
pub(super) async fn write_tasks<Api: NotionApi, Writer: WorkspaceWriter, Store: WrittenObjects>(
    api: &Api,
    writer: &Writer,
    user: &MacroUserIdStr<'static>,
    item: &WriteItem,
    folder: Uuid,
    share: bool,
    people: &PeopleMap,
    links: &tokio::sync::RwLock<NotionLinks>,
    destinations: &super::databases::DatabaseDestinations,
    progress: &Progress<'_, Store>,
    cancel: &Cancel,
    personal_folder: Option<Uuid>,
) -> anyhow::Result<Uuid> {
    let visibility = ImportVisibility::from_shared(item.shared);
    let rows = all_rows(api, &item.notion_id).await?.rows;
    let tasks_folder = match personal_folder {
        Some(folder) => folder,
        None => {
            folder_once(
                writer,
                user,
                progress,
                WrittenKind::TasksFolder,
                &capped_name(&item.title),
                Some(folder),
                visibility,
            )
            .await?
        }
    };
    // Shared before the tasks are made, so each is shared as it lands in
    // the folder; shared again on resume, which is harmless.
    if share {
        writer
            .share_with_team(user, SharedEntity::Folder(tasks_folder))
            .await?;
    }
    if share {
        for task in progress.all(WrittenKind::Task).values() {
            cancel.ensure_running()?;
            writer
                .share_with_team(user, SharedEntity::Document(*task))
                .await?;
        }
    }
    let failures = Mutex::new(0usize);
    let replay_failed = std::sync::atomic::AtomicBool::new(false);
    let omitted_assignees = progress.omitted_assignee_tasks()?;
    stream::iter(rows.iter().cloned())
        .map(|row| {
            let failures = &failures;
            let replay_failed = &replay_failed;
            let omitted_assignees = &omitted_assignees;
            async move {
                if cancel.stopped() {
                    return;
                }
                let outcome: anyhow::Result<()> = async {
                    if let Some(task) = progress.get_for(WrittenKind::Task, row.id.as_str()) {
                        if item.shared
                            && omitted_assignees.contains(&task)
                            && let Some(email) =
                                task_properties(&row, &item.task_fields, people).assignee_email
                        {
                            let notice = writer
                                .reapply_task_assignee(user, task, &email, visibility)
                                .await
                                .inspect_err(|_| {
                                    replay_failed.store(true, std::sync::atomic::Ordering::Relaxed);
                                })?;
                            if let Some(notice) = notice {
                                progress.record_task_notice(task, notice).await?;
                            }
                        }
                        return Ok(());
                    }
                    let (content, database_links) =
                        super::databases::body_links(api, &row.id, destinations, progress).await?;
                    let body = task_body(&row, &content, &item.task_fields, people);
                    let properties = task_properties(&row, &item.task_fields, people);
                    let title = if row.title.trim().is_empty() {
                        super::plan::UNTITLED_PAGE
                    } else {
                        row.title.trim()
                    };
                    let id = derived_id(item.import_id, &format!("task/{}", row.id.as_str()));
                    let mut row_links = links.read().await.clone();
                    row_links.databases = database_links;
                    let created = writer
                        .create_task(
                            user,
                            id,
                            title,
                            &body,
                            &row_links,
                            &properties,
                            Some(tasks_folder),
                            Some(SourceDates::from(&row)),
                            visibility,
                        )
                        .await?;
                    if let Some(notice) = created.notice {
                        progress.record_task_notice(id, notice).await?;
                    }
                    progress.record_for(WrittenKind::Task, &row.id, id).await?;
                    Ok(())
                }
                .await;
                if let Err(error) = outcome {
                    tracing::warn!(error = ?error, "notion task row was not imported");
                    if let Ok(mut failed) = failures.lock() {
                        *failed += 1;
                    }
                }
            }
            .boxed()
        })
        .buffer_unordered(BODY_CONCURRENCY)
        .collect::<Vec<()>>()
        .await;
    cancel.ensure_running()?;
    anyhow::ensure!(
        !replay_failed.load(std::sync::atomic::Ordering::Relaxed),
        "Some task assignees could not be reapplied. Retry the import."
    );
    let failed = failures.into_inner().unwrap_or_default();
    anyhow::ensure!(
        failed < rows.len() || rows.is_empty(),
        "none of the {} task rows could be imported",
        rows.len()
    );
    Ok(tasks_folder)
}
