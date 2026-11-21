//! Reserve every database and saved view before converting referencing bodies.

use super::databases::{DatabaseDestination, DatabaseDestinations};
use super::*;
use crate::domain::models::{TeamClaim, WrittenKind};
use crate::domain::ports::{ImportRepo, ImportedDatabase, NotionDatabaseFallback};
use std::collections::HashSet;
mod failure;

pub(super) struct Reservations {
    pub prepared: HashMap<NotionId, write::PreparedDatabase>,
    pub destinations: DatabaseDestinations,
    pub failures: HashMap<NotionId, String>,
}

/// Independent source reservations share the normal Notion pacer.
const RESERVATION_CONCURRENCY: usize = 4;

struct ReservationContext<'a, Api> {
    api: &'a super::databases::CachedNotion<Api>,
    user: &'a MacroUserIdStr<'static>,
    place: &'a Place<'a>,
    team: Option<Uuid>,
    written: &'a [crate::domain::models::WrittenObject],
    cancel: &'a write::Cancel,
    pending: HashSet<Uuid>,
    source_titles: HashMap<&'a str, &'a str>,
}

#[derive(Default)]
struct ReservedSource {
    prepared: Option<write::PreparedDatabase>,
    destination: Option<DatabaseDestination>,
    failure: Option<String>,
}

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: ConnectorSelect,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    #[expect(
        clippy::too_many_arguments,
        reason = "the reviewed set, destination layout and durable ledger"
    )]
    #[tracing::instrument(name = "notion.reserve_databases", skip_all, fields(databases = tracing::field::Empty, failures = tracing::field::Empty))]
    pub(super) async fn reserve_databases(
        &self,
        api: &super::databases::CachedNotion<N::Api>,
        user: &MacroUserIdStr<'static>,
        set: &WriteSet,
        place: &Place<'_>,
        team: Option<Uuid>,
        written: &[crate::domain::models::WrittenObject],
        cancel: &write::Cancel,
    ) -> Result<Reservations> {
        let pending: HashSet<Uuid> = set.pending.iter().map(|item| item.import_id).collect();
        let mut prepared = HashMap::new();
        let mut destinations: DatabaseDestinations = set
            .all
            .iter()
            .filter(|item| {
                item.kind == ImportKind::DataSource && item.decision != NotionDecision::Copy
            })
            .map(|item| {
                (
                    item.notion_id.clone(),
                    DatabaseDestination::Fallback(NotionDatabaseFallback::NotImported),
                )
            })
            .collect();
        let mut failures = HashMap::new();
        let source_titles: HashMap<&str, &str> = set
            .all
            .iter()
            .filter(|item| item.kind == ImportKind::DataSource)
            .map(|item| (item.notion_id.as_str(), item.title.as_str()))
            .collect();
        let context = ReservationContext {
            api,
            user,
            place,
            team,
            written,
            cancel,
            pending,
            source_titles,
        };
        let sources: Vec<_> = set
            .all
            .iter()
            .filter(|item| {
                item.kind == ImportKind::DataSource && item.decision == NotionDecision::Copy
            })
            .cloned()
            .collect();
        let requests: Vec<_> = sources
            .into_iter()
            .map(|item| {
                let context = &context;
                async move {
                    (
                        item.notion_id.clone(),
                        self.reserve_source(&item, context).await,
                    )
                }
                .boxed()
            })
            .collect();
        let mut reservations = stream::iter(requests).buffer_unordered(RESERVATION_CONCURRENCY);
        let mut first_error = None;
        // Drain every admitted reservation before returning a transient error.
        // Dropping one after a remote create but before its marker would leave
        // another source's retry without its durable schema facts.
        let mut failed = 0i64;
        while let Some((source, result)) = reservations.next().await {
            match result {
                Ok(reserved) => {
                    if let Some(destination) = reserved.destination {
                        destinations.insert(source.clone(), destination);
                    }
                    if let Some(database) = reserved.prepared {
                        prepared.insert(source.clone(), database);
                    }
                    if let Some(reason) = reserved.failure {
                        failed += 1;
                        failures.insert(source, reason);
                    }
                }
                Err(error) => {
                    failed += 1;
                    if first_error.is_none() {
                        first_error = Some(error);
                    }
                }
            }
        }
        tracing::Span::current().record("failures", failed);
        if let Some(error) = first_error {
            return Err(error);
        }
        tracing::Span::current().record("databases", destinations.len() as i64);
        Ok(Reservations {
            prepared,
            destinations,
            failures,
        })
    }

    // Report errors contain reviewed titles; traces retain only ids and outcomes.
    #[tracing::instrument(name = "notion.reserve_database", skip_all, fields(source_id = %item.notion_id, failed = tracing::field::Empty, attempts = tracing::field::Empty))]
    async fn reserve_source(
        &self,
        item: &write::WriteItem,
        context: &ReservationContext<'_, N::Api>,
    ) -> Result<ReservedSource> {
        let result = self.reserve_source_inner(item, context).await;
        let failed = result.as_ref().is_err()
            || result
                .as_ref()
                .is_ok_and(|reserved| reserved.failure.is_some());
        tracing::Span::current().record("failed", failed);
        result.map_err(|error| {
            let reason = match &error {
                ImportError::Other(cause) => cause
                    .downcast_ref::<failure::RunFailure>()
                    .map(|failure| failure.0.as_str()),
                _ => None,
            }
            .unwrap_or("database reservation could not be persisted; retry this import");
            let title = if item.title.trim().is_empty() {
                plan::UNTITLED_DATABASE
            } else {
                &item.title
            };
            ImportError::Other(anyhow::anyhow!("Database \"{title}\": {reason}"))
        })
    }

    async fn reserve_source_inner(
        &self,
        item: &write::WriteItem,
        context: &ReservationContext<'_, N::Api>,
    ) -> Result<ReservedSource> {
        let writer = self.creator.as_ref();
        let store = &self.repo;
        let api = context.api;
        let user = context.user;
        let place = context.place;
        let team = context.team;
        let written = context.written;
        let cancel = context.cancel;
        let pending = &context.pending;
        let source_titles = &context.source_titles;
        let mut reserved = ReservedSource::default();
        cancel.ensure_running()?;
        let progress = write::Progress::new(store, user, item.import_id, written);
        let outcome: anyhow::Result<()> = async {
            progress.ensure_supported()?;
            progress.reservation_failures()?;
            if !pending.contains(&item.import_id) {
                if let Some(row) = store.get(user, item.import_id).await?
                    && row.entity_type.as_deref() == Some(write::DATABASE_ENTITY)
                    && let Some(id) = row.entity_id
                {
                    let database = id.parse()?;
                    let destination = if progress.get(WrittenKind::Database) == Some(database)
                        && let Some(table) = progress.get(WrittenKind::Table)
                    {
                        DatabaseDestination::Ready(writer.database(user, database, models_databases::TableId::from_uuid(table)).await?)
                    } else {
                        reuse_database(writer, store, user, &item.notion_id, database, &progress).await?
                    };
                    if matches!(destination, DatabaseDestination::Fallback(NotionDatabaseFallback::NoAccess)) {
                        progress.warn(&[format!("Database {}: database view access unavailable; occurrences retain Notion links", item.title)]).await?;
                    }
                    reserved.destination = Some(destination);
                }
                return Ok(());
            }
            let claim = match team {
                Some(team) if item.shared || item.already_imported => super::super::lifecycle::claim_team_object(store, writer, user, item.import_id, team, item.shared).await?,
                _ => TeamClaim::Free,
            };
            match claim {
                TeamClaim::Linked { entity_id, entity_type } if entity_type == write::DATABASE_ENTITY => {
                    let destination = reuse_database(writer, store, user, &item.notion_id, entity_id.parse()?, &progress).await?;
                    if matches!(destination, DatabaseDestination::Fallback(NotionDatabaseFallback::NoAccess)) {
                        progress.warn(&[format!("Database {}: database view access unavailable; occurrences retain Notion links", item.title)]).await?;
                    }
                    reserved.destination = Some(destination);
                    return Ok(());
                }
                TeamClaim::Linked { .. } => return Ok(()),
                TeamClaim::Waiting { .. } => {
                    return Err(failure::RunFailure("a teammate is still creating this database; retry this import when it finishes".into()).into());
                }
                TeamClaim::Held | TeamClaim::Free => {}
            }
            let planned = place.folder_for(item, false);
            // Visibility is the reviewed verdict, independently of who holds a
            // team claim. Reuse the same persistent mirror used for personal pages.
            let visibility = ImportVisibility::from_shared(item.shared);
            let folder = match visibility {
                ImportVisibility::Shared => Some(planned),
                ImportVisibility::Personal => Some(self.personal_item_folder(
                    user, item.import_id, planned, place.path_for(planned)?,
                ).await?),
            };
            let database = write::prepare_database(api, writer, user, item, folder, &progress, cancel).await?;
            if item.parent.is_none() && folder == Some(place.root) && !item.dependency_of.is_empty() {
                let row_sources: Vec<&str> = item.dependency_of.iter()
                    .filter_map(|id| source_titles.get(id.as_str()).copied()).collect();
                if row_sources.len() == item.dependency_of.len() {
                    progress.warn(&[format!("Database {}: filed at the Notion folder because it is only referenced from rows of {}", item.title, row_sources.join(", "))]).await?;
                }
            }
            reserved.destination = Some(DatabaseDestination::Ready(ImportedDatabase { database_id: database.created.database_id, table: database.created.table, views: database.views.iter().copied().collect() }));
            reserved.prepared = Some(database);
            Ok(())
        }.await;
        if let Err(error) = outcome {
            let classified = if let Some(reason) = error.downcast_ref::<failure::RunFailure>() {
                progress.flush_warnings().await?;
                return Err(ImportError::Other(
                    failure::RunFailure(reason.0.clone()).into(),
                ));
            } else {
                failure::classify(&error)
            };
            let (reason, fallback) = match classified {
                failure::Failure::Permanent(reason, fallback) => (reason, fallback),
                failure::Failure::SourceRetryable(reason) => {
                    let attempts = progress.reservation_failure().await?;
                    tracing::Span::current().record("attempts", attempts as i64);
                    tracing::warn!(source_id = %item.notion_id, attempts, retryable = attempts < write::RESERVATION_ATTEMPTS, "source reservation did not complete");
                    if attempts < write::RESERVATION_ATTEMPTS {
                        progress.flush_warnings().await?;
                        return Err(ImportError::Other(
                            failure::RunFailure(format!(
                                "{reason}; attempt {attempts} of {}, retry this import",
                                write::RESERVATION_ATTEMPTS
                            ))
                            .into(),
                        ));
                    }
                    (
                        crate::domain::models::SourceStopReason::ReservationRetriesExhausted,
                        NotionDatabaseFallback::Unresolved,
                    )
                }
                failure::Failure::RunWide(reason) => {
                    tracing::warn!(source_id = %item.notion_id, retryable = true, "database reservation stopped before body conversion");
                    progress.flush_warnings().await?;
                    return Err(ImportError::Other(
                        failure::RunFailure(reason.into()).into(),
                    ));
                }
            };
            progress.source_stopped(&item.title, reason).await?;
            reserved.destination = Some(DatabaseDestination::Fallback(fallback));
            reserved.failure = Some(reason.to_string());
        }
        progress.flush_warnings().await?;
        Ok(reserved)
    }
}

/// Access is checked before reading another owner's import provenance. The
/// host then verifies the recorded table; UI table order is never an identity.
async fn reuse_database<Writer: WorkspaceWriter, Store: WrittenObjects>(
    writer: &Writer,
    store: &Store,
    user: &MacroUserIdStr<'static>,
    source: &NotionId,
    database: Uuid,
    progress: &write::Progress<'_, Store>,
) -> anyhow::Result<DatabaseDestination> {
    if !writer.database_access(user, database).await? {
        return Ok(DatabaseDestination::Fallback(
            NotionDatabaseFallback::NoAccess,
        ));
    }
    let mapping = store
        .database_mapping(user, source, database)
        .await?
        .ok_or(crate::domain::models::SourceStopReason::HolderMarkerMissing)?;
    let database = writer.database(user, database, mapping.table).await?;
    progress.warn_fidelity(&mapping.warnings).await?;
    Ok(DatabaseDestination::Ready(database))
}
