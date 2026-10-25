//! Writing one object of a plan: claiming it for the team, linking it to a
//! teammate's copy, or writing it and sharing what it became.

use std::collections::HashMap;

use import_notion::domain::inventory::full_markdown;
use import_notion::domain::model::NotionId;
use import_notion::domain::ports::{NotionApi, NotionConnections};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::ConnectorSelect;
use uuid::Uuid;

use super::super::ImportServiceImpl;
use super::run::JobControl;
use super::{Place, failure_text, plan, values, write};
use crate::domain::models::{
    ImportEntity, ImportKind, ImportStatus, NotionAlreadyImported, NotionDecision, TeamClaim,
    WrittenObject,
};
use crate::domain::ports::{
    CanonicalImportRepo, EntityCreator, ImportError, ImportRepo, NotionLinks, NotionPlanRepo,
    NotionRunRepo, Result, SharedEntity, SlackWorkspaceSource, WorkspaceWriter, WrittenObjects,
};

/// Times a waiting object is checked again before it is given up on: each
/// check finds the teammate's copy finished, taken over, or still writing.
const WAIT_CHECKS: u8 = 3;
/// What an object says when its team copy kept changing hands.
const KEPT_MOVING: &str =
    "A teammate's import of this kept stopping and starting. Import it again.";

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: ConnectorSelect,
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
        target: &Target<'_, N::Api>,
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
        target: &Target<'_, N::Api>,
        control: &JobControl,
    ) -> Outcome {
        let progress = write::Progress::new(&self.repo, user, item.import_id, target.written);
        match self.write_item(user, item, target, &progress).await {
            Ok(Written::Done) => Outcome::Done,
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
        target: &Target<'_, N::Api>,
        progress: &write::Progress<'_, R>,
    ) -> Result<Written> {
        let claim = match target.team_id {
            Some(team_id) if item.shared || item.already_imported => {
                self.repo
                    .claim_team_object(user, item.import_id, team_id, item.shared)
                    .await?
            }
            _ => TeamClaim::Free,
        };
        let share = match claim {
            TeamClaim::Linked {
                entity_id,
                entity_type,
            } => {
                self.repo
                    .mark_imported(user, item.import_id, &entity_id, &entity_type, None)
                    .await?;
                return Ok(Written::Done);
            }
            TeamClaim::Waiting { holder } => return Ok(Written::Waiting(holder)),
            TeamClaim::Held => true,
            TeamClaim::Free => false,
        };
        let (api, cancel) = (target.api, target.cancel);
        let (entity_id, entity_type) = match (item.kind, item.decision) {
            (ImportKind::DataSource, NotionDecision::Tasks) => {
                let folder = target.place.folder_for(item, false);
                let tasks = write::write_tasks(
                    api,
                    self.creator.as_ref(),
                    user,
                    item,
                    folder,
                    share,
                    target.people,
                    target.links,
                    progress,
                    cancel,
                )
                .await?;
                (tasks.to_string(), write::FOLDER_ENTITY)
            }
            (ImportKind::DataSource, _) => {
                let folder = target.place.folder_for(item, false);
                let written = write::write_database(
                    api,
                    self.creator.as_ref(),
                    user,
                    item,
                    folder,
                    share,
                    target.people,
                    target.links,
                    progress,
                    cancel,
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
                let folder = target.place.folder_for(item, true);
                let markdown = full_markdown(api, &item.notion_id).await?;
                let id = target
                    .links
                    .pages
                    .get(&item.notion_id)
                    .map(|page| page.document_id)
                    .ok_or_else(|| {
                        ImportError::Other(anyhow::anyhow!("page {} has no id", item.notion_id))
                    })?;
                let properties = match api.page(&item.notion_id).await {
                    Ok(page) => values::document_properties(&page),
                    Err(error) => {
                        tracing::warn!(error = ?error, "notion page properties were not read");
                        Default::default()
                    }
                };
                let document = self
                    .creator
                    .create_document(
                        user,
                        id,
                        &item.title,
                        &markdown,
                        target.links,
                        &properties,
                        Some(folder),
                    )
                    .await?;
                if share {
                    self.creator
                        .share_with_team(user, SharedEntity::Document(id))
                        .await?;
                }
                (document, write::DOCUMENT_ENTITY)
            }
        };
        // The row's team claim, taken before writing, stays on it.
        self.repo
            .mark_imported(user, item.import_id, &entity_id, entity_type, None)
            .await?;
        Ok(Written::Done)
    }

    /// Where the plan's pages and people resolve in Macro, known before
    /// anything is written: the user's own document when it exists, the
    /// team's copy of a shared page (written, or being written by a
    /// teammate), otherwise the document the page becomes.
    pub(super) async fn links(
        &self,
        user: &MacroUserIdStr<'static>,
        items: &[write::WriteItem],
        people: &values::PeopleMap,
    ) -> Result<NotionLinks> {
        let pages: Vec<&write::WriteItem> = items
            .iter()
            .filter(|item| item.kind != ImportKind::DataSource)
            .collect();
        let foreign_ids: Vec<String> = pages
            .iter()
            .filter(|item| item.shared || item.already_imported)
            .map(|item| item.notion_id.as_str().to_string())
            .collect();
        let copies: HashMap<String, ImportEntity> = self
            .repo
            .team_copies(user, &foreign_ids)
            .await?
            .into_iter()
            .map(|copy| (copy.foreign_id.clone(), copy))
            .collect();
        let mut imported = HashMap::new();
        for item in pages {
            let own = self
                .repo
                .get(user, item.import_id)
                .await?
                .filter(|row| row.status == ImportStatus::Imported);
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
        Ok(write::notion_links(items, &imported, people))
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
        let copies = self.repo.team_copies(user, &foreign_ids).await?;
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
    Done,
    /// A teammate is writing it for the team; nothing was written.
    Waiting(Uuid),
}

/// Everything one object's write needs from the write around it.
pub(super) struct Target<'a, Api> {
    pub api: &'a Api,
    pub team_id: Option<Uuid>,
    pub place: Place<'a>,
    pub people: &'a values::PeopleMap,
    pub links: &'a NotionLinks,
    pub databases: &'a tokio::sync::Mutex<HashMap<NotionId, write::WrittenDatabase>>,
    pub written: &'a [WrittenObject],
    pub cancel: &'a write::Cancel,
}
