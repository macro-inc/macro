//! Databases: every live database the viewer can see, listed once and kept
//! when a name contains a needle. The databases domain has no lighter list:
//! this one also reads each database's tables (not their columns).

use std::sync::Arc;

use databases::domain::{models::Viewer, ports::DatabasesService};
use models_search::names::{NameKind, NamedItem};
use search_service::names::{Candidate, NameSource, NameSourceError, NameViewer, Needle};

use super::{contains_any, internal};

/// Databases the viewer can see, by name.
pub struct DatabaseNames<S> {
    service: Arc<S>,
}

impl<S> DatabaseNames<S> {
    /// A source over the databases service the database routes use.
    pub fn new(service: Arc<S>) -> Self {
        Self { service }
    }
}

// `async_trait` because the lookup holds sources as `Arc<dyn NameSource>`.
#[async_trait::async_trait]
impl<S: DatabasesService> NameSource for DatabaseNames<S> {
    fn kinds(&self) -> &'static [NameKind] {
        &[NameKind::Database]
    }

    #[tracing::instrument(
        name = "search.names.databases",
        skip_all,
        fields(listed = tracing::field::Empty),
        err
    )]
    async fn find(
        &self,
        viewer: &NameViewer,
        _kinds: &[NameKind],
        needles: &[Needle],
    ) -> Result<Vec<Candidate>, NameSourceError> {
        let listed = self
            .service
            .list_databases(Viewer {
                user_id: viewer.user.clone(),
                acting_bot: None,
            })
            .await
            .map_err(internal)?;
        tracing::Span::current().record("listed", listed.len());

        Ok(listed
            .into_iter()
            .map(|listed| listed.database)
            .filter(|database| database.trashed_at.is_none())
            .filter(|database| contains_any(&database.name, needles))
            .map(|database| Candidate {
                item: NamedItem::Database {
                    id: database.id.into_uuid(),
                },
                name: database.name,
                aliases: Vec::new(),
            })
            .collect())
    }
}
