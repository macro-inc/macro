//! CRM company search source + enrichment for unified search.
//!
//! CRM companies are Postgres-only (like projects) and gated by a
//! capability-token receipt, so they don't flow through the OpenSearch
//! split/enrich path: [`search_company_names`] synthesizes `SearchHit`s
//! the same way the other name searches do, and [`enrich_crm_companies`]
//! hydrates them into [`UnifiedSearchResponseItem::Company`].

use std::collections::HashMap;

use crm::domain::auth::CrmTeamReceipt;
use crm::domain::model::CrmCompanyForSoup;
use crm::domain::search_repo::CrmCompanySearchCursor;
use crm::domain::search_service::{CrmSearchService, CrmSearchServiceImpl};
use crm::outbound::search_repo::CrmSearchRepositoryImpl;
use entity_access::domain::models::MemberTeamRole;
use item_filters::CrmCompanyFilters;
use models_opensearch::SearchEntityType;
use models_search::crm_company::{CrmCompanySearchDomain, CrmCompanySearchResponseItem};
use models_search::unified::UnifiedSearchResponseItem;
use models_search_cursor::{SearchCursorOption, SearchMethodCursor};
use opensearch_client::search::model::{Highlight, SearchHit};
use uuid::Uuid;

use crate::api::context::SearchHandlerState;
use crate::api::search::simple::SearchError;

/// Builds the CRM search service over the read-only pool. Search and
/// enrich are both read-only, so the read replica is fine.
fn search_service(ctx: &SearchHandlerState) -> CrmSearchServiceImpl<CrmSearchRepositoryImpl> {
    CrmSearchServiceImpl::new(CrmSearchRepositoryImpl::new(ctx.db.0.clone()))
}

/// Name/domain search over the caller's team CRM companies, returning
/// `SearchHit`s tagged [`SearchEntityType::CrmCompanies`] plus the next
/// CRM cursor. The hidden gate is enforced inside the CRM service from
/// the receipt's role — the caller can't widen it.
#[tracing::instrument(skip(ctx, access, filters), err)]
pub(in crate::api::search) async fn search_company_names(
    ctx: &SearchHandlerState,
    access: &CrmTeamReceipt<MemberTeamRole>,
    filters: &CrmCompanyFilters,
    term: String,
    limit: u32,
    cursor: SearchCursorOption,
) -> Result<(Vec<SearchHit>, SearchCursorOption), SearchError> {
    // A Done cursor means this source is exhausted for the page set.
    let inner_cursor = match cursor {
        SearchCursorOption::Done => return Ok((vec![], SearchCursorOption::Done)),
        SearchCursorOption::NotDone(c) => c,
    };
    let crm_cursor =
        inner_cursor
            .and_then(|c| c.as_updated_at())
            .map(|(last_id, last_updated_at)| CrmCompanySearchCursor {
                last_updated_at,
                last_id,
            });

    let company_ids: Vec<Uuid> = filters
        .company_ids
        .iter()
        .filter_map(|id| Uuid::parse_str(id).ok())
        .collect();

    // Fetch one extra row to detect whether a next page exists.
    let fetch_limit = limit as i64 + 1;
    let mut matches = search_service(ctx)
        .search_company_names(
            access,
            &term,
            &company_ids,
            filters.hidden,
            fetch_limit,
            crm_cursor,
        )
        .await
        .map_err(|e| SearchError::InternalError(e.into()))?;

    let has_more = matches.len() > limit as usize;
    if has_more {
        matches.pop();
    }
    let next_cursor = if has_more {
        match matches.last() {
            Some(last) => SearchCursorOption::NotDone(Some(SearchMethodCursor::UpdatedAt {
                entity_id: last.id,
                updated_at: last.updated_at,
            })),
            None => SearchCursorOption::Done,
        }
    } else {
        SearchCursorOption::Done
    };

    let hits = matches
        .into_iter()
        .map(|m| SearchHit {
            entity_id: m.id,
            entity_type: SearchEntityType::CrmCompanies,
            score: None,
            highlight: Highlight {
                name: Some(m.name_highlighted),
                ..Default::default()
            },
            goto: None,
            updated_at: Some(m.updated_at),
        })
        .collect();

    Ok((hits, next_cursor))
}

/// Hydrate CRM company hits into [`UnifiedSearchResponseItem::Company`],
/// preserving the hits' sort order and attaching each hit's highlighted
/// name. Non-CRM hits are ignored.
#[tracing::instrument(skip(ctx, access, results), err)]
pub(in crate::api::search) async fn enrich_crm_companies(
    ctx: &SearchHandlerState,
    access: Option<&CrmTeamReceipt<MemberTeamRole>>,
    results: Vec<SearchHit>,
) -> Result<Vec<UnifiedSearchResponseItem>, SearchError> {
    let results: Vec<SearchHit> = results
        .into_iter()
        .filter(|r| r.entity_type == SearchEntityType::CrmCompanies)
        .collect();

    if results.is_empty() {
        return Ok(vec![]);
    }
    // There are no CRM hits without a receipt; stay defensive regardless.
    let Some(access) = access else {
        return Ok(vec![]);
    };

    let ids: Vec<Uuid> = results.iter().map(|r| r.entity_id).collect();

    let companies = search_service(ctx)
        .enrich_companies(access, &ids)
        .await
        .map_err(|e| SearchError::InternalError(e.into()))?;

    let mut by_id: HashMap<Uuid, CrmCompanyForSoup> =
        companies.into_iter().map(|c| (c.company.id, c)).collect();

    // Rebuild in match order, attaching the highlighted name from the hit.
    let items = results
        .into_iter()
        .filter_map(|hit| {
            let company = by_id.remove(&hit.entity_id)?;
            Some(UnifiedSearchResponseItem::Company(to_response_item(
                company,
                hit.highlight.name,
            )))
        })
        .collect();

    Ok(items)
}

/// Map an enriched company plus its highlighted name into the wire item.
fn to_response_item(
    c: CrmCompanyForSoup,
    name_highlighted: Option<String>,
) -> CrmCompanySearchResponseItem {
    let CrmCompanyForSoup {
        company,
        name,
        description,
    } = c;
    CrmCompanySearchResponseItem {
        id: company.id,
        team_id: company.team_id,
        name,
        name_highlighted,
        description,
        hidden: company.hidden,
        created_at: company.created_at,
        updated_at: company.updated_at,
        domains: company
            .domains
            .into_iter()
            .map(|d| CrmCompanySearchDomain {
                id: d.id,
                company_id: d.company_id,
                domain: d.domain,
                created_at: d.created_at,
            })
            .collect(),
    }
}
