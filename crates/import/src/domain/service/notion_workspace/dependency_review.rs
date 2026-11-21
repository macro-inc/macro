//! Saved-review consent for sources outside the selected roots.

use super::*;
use crate::domain::models::{NotionDependencyReview, WrittenKind, WrittenObject};

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: ConnectorSelect,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    #[tracing::instrument(name = "notion.review_dependencies", skip_all, fields(review_id = %review, dependencies = tracing::field::Empty), err)]
    pub(in crate::domain::service) async fn review_dependencies(
        &self,
        user: &MacroUserIdStr<'static>,
        review: Uuid,
        excluded: &[Uuid],
        saved: bool,
    ) -> Result<NotionDependencyReview> {
        if self.workspace_source != ImportSource::Notion {
            return Ok(NotionDependencyReview {
                excluded: excluded.to_vec(),
                included: vec![],
                needs_receipt: false,
            });
        }
        let ids = self.repo.dependency_ids(user, review).await?;
        tracing::Span::current().record("dependencies", ids.len() as i64);
        let facts = self.repo.written(user, &ids).await?;
        let scope = review.to_string();
        let seen: std::collections::HashSet<Uuid> = facts
            .iter()
            .filter(|fact| {
                fact.kind == WrittenKind::DependencyReviewed
                    && fact.object == scope
                    && fact.macro_id == review
            })
            .map(|fact| fact.import_id)
            .collect();
        let offered: Vec<_> = ids
            .iter()
            .filter(|id| excluded.contains(id) && !seen.contains(id))
            .map(|id| WrittenObject {
                import_id: *id,
                kind: WrittenKind::DependencyReviewed,
                object: scope.clone(),
                macro_id: review,
            })
            .collect();
        let needs_receipt = !offered.is_empty();
        // Only persisted exclusions establish that this particular dependency
        // was offered. An absent id in an old draft never grants consent.
        if saved && needs_receipt {
            self.repo.record_written(user, &offered).await?;
        }
        let included = ids
            .iter()
            .filter(|id| seen.contains(id) && !excluded.contains(id))
            .copied()
            .collect();
        let mut excluded = excluded.to_vec();
        for id in ids {
            if !seen.contains(&id) && !excluded.contains(&id) {
                excluded.push(id);
            }
        }
        excluded.sort_unstable();
        excluded.dedup();
        Ok(NotionDependencyReview {
            excluded,
            included,
            needs_receipt,
        })
    }
}
