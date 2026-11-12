//! Initiatives: the list the initiatives route answers (id, name and update
//! time of each one the viewer can view), read once and kept when a name
//! contains a needle. Unlike the paged search, it mints no receipt per item.

use std::sync::Arc;

use initiative::domain::ports::InitiativeService;
use models_search::names::{NameKind, NamedItem};
use search_service::names::{Candidate, NameSource, NameSourceError, NameViewer, Needle};

use super::{contains_any, internal};

/// Initiatives the viewer can view, by name.
pub struct InitiativeNames<S> {
    service: Arc<S>,
}

impl<S> InitiativeNames<S> {
    /// A source over the initiative service the initiative routes use.
    pub fn new(service: Arc<S>) -> Self {
        Self { service }
    }
}

// `async_trait` because the lookup holds sources as `Arc<dyn NameSource>`.
#[async_trait::async_trait]
impl<S: InitiativeService> NameSource for InitiativeNames<S> {
    fn kinds(&self) -> &'static [NameKind] {
        &[NameKind::Initiative]
    }

    #[tracing::instrument(
        name = "search.names.initiatives",
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
        let list = self.service.list(&viewer.user).await.map_err(internal)?;
        tracing::Span::current().record("listed", list.initiatives.len());

        Ok(list
            .initiatives
            .into_iter()
            .filter(|initiative| contains_any(&initiative.name, needles))
            .map(|initiative| Candidate {
                item: NamedItem::Initiative {
                    id: initiative.id.as_uuid(),
                },
                name: initiative.name,
                aliases: Vec::new(),
            })
            .collect())
    }
}
