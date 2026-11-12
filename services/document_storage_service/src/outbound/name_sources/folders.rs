//! Folders: every live folder the viewer can access, listed once and kept
//! when a name contains a needle.

use std::sync::Arc;

use models_search::names::{NameKind, NamedItem};
use projects_hex::domain::ports::ProjectService;
use search_service::names::{Candidate, NameSource, NameSourceError, NameViewer, Needle};
use uuid::Uuid;

use super::{contains_any, internal};

/// Folders the viewer can access, by name.
pub struct FolderNames<S> {
    service: Arc<S>,
}

impl<S> FolderNames<S> {
    /// A source over the projects service the folder routes use.
    pub fn new(service: Arc<S>) -> Self {
        Self { service }
    }
}

// `async_trait` because the lookup holds sources as `Arc<dyn NameSource>`.
#[async_trait::async_trait]
impl<S: ProjectService> NameSource for FolderNames<S> {
    fn kinds(&self) -> &'static [NameKind] {
        &[NameKind::Project]
    }

    #[tracing::instrument(
        name = "search.names.folders",
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
        let folders = self
            .service
            .list_accessible_projects(viewer.user.clone())
            .await
            .map_err(internal)?;
        tracing::Span::current().record("listed", folders.len());

        Ok(folders
            .into_iter()
            .filter(|folder| folder.deleted_at.is_none())
            .filter(|folder| contains_any(&folder.name, needles))
            .filter_map(|folder| {
                let id = Uuid::parse_str(&folder.id).ok()?;
                Some(Candidate {
                    item: NamedItem::Project { id },
                    name: folder.name,
                    aliases: Vec::new(),
                })
            })
            .collect())
    }
}
