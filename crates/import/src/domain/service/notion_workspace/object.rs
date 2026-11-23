//! Writing one object of a plan: claiming it for the team, linking it to a
//! teammate's copy, or writing it and sharing what it became.

use std::collections::HashMap;

use connectors::McpConnectionsService;
use futures::FutureExt;
use import_notion::domain::macro_cells::PeopleMap;
use import_notion::domain::model::NotionId;
use import_notion::domain::ports::{NotionApi, NotionConnections};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::super::ImportServiceImpl;
use super::run::JobControl;
use super::{Place, databases, failure_text, plan, reserve::Reservations, values, write};
use crate::domain::models::{
    ImportEntity, ImportKind, ImportStatus, NotionAlreadyImported, NotionDecision, TeamClaim,
    WrittenObject,
};
use crate::domain::ports::{
    CanonicalImportRepo, EntityCreator, ImportError, ImportRepo, ImportVisibility, NotionLinks,
    NotionPlanRepo, NotionRunRepo, Result, SharedEntity, SlackWorkspaceSource, SourceDates,
    WorkspaceWriter, WrittenObjects,
};

/// Times a waiting object is checked again before it is given up on: each
/// check finds the teammate's copy finished, taken over, or still writing.
const WAIT_CHECKS: u8 = 3;
/// A linked source no longer carries the mapping needed to choose its shape.
const REPLAN_DATA_SOURCE: &str =
    "A linked data source was deleted. Plan this import again to choose how to copy it.";
