//! Email labels: the labels of every inbox the viewer owns or is delegated,
//! listed once (one read per inbox) and kept when a name contains a needle.

use std::sync::Arc;

use email::domain::ports::EmailUserService;
use models_search::names::{NameKind, NamedItem};
use search_service::names::{Candidate, NameSource, NameSourceError, NameViewer, Needle};

use super::{contains_any, internal};

/// Email labels across the viewer's inboxes, by name.
pub struct EmailLabelNames<S> {
    service: Arc<S>,
}

impl<S> EmailLabelNames<S> {
    /// A source over the email service the label routes use.
    pub fn new(service: Arc<S>) -> Self {
        Self { service }
    }
}

// `async_trait` because the lookup holds sources as `Arc<dyn NameSource>`.
#[async_trait::async_trait]
impl<S: EmailUserService> NameSource for EmailLabelNames<S> {
    fn kinds(&self) -> &'static [NameKind] {
        &[NameKind::Label]
    }

    #[tracing::instrument(
        name = "search.names.email_labels",
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
        let labels = self
            .service
            .get_user_email_labels(viewer.user.clone())
            .await
            .map_err(internal)?;
        tracing::Span::current().record("listed", labels.len());

        Ok(labels
            .into_iter()
            .filter(|label| contains_any(&label.name, needles))
            .map(|label| Candidate {
                item: NamedItem::Label { id: label.id },
                name: label.name,
                aliases: Vec::new(),
            })
            .collect())
    }
}
