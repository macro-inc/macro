//! Resolve only confirmed imports after the write phase, and patch their initial hyperlink revisions.

use std::collections::{HashMap, HashSet};

use super::*;
use crate::domain::models::WrittenKind;
use crate::domain::ports::{ImportedTarget, NotionLinkDestination, NotionLinkReference};

const BODY_LINK_LIMIT: usize = 256;
const RESOLUTION_CACHE_LIMIT: usize = 4096;
type CachedResolution = std::sync::Arc<tokio::sync::OnceCell<Option<NotionLinkDestination>>>;

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: McpConnectionsService,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    #[tracing::instrument(
        name = "notion.rewrite_links",
        skip_all,
        fields(
            review_id = %set.review_id,
            bodies = tracing::field::Empty,
            retained = tracing::field::Empty,
            rewritten = tracing::field::Empty,
        ),
        err
    )]
    pub(super) async fn rewrite_notion_links(
        &self,
        api: &impl NotionApi,
        user: &MacroUserIdStr<'static>,
        team: Option<Uuid>,
        set: &WriteSet,
        cancel: &write::Cancel,
    ) -> Result<()> {
        let planned: HashMap<_, _> = set.all.iter().map(|item| (item.import_id, item)).collect();
        let skipped: HashSet<_> = set
            .all
            .iter()
            .filter(|item| !item.writes() && !item.already_imported)
            .map(|item| item.notion_id.clone())
            .collect();
        let written = self
            .repo
            .written(user, &planned.keys().copied().collect::<Vec<_>>())
            .await?;
        let documents: HashSet<_> = written
            .iter()
            .filter(|marker| matches!(marker.kind, WrittenKind::Document | WrittenKind::Body))
            .map(|marker| (marker.import_id, marker.macro_id))
            .collect();
        let generation = set.review_id.to_string();
        let bodies: Vec<_> = written
            .iter()
            .filter_map(|marker| {
                if marker.kind != WrittenKind::LinkBodyRevision {
                    return None;
                }
                let (review, document) = marker.object.split_once('/')?;
                let document = document.parse::<Uuid>().ok()?;
                (review == generation && documents.contains(&(marker.import_id, document)))
                    .then_some((marker.import_id, document, marker.macro_id))
            })
            .collect();
        tracing::Span::current().record("bodies", bodies.len());
        let cache = tokio::sync::Mutex::new(HashMap::<_, CachedResolution>::new());
        let (rewritten, retained) = stream::iter(bodies)
            .map(|(import_id, document, receipt)| {
                let item = planned[&import_id];
                let skipped = &skipped;
                let cache = &cache;
                async move {
                    if cancel.stopped() || !item.writes() {
                        return (0, 0);
                    }
                    let result: anyhow::Result<(usize, usize)> = async {
                        let Some(row) = self.repo.get(user, item.import_id).await? else {
                            return Ok((0, 0));
                        };
                        let audience = if item.shared { team } else { None };
                        if row.review_id != Some(set.review_id)
                            || row.status != ImportStatus::Imported
                            || row.team_id != audience
                        {
                            return Ok((0, 0));
                        }
                        let Some(body) = self.creator.inspect_import_links(user, document, receipt).await? else {
                            return Ok((0, 0));
                        };
                        let mut replacements = Vec::new();
                        let candidates = body.references.len();
                        for source in body.references.iter().take(BODY_LINK_LIMIT) {
                            if cancel.stopped() {
                                return Ok((0, candidates));
                            }
                            let entry = {
                                let mut cache = cache.lock().await;
                                let key = (audience, source.clone());
                                if let Some(entry) = cache.get(&key) {
                                    entry.clone()
                                } else {
                                    let entry = CachedResolution::default();
                                    if cache.len() < RESOLUTION_CACHE_LIMIT {
                                        cache.insert(key, entry.clone());
                                    }
                                    entry
                                }
                            };
                            let resolution = entry
                                .get_or_try_init(|| self.resolve_notion_link(api, user, audience, source, skipped))
                                .await;
                            match resolution {
                                Ok(Some(destination)) => replacements.push((source.clone(), destination.clone())),
                                Ok(None) => {}
                                Err(_) => tracing::warn!(source_id = %source.id, "an imported link destination could not be verified"),
                            }
                        }
                        if replacements.is_empty() || cancel.stopped() {
                            return Ok((0, candidates));
                        }
                        let retained = candidates - replacements.len();
                        let rewritten = self.creator.rewrite_import_links(user, document, body, &replacements).await?;
                        Ok((rewritten, if rewritten == 0 { candidates } else { retained }))
                    }.await;
                    match result {
                        Ok(counts) => counts,
                        Err(_) => {
                            tracing::warn!(%document, "could not finish rewriting imported links");
                            (0, 0)
                        }
                    }
                }
                .boxed()
            })
            .buffer_unordered(write::WRITE_CONCURRENCY)
            .fold((0, 0), |(rewritten, retained), (new_rewrites, old_references)| async move {
                (rewritten + new_rewrites, retained + old_references)
            })
            .await;
        tracing::Span::current().record("rewritten", rewritten);
        tracing::Span::current().record("retained", retained);
        Ok(())
    }

    async fn link_target(
        &self,
        user: &MacroUserIdStr<'static>,
        audience: Option<Uuid>,
        source: &NotionId,
    ) -> Result<Option<ImportEntity>> {
        let own = self
            .repo
            .get_own_by_foreign_id(user, ImportSource::Notion, source.as_str())
            .await?;
        let row = match own {
            Some(row) if row.team_id == audience || row.status != ImportStatus::Imported => {
                Some(row)
            }
            _ if audience.is_some() => {
                self.repo
                    .find_team_imported(user, ImportSource::Notion, source.as_str())
                    .await?
            }
            _ => None,
        };
        // This ledger transition also confirms single-page imports, which
        // predate the workspace-specific WrittenObject markers.
        Ok(row.filter(|row| row.status == ImportStatus::Imported && row.team_id == audience))
    }

    async fn resolve_notion_link(
        &self,
        api: &impl NotionApi,
        user: &MacroUserIdStr<'static>,
        audience: Option<Uuid>,
        reference: &NotionLinkReference,
        skipped: &HashSet<NotionId>,
    ) -> anyhow::Result<Option<NotionLinkDestination>> {
        if skipped.contains(&reference.id) {
            return Ok(None);
        }
        let source = if let Some(view) = &reference.view_id {
            let Ok(tab) = api.retrieve_view(view).await else {
                return Ok(None);
            };
            let Some(source) = tab
                .data_source_id
                .filter(|_| tab.parent.database_id == reference.id && tab.id == *view)
            else {
                return Ok(None);
            };
            source
        } else if let Some(row) = self.link_target(user, audience, &reference.id).await? {
            if row.kind != ImportKind::DataSource {
                let Some(document) = row
                    .entity_id
                    .as_deref()
                    .filter(|_| row.entity_type.as_deref() == Some(write::DOCUMENT_ENTITY))
                    .and_then(|id| id.parse::<Uuid>().ok())
                else {
                    return Ok(None);
                };
                let target = ImportedTarget::Document(document);
                if !self.creator.target_exists(target).await? {
                    return Ok(None);
                }
                let accessible = if audience.is_none() {
                    self.creator.owns_notion_link_target(user, target).await?
                } else {
                    self.creator
                        .can_view(user, ImportSource::Notion, &document.to_string())
                        .await?
                };
                return Ok(accessible.then_some(NotionLinkDestination::Page(document)));
            }
            reference.id.clone()
        } else {
            let Ok(sources) = api.database_sources(&reference.id).await else {
                return Ok(None);
            };
            let [source] = sources.as_slice() else {
                return Ok(None);
            };
            source.clone()
        };
        if skipped.contains(&source) {
            return Ok(None);
        }
        let Some(row) = self.link_target(user, audience, &source).await? else {
            return Ok(None);
        };
        let Some(database) = row
            .entity_id
            .as_deref()
            .filter(|_| {
                row.kind == ImportKind::DataSource && row.entity_type.as_deref() == Some("database")
            })
            .and_then(|id| id.parse::<Uuid>().ok())
        else {
            return Ok(None);
        };
        let accessible = if audience.is_none() {
            self.creator
                .owns_notion_link_target(user, ImportedTarget::Database(database))
                .await?
        } else {
            self.creator.database_access(user, database).await?
        };
        if !accessible {
            return Ok(None);
        }
        let Some(mapping) = self
            .repo
            .database_mapping(user, &source, database, reference.view_id.as_ref())
            .await?
        else {
            return Ok(None);
        };
        let destination = self.creator.database(user, database, mapping.table).await?;
        let view = mapping.view;
        if reference.view_id.is_some() && !view.is_some_and(|id| destination.views.contains(&id)) {
            return Ok(None);
        }
        Ok(Some(NotionLinkDestination::Database {
            database,
            table: mapping.table,
            view,
        }))
    }
}
