//! Tags: the options of the viewer's personal tag set and, on a team, the
//! team's, read once and kept when a name contains a needle.

use std::sync::Arc;

use models_search::names::{NameKind, NamedItem};
use properties::PropertiesService;
use search_service::names::{Candidate, NameSource, NameSourceError, NameViewer, Needle};

use super::{contains_any, internal};

/// Tags in the viewer's tag sets, by name.
pub struct TagNames<S> {
    service: Arc<S>,
}

impl<S> TagNames<S> {
    /// A source over the properties service the tag routes use.
    pub fn new(service: Arc<S>) -> Self {
        Self { service }
    }
}

// `async_trait` because the lookup holds sources as `Arc<dyn NameSource>`.
#[async_trait::async_trait]
impl<S: PropertiesService> NameSource for TagNames<S> {
    fn kinds(&self) -> &'static [NameKind] {
        &[NameKind::Tag]
    }

    #[tracing::instrument(
        name = "search.names.tags",
        skip_all,
        fields(sets = tracing::field::Empty, listed = tracing::field::Empty),
        err
    )]
    async fn find(
        &self,
        viewer: &NameViewer,
        _kinds: &[NameKind],
        needles: &[Needle],
    ) -> Result<Vec<Candidate>, NameSourceError> {
        let sets = self
            .service
            .list_tag_sets(&viewer.user, viewer.team.as_ref())
            .await
            .map_err(internal)?;
        let span = tracing::Span::current();
        span.record("sets", sets.len());
        span.record(
            "listed",
            sets.iter().map(|set| set.options.len()).sum::<usize>(),
        );

        // A tag is an option of its set's property; the option names its
        // definition, so a set without one yet has no options to name.
        Ok(sets
            .into_iter()
            .flat_map(|set| set.options)
            .filter_map(|option| {
                let name = option.value.as_string()?;
                contains_any(name, needles).then(|| Candidate {
                    item: NamedItem::Tag {
                        id: option.id,
                        definition_id: option.property_definition_id,
                    },
                    name: name.to_string(),
                    aliases: Vec::new(),
                })
            })
            .collect())
    }
}
