//! Outbound adapter implementing [`SkillSearcher`] via the search service.

use std::sync::Arc;

use document_sub_type::DocumentSubType;
use item_filters::{DocumentFilters, EntityFilters};
use macro_user_id::user_id::MacroUserIdStr;
use models_search::unified::{
    UnifiedSearchIndex, UnifiedSearchRequest, UnifiedSearchResponseItem,
    entity_filters_from_include,
};
use search_service_client::SearchServiceClient;

use crate::domain::model::{SkillError, SkillMatchType, SkillSummary};
use crate::domain::ports::SkillSearcher;

/// Maximum number of skills returned from a single search.
const PAGE_SIZE: i64 = 50;

/// [`SkillSearcher`] implementation backed by the search service. The search
/// service enforces per-user access control, so only skills the user can view
/// are returned.
#[derive(Clone)]
pub struct SearchServiceSkillSearcher {
    client: Arc<SearchServiceClient>,
}

impl SearchServiceSkillSearcher {
    /// Create a new searcher from a search service client.
    pub fn new(client: Arc<SearchServiceClient>) -> Self {
        Self { client }
    }
}

impl SkillSearcher for SearchServiceSkillSearcher {
    #[tracing::instrument(skip(self), err)]
    async fn search_skills_by_name(
        &self,
        user_id: &MacroUserIdStr<'_>,
        query: &str,
        match_type: SkillMatchType,
    ) -> Result<Vec<SkillSummary>, SkillError> {
        let base_filters = EntityFilters {
            document_filters: DocumentFilters {
                sub_types: vec![DocumentSubType::Skill.to_string()],
                ..Default::default()
            },
            ..Default::default()
        };

        let request = UnifiedSearchRequest {
            query: query.to_owned(),
            match_type: match match_type {
                SkillMatchType::Partial => models_search::MatchType::Partial,
                SkillMatchType::Exact => models_search::MatchType::Exact,
            },
            filters: entity_filters_from_include(vec![UnifiedSearchIndex::Documents], base_filters),
            search_on: models_search::SearchOn::Name,
            include_crm: false,
            collapse: None,
        };

        let response = self
            .client
            .search_unified(user_id.as_ref(), request, None, PAGE_SIZE)
            .await
            .map_err(SkillError::SearchFailed)?;

        Ok(response
            .results
            .into_iter()
            .filter_map(|item| match item {
                UnifiedSearchResponseItem::Document(doc) => Some(SkillSummary {
                    document_id: doc.extra.id,
                    name: doc.extra.document_name,
                    updated_at: doc.metadata.as_ref().map(|m| m.updated_at),
                }),
                _ => None,
            })
            .collect())
    }
}