/// What an object says when its team copy kept changing hands.
const KEPT_MOVING: &str =
    "A teammate's import of this kept stopping and starting. Import it again.";

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: McpConnectionsService,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    /// An object a teammate was writing when the write reached it, checked
    /// again once the rest is written: linked to their copy when it is done,
    /// written when they stopped, otherwise left waiting on their row, which
    /// links it once written.
    pub(super) async fn settle_waiting(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &write::WriteItem,
        target: &Target<'_, databases::CachedNotion<N::Api>>,
        control: &JobControl,
    ) -> Outcome {
        for _ in 0..WAIT_CHECKS {
            let holder = match self.write_or_fail(user, item, target, control).await {
                Outcome::Waiting(holder) => holder,
                done => return done,
            };
            match self.repo.wait_on(user, item.import_id, holder).await {
                Ok(true) => return Outcome::Done,
                // The teammate finished or stopped meanwhile: check again.
                Ok(false) => {}
                Err(error) => {
                    tracing::warn!(error = ?error, "could not wait on a teammate's notion import");
                    break;
                }
            }
        }
        let _ = self
            .repo
            .mark_import_failed(user, item.import_id, KEPT_MOVING)
            .await;
        Outcome::Failed
    }

    /// Write one object, recording a failure on its row.
    pub(super) async fn write_or_fail(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &write::WriteItem,
        target: &Target<'_, databases::CachedNotion<N::Api>>,
        control: &JobControl,
    ) -> Outcome {
        let progress = write::Progress::new(&self.repo, user, item.import_id, target.written);
        let result = async {
            let result = self.write_item(user, item, target, &progress).boxed().await;
            progress.flush_warnings().await?;
            let outcome = result?;
            if let Written::Done {
                entity_id,
                entity_type,
            } = &outcome
            {
                self.repo
                    .mark_imported(user, item.import_id, entity_id, entity_type, None)
                    .await?;
            }
            Result::Ok(outcome)
        }
        .await;
        match result {
            Ok(Written::Done { .. }) => Outcome::Done,
            Ok(Written::Waiting(holder)) => Outcome::Waiting(holder),
            // Stopped part way for the next process: the row stays
            // `importing` for it to finish.
            Err(_) if control.handed_over() => Outcome::Done,
            Err(error) => {
                tracing::warn!(error = ?error, kind = item.kind.as_ref(), "notion object was not imported");
                let _ = self
                    .repo
                    .mark_import_failed(user, item.import_id, &failure_text(&error))
                    .await;
                Outcome::Failed
            }
        }
    }

    /// Write one object, or link it to the team's copy. A shared object is
    /// written only by the row holding the team's claim.
    async fn write_item(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &write::WriteItem,
        target: &Target<'_, databases::CachedNotion<N::Api>>,
        progress: &write::Progress<'_, R>,
    ) -> Result<Written> {
        if let Err(error) = progress.ensure_supported() {
            progress
                .source_stopped(
                    &item.title,
                    crate::domain::models::SourceStopReason::UnsupportedMarker,
                )
                .await?;
            return Err(error.into());
        }
        let claim = match target.team_id {
            Some(team_id) if item.shared || item.already_imported => {
                super::super::lifecycle::claim_team_object(
                    &self.repo,
                    self.creator.as_ref(),
                    user,
                    item.import_id,
                    team_id,
                    item.shared,
                )
                .await?
            }
            _ => TeamClaim::Free,
        };
        let destination = match &claim {
            TeamClaim::Linked {
                entity_id,
                entity_type,
            } if matches!(entity_type.as_str(), "md" | "task") => Uuid::parse_str(entity_id).ok(),
            TeamClaim::Waiting { holder } if item.kind != ImportKind::DataSource => {
                Some(write::document_id(*holder))
            }
            TeamClaim::Held | TeamClaim::Free if item.kind != ImportKind::DataSource => {
                Some(write::document_id(item.import_id))
            }
            _ => None,
        };
        if let Some(document) = destination
            && let Some(page) = target.links.write().await.pages.get_mut(&item.notion_id)
        {
            page.document_id = document;
        }
        let share = match claim {
            TeamClaim::Linked {
                entity_id,
                entity_type,
            } => {
                if item.kind == ImportKind::DataSource
                    && entity_type == write::DATABASE_ENTITY
                    && !self
                        .creator
                        .database_access(
                            user,
                            entity_id
                                .parse()
                                .map_err(|error| ImportError::Other(anyhow::Error::new(error)))?,
                        )
                        .await?
                {
                    return Err(ImportError::Other(anyhow::anyhow!(
                        "database view access is unavailable"
                    )));
                }
                if item.shared && item.kind == ImportKind::DataSource {
                    progress.clear_task_notices().await?;
                }
                return Ok(Written::Done {
                    entity_id,
                    entity_type,
                });
            }
            TeamClaim::Waiting { holder } => return Ok(Written::Waiting(holder)),
            TeamClaim::Held => true,
            TeamClaim::Free => false,
        };
        if item.already_imported && item.kind == ImportKind::DataSource {
            self.repo
                .require_replan(user, item.import_id, REPLAN_DATA_SOURCE)
                .await?;
            return Err(ImportError::NotReady(REPLAN_DATA_SOURCE));
        }
        if item.already_imported && !self.repo.clear_stale_link(user, item.import_id).await? {
            return Err(ImportError::NotReady(
                "The import stopped before its replacement was written.",
            ));
        }
        let (api, cancel) = (target.api, target.cancel);
        let proposed = target
            .place
            .folder_for(item, item.kind != ImportKind::DataSource);
        let path = target.place.path_for(proposed)?;
        let folder = if item.shared {
            proposed
        } else {
            self.personal_item_folder(user, item.import_id, proposed, path)
                .await?
        };
        let personal_child_folder = if !item.shared && item.kind == ImportKind::DataSource {
            let (kind, name) = match item.decision {
                NotionDecision::Tasks => (
                    crate::domain::models::WrittenKind::TasksFolder,
                    import_notion::domain::macro_cells::capped_name(&item.title),
                ),
                _ => (
                    crate::domain::models::WrittenKind::BodiesFolder,
                    import_notion::domain::macro_cells::capped_name(&format!(
                        "{} pages",
                        item.title
                    )),
                ),
            };
            match progress.get(kind) {
                Some(previous) => {
                    let mut path = path.to_vec();
                    path.push(name);
                    let resolved = self
                        .personal_item_folder(user, item.import_id, previous, &path)
                        .await?;
                    (resolved != previous).then_some(resolved)
                }
                None => None,
            }
        } else {
            None
        };

        let (entity_id, entity_type) = match (item.kind, item.decision) {
            (ImportKind::DataSource, NotionDecision::Tasks) => {
                let tasks = write::write_tasks(
                    api,
                    self.creator.as_ref(),
                    user,
                    item,
                    folder,
                    share,
                    target.people,
                    target.links,
                    &target.reservations.destinations,
                    progress,
                    cancel,
                    personal_child_folder,
                )
                .await?;
                (tasks.to_string(), write::FOLDER_ENTITY)
            }
            (ImportKind::DataSource, _) => {
                let prepared = target
                    .reservations
                    .prepared
                    .get(&item.notion_id)
                    .ok_or_else(|| {
                        ImportError::Other(anyhow::anyhow!(
                            "database reservation failed: {}",
                            target
                                .reservations
                                .failures
                                .get(&item.notion_id)
                                .map(String::as_str)
                                .unwrap_or("source is not ready")
                        ))
                    })?;
                let written = write::write_prepared_database(
                    api,
                    self.creator.as_ref(),
                    user,
                    item,
                    share,
                    target.people,
                    target.links,
                    progress,
                    cancel,
                    prepared,
                    &target.reservations.destinations,
                    personal_child_folder,
                )
                .await?;
                let id = written.database_id.to_string();
                target
                    .databases
                    .lock()
                    .await
                    .insert(item.notion_id.clone(), written);
                (id, write::DATABASE_ENTITY)
            }
            _ => {
                let (markdown, database_links) = databases::body_links(
                    api,
                    &item.notion_id,
                    &item.title,
                    &target.reservations.destinations,
                    progress,
                )
                .await?;
                // A teammate's copy can disappear after the link snapshot.
                // Once this row writes, its identity belongs to this generation.
                let id = write::document_id(item.import_id);
                let (properties, dates) = match api.page(&item.notion_id).await {
                    Ok(page) => (
                        values::document_properties(&page),
                        Some(SourceDates::from(&page)),
                    ),
                    Err(error) => {
                        tracing::warn!(error = ?error, "notion page properties were not read");
                        (Default::default(), None)
                    }
                };
                let mut links = target.links.read().await.clone();
                links.databases = database_links;
                let document = self
                    .creator
                    .create_document(
                        user,
                        id,
                        &item.title,
                        &markdown,
                        &links,
                        &properties,
                        Some(folder),
                        dates,
                        ImportVisibility::from_shared(item.shared),
                    )
                    .await?;
                if share {
                    self.creator
                        .share_with_team(user, SharedEntity::Document(id))
                        .await?;
                }
                progress
                    .record_for(
                        crate::domain::models::WrittenKind::Document,
                        &item.notion_id,
                        id,
                    )
                    .await?;
                (document, write::DOCUMENT_ENTITY)
            }
        };
        if item.shared && item.kind == ImportKind::DataSource {
            progress.clear_task_notices().await?;
        }
        Ok(Written::Done {
            entity_id,
            entity_type: entity_type.to_owned(),
        })
    }

    /// Where the plan's pages and people resolve in Macro, known before
    /// anything is written: the user's own document when it exists, the
    /// team's copy of a shared page (written, or being written by a
    /// teammate), otherwise the document the page becomes.
    pub(super) async fn links(
        &self,
        user: &MacroUserIdStr<'static>,
        items: &[write::WriteItem],
        people: &PeopleMap,
    ) -> Result<(NotionLinks, usize)> {
        let pages: Vec<&write::WriteItem> = items
            .iter()
            .filter(|item| item.kind != ImportKind::DataSource)
            .collect();
        let foreign_ids: Vec<String> = pages
            .iter()
            .filter(|item| item.shared || item.already_imported)
            .map(|item| item.notion_id.as_str().to_string())
            .collect();
        let copies: HashMap<String, ImportEntity> = super::super::lifecycle::team_copies(
            &self.repo,
            self.creator.as_ref(),
            user,
            &foreign_ids,
        )
        .await?
        .into_iter()
        .map(|copy| (copy.foreign_id.clone(), copy))
        .collect();
        let mut imported = HashMap::new();
        let mut unavailable = std::collections::HashSet::new();
        for item in pages {
            let own = self
                .repo
                .get(user, item.import_id)
                .await?
                .filter(|row| row.status == ImportStatus::Imported);
            if let Some(row) = &own
                && !super::super::lifecycle::live_for_write(
                    &self.repo,
                    self.creator.as_ref(),
                    user,
                    row,
                )
                .await?
            {
                unavailable.insert(item.notion_id.clone());
                continue;
            }
            let document = match (own, copies.get(item.notion_id.as_str())) {
                (Some(row), _) => imported_document(&row),
                (None, Some(copy)) if copy.status == ImportStatus::Importing => {
                    Some(write::document_id(copy.id))
                }
                (None, Some(copy)) => imported_document(copy),
                (None, None) => None,
            };
            if let Some(document) = document {
                imported.insert(item.notion_id.clone(), document);
            }
        }
        let mut links = write::notion_links(items, &imported, people);
        links.pages.retain(|id, _| !unavailable.contains(id));
        Ok((links, unavailable.len()))
    }

    /// Teammates' copies shared with the team of the planned objects, by
    /// Notion id. Only finished copies count.
    pub(super) async fn already_in_macro(
        &self,
        user: &MacroUserIdStr<'static>,
        tree: &plan::PlanTree,
    ) -> Result<HashMap<String, NotionAlreadyImported>> {
        let foreign_ids: Vec<String> = tree
            .nodes
            .iter()
            .map(|node| node.id.as_str().to_string())
            .collect();
        let copies = super::super::lifecycle::team_copies(
            &self.repo,
            self.creator.as_ref(),
            user,
            &foreign_ids,
        )
        .await?;
        Ok(copies
            .into_iter()
            .filter(|copy| copy.status == ImportStatus::Imported)
            .filter_map(|copy| {
                let by = MacroUserIdStr::parse_from_str(&copy.user_id)
                    .ok()?
                    .email_str()
                    .to_string();
                Some((
                    copy.foreign_id,
                    NotionAlreadyImported {
                        by,
                        entity_id: copy.entity_id?,
                        entity_type: copy.entity_type?,
                    },
                ))
            })
            .collect())
    }
}

