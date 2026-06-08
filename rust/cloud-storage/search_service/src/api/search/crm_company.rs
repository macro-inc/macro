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
use entity_access::domain::models::{
    Entity, EntityAccessReceipt, EntityPermission, EntityType, MemberTeamRole,
};
use entity_access::domain::ports::EntityAccessService;
use item_filters::CrmCompanyFilters;
use macro_user_id::user_id::MacroUserIdStr;
use model::user::UserContext;
use models_opensearch::SearchEntityType;
use models_search::crm_company::{CrmCompanySearchDomain, CrmCompanySearchResponseItem};
use models_search::unified::UnifiedSearchResponseItem;
use models_search_cursor::{SearchCursorOption, SearchMethodCursor};
use opensearch_client::search::model::{Highlight, SearchHit};
use uuid::Uuid;

use crate::api::context::SearchHandlerState;
use crate::api::search::simple::SearchError;

/// Resolve the caller's CRM team capability when `include_crm` is set.
///
/// Returns `None` (the CRM slice stays empty) — without erroring — when CRM
/// isn't requested or the user has no qualifying team membership; a missing
/// team must not fail the aggregate search. The role rides along inside the
/// receipt so the CRM service derives the hidden-company gate from it.
///
/// Assumes a single effective team per user (`get_user_team`). If multi-team
/// membership is introduced, this should take an explicit team id rather
/// than picking the highest-role team.
pub(in crate::api::search) async fn resolve_crm_team_receipt(
    ctx: &SearchHandlerState,
    user_context: &UserContext,
    include_crm: bool,
) -> Result<Option<CrmTeamReceipt<MemberTeamRole>>, SearchError> {
    if !include_crm {
        return Ok(None);
    }
    let user_id = MacroUserIdStr::try_from(user_context.user_id.clone())
        .map_err(|_| SearchError::InvalidUserId(user_context.user_id.clone()))?;
    let Some(team) = ctx
        .entity_access_service
        .get_user_team(&user_id)
        .await
        .map_err(|e| SearchError::InternalError(e.into()))?
    else {
        return Ok(None);
    };
    // Member is the floor for MemberTeamRole, so this never rejects; the
    // role still rides along for the hidden-company gate.
    let receipt = EntityAccessReceipt::<MemberTeamRole>::try_new_authenticated_user(
        user_id,
        Entity {
            entity_id: team.team_id.to_string(),
            entity_type: EntityType::Team,
        },
        EntityPermission::TeamRole { role: team.role },
    )
    .map_err(|e| SearchError::InternalError(e.into()))?;
    CrmTeamReceipt::from_team_receipt(receipt)
        .map(Some)
        .map_err(|e| SearchError::InternalError(e.into()))
}

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

    // Defensive: an empty term would match every company via `ILIKE '%%'`.
    // Callers already enforce a 3-char minimum upstream, but CRM is DB-backed
    // and opt-in, so guard against accidentally listing the whole team.
    let term = term.trim();
    if term.is_empty() {
        return Ok((vec![], SearchCursorOption::Done));
    }

    let crm_cursor =
        inner_cursor
            .and_then(|c| c.as_updated_at())
            .map(|(last_id, last_updated_at)| CrmCompanySearchCursor {
                last_updated_at,
                last_id,
            });

    // Parse strictly: an invalid id is a malformed request, not "no filter".
    // Silently dropping it would let a fully-invalid id list collapse to the
    // empty set, which the repo reads as "all the team's companies".
    let mut company_ids: Vec<Uuid> = Vec::with_capacity(filters.company_ids.len());
    for id in &filters.company_ids {
        company_ids
            .push(Uuid::parse_str(id).map_err(|_| SearchError::InvalidCrmCompanyId(id.clone()))?);
    }

    // Fetch one extra row to detect whether a next page exists.
    let fetch_limit = limit as i64 + 1;
    let mut matches = search_service(ctx)
        .search_company_names(
            access,
            term,
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
        // Search results aren't view-tracked; no viewed_at in the response.
        viewed_at: _,
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
