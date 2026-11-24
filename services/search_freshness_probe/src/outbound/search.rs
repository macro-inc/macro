//! `POST /dss/search`, the unified search every client calls, restricted to
//! the entity type a round changed.

use item_filters::{EntityFilters, PropertyFilter};
use models_search::unified::{
    UnifiedSearchIndex, UnifiedSearchRequest, UnifiedSearchResponse, UnifiedSearchResponseItem,
    entity_filters_from_include,
};
use models_search::{MatchType, SearchOn};
use reqwest::Method;

use super::macro_api::{ApiError, Call, MacroApi};
use crate::domain::model::{EntityId, EntityType, MARKER, SearchQuery, is_probe_title};
use crate::domain::ports::Search;

#[cfg(test)]
mod test;

/// A token matches one entity, so one page holds every hit a check needs.
const PAGE_SIZE: u8 = 10;

/// Search as the probe user.
#[derive(Clone)]
pub struct UnifiedSearch {
    api: MacroApi,
}

impl UnifiedSearch {
    /// Searches through `api`.
    pub fn new(api: MacroApi) -> Self {
        Self { api }
    }

    /// The fixtures of `entity_type` the probe user can see, in search's
    /// order: agent sessions and call records titled as the probe titles
    /// them. A fixture is seeded once, and this is how the probe finds it.
    pub async fn fixtures(&self, entity_type: EntityType) -> Result<Vec<EntityId>, ApiError> {
        let response = self
            .send(UnifiedSearchRequest {
                query: MARKER.to_owned(),
                match_type: MatchType::Exact,
                filters: only(entity_type, EntityFilters::default()),
                search_on: SearchOn::Name,
                ..request_defaults()
            })
            .await?;
        Ok(response
            .results
            .into_iter()
            .filter_map(|item| match (entity_type, item) {
                (EntityType::AgentSession, UnifiedSearchResponseItem::AgentSession(session)) => {
                    is_probe_title(&session.name).then_some(session.id)
                }
                (EntityType::Call, UnifiedSearchResponseItem::Call(call)) => call
                    .extra
                    .name
                    .as_deref()
                    .is_some_and(is_probe_title)
                    .then_some(call.extra.call_id),
                _ => None,
            })
            .map(EntityId)
            .collect())
    }

    async fn send(&self, request: UnifiedSearchRequest) -> Result<UnifiedSearchResponse, ApiError> {
        self.api
            .json(
                Call::new(
                    Method::POST,
                    "/dss/search",
                    format!("/dss/search?page_size={PAGE_SIZE}"),
                ),
                Some(&request),
            )
            .await
    }
}

impl Search for UnifiedSearch {
    type Err = ApiError;

    async fn hits(&self, query: &SearchQuery) -> Result<Vec<EntityId>, ApiError> {
        let (entity_type, request) = match query {
            SearchQuery::Text { entity_type, token } => (
                *entity_type,
                UnifiedSearchRequest {
                    query: token.as_str().to_owned(),
                    match_type: MatchType::Exact,
                    filters: only(*entity_type, EntityFilters::default()),
                    search_on: SearchOn::NameContent,
                    ..request_defaults()
                },
            ),
            SearchQuery::Prefix {
                entity_type,
                prefix,
                entity_id,
            } => {
                let mut filters = EntityFilters::default();
                filters.document_filters.document_ids = vec![entity_id.to_string()];
                (
                    *entity_type,
                    UnifiedSearchRequest {
                        query: prefix.as_str().to_owned(),
                        match_type: MatchType::Partial,
                        filters: only(*entity_type, filters),
                        search_on: SearchOn::Content,
                        ..request_defaults()
                    },
                )
            }
            SearchQuery::Property {
                property_id,
                name,
                value,
            } => {
                let mut filters = EntityFilters::default();
                filters.property_filters.push(PropertyFilter {
                    property_definition_id: property_id.to_string(),
                    option_ids: vec![value.as_str().to_owned()],
                    ..PropertyFilter::default()
                });
                (
                    EntityType::Property,
                    UnifiedSearchRequest {
                        query: name.as_str().to_owned(),
                        match_type: MatchType::Exact,
                        filters: only(EntityType::Property, filters),
                        search_on: SearchOn::Name,
                        ..request_defaults()
                    },
                )
            }
        };
        let response = self.send(request).await?;
        Ok(hits_of(entity_type, response))
    }
}

/// The index search reads for `entity_type`: a property lives on its
/// document.
fn index_of(entity_type: EntityType) -> UnifiedSearchIndex {
    match entity_type {
        EntityType::Document | EntityType::Property => UnifiedSearchIndex::Documents,
        EntityType::Message => UnifiedSearchIndex::Channels,
        EntityType::Project => UnifiedSearchIndex::Projects,
        EntityType::AgentSession => UnifiedSearchIndex::AgentSessions,
        EntityType::Call => UnifiedSearchIndex::CallRecords,
    }
}

/// `base`, with every other entity type excluded the way the SDK excludes
/// them.
fn only(entity_type: EntityType, base: EntityFilters) -> EntityFilters {
    entity_filters_from_include(vec![index_of(entity_type)], base)
}

/// The ids the probe's writes use, of the hits of `entity_type`: a message's
/// own id rather than its channel's, a call record's call id. A deleted
/// message search still returns, marked deleted, is not a hit.
fn hits_of(entity_type: EntityType, response: UnifiedSearchResponse) -> Vec<EntityId> {
    response
        .results
        .into_iter()
        .filter_map(|item| match (entity_type, item) {
            (
                EntityType::Document | EntityType::Property,
                UnifiedSearchResponseItem::Document(document),
            ) => Some(document.extra.document_id),
            (EntityType::Message, UnifiedSearchResponseItem::ChannelMessage(message)) => {
                message.deleted_at.is_none().then_some(message.message_id)
            }
            (EntityType::Project, UnifiedSearchResponseItem::Project(project)) => {
                Some(project.extra.id)
            }
            (EntityType::AgentSession, UnifiedSearchResponseItem::AgentSession(session)) => {
                Some(session.id)
            }
            (EntityType::Call, UnifiedSearchResponseItem::Call(call)) => Some(call.extra.call_id),
            _ => None,
        })
        .map(EntityId)
        .collect()
}

fn request_defaults() -> UnifiedSearchRequest {
    UnifiedSearchRequest {
        query: String::new(),
        match_type: MatchType::Exact,
        filters: EntityFilters::default(),
        search_on: SearchOn::default(),
        include_crm: false,
        calendar_event_scope: Default::default(),
        term_matching: Default::default(),
        collapse: None,
        time_zone: None,
    }
}