/// The document an imported row became, when it became one.
fn imported_document(row: &ImportEntity) -> Option<Uuid> {
    if row.entity_type.as_deref() != Some(write::DOCUMENT_ENTITY) {
        return None;
    }
    row.entity_id.as_deref()?.parse().ok()
}

/// How writing one object ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Outcome {
    /// Written, linked, or left for the next process.
    Done,
    /// It failed; the row records why.
    Failed,
    /// A teammate is writing it for the team: the holder's row.
    Waiting(Uuid),
}

/// What one object's write did.
enum Written {
    /// It was written, or linked to the team's copy.
    Done {
        entity_id: String,
        entity_type: String,
    },
    /// A teammate is writing it for the team; nothing was written.
    Waiting(Uuid),
}

/// Everything one object's write needs from the write around it.
pub(super) struct Target<'a, Api> {
    pub api: &'a Api,
    pub team_id: Option<Uuid>,
    pub place: Place<'a>,
    pub people: &'a PeopleMap,
    pub links: &'a tokio::sync::RwLock<NotionLinks>,
    pub reservations: &'a Reservations,
    pub databases: &'a tokio::sync::Mutex<HashMap<NotionId, write::WrittenDatabase>>,
    pub written: &'a [WrittenObject],
    pub cancel: &'a write::Cancel,
}
