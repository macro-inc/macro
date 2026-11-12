//! Channel labels: the labels the `/channel-labels` route lists for the
//! viewer (the team's when on a team, else their own), read once by name
//! alone and kept when a name contains a needle.

use std::sync::Arc;

use channel_labels::domain::{models::ChannelLabelsReceipt, ports::ChannelLabelsService};
use models_search::names::{NameKind, NamedItem};
use search_service::names::{Candidate, NameSource, NameSourceError, NameViewer, Needle};

use super::{contains_any, internal};

/// Channel labels of the viewer's scope, by name.
pub struct ChannelLabelNames<S> {
    service: Arc<S>,
}

impl<S> ChannelLabelNames<S> {
    /// A source over the legacy (non-sections) channel labels service.
    pub fn new(service: Arc<S>) -> Self {
        Self { service }
    }
}

// `async_trait` because the lookup holds sources as `Arc<dyn NameSource>`.
#[async_trait::async_trait]
impl<S: ChannelLabelsService> NameSource for ChannelLabelNames<S> {
    fn kinds(&self) -> &'static [NameKind] {
        &[NameKind::ChannelLabel]
    }

    #[tracing::instrument(
        name = "search.names.channel_labels",
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
        // No scope selection, as the route without one: the team's labels
        // when the viewer is on a team, else their own.
        let receipt =
            ChannelLabelsReceipt::from_access(viewer.user.clone(), viewer.team.clone(), None)
                .map_err(internal)?;
        let labels = self
            .service
            .list_label_names(&receipt)
            .await
            .map_err(internal)?;
        tracing::Span::current().record("listed", labels.len());

        Ok(labels
            .into_iter()
            .filter(|label| contains_any(&label.name, needles))
            .map(|label| Candidate {
                item: NamedItem::ChannelLabel { id: label.id },
                name: label.name,
                aliases: Vec::new(),
            })
            .collect())
    }
}
