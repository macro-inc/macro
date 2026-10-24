//! Task-only due-date policy and candidate hydration.
use cowlike::CowLike;
use std::collections::HashMap;

use item_filters::ast::EntityFilterAst;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_pagination::{
    Base64Str, Cursor, CursorVal, DueDateSort, Identify, Paginated, PaginatedCursor, Query,
};
use serde::Serialize;
use uuid::Uuid;

use super::{SoupCandidate, SoupImpl};
use crate::domain::{
    models::{AdvancedSortParams, SoupErr, SoupType, due_date::DueDateRequest},
    ports::SoupRepo,
};
use call::domain::ports::CallRecordQueryService;
use channels::domain::ports::ChannelListService;
use crm::domain::service::CrmService;
use email::domain::ports::EmailPreviewServiceReadOnly;
use frecency::domain::ports::FrecencyQueryService;
use github_pull_requests::domain::ports::GithubPullRequestListing;

fn invalid(message: &'static str) -> SoupErr {
    SoupErr::AstErr(item_filters::ast::ExpandErr::ApiAst(message.into()))
}

/// A due-date page has no cross-kind merge, CRM scope, or projection leg.
pub(super) fn validate_filter(
    ast: Option<&EntityFilterAst>,
    soup_type: SoupType,
    include_projection: bool,
) -> Result<(), SoupErr> {
    if matches!(soup_type, SoupType::UnExpanded) {
        return Err(invalid("due-date sorting requires expanded tasks"));
    }
    if include_projection {
        return Err(invalid(
            "due-date sorting does not support document projection",
        ));
    }
    if let Some(ast) = ast {
        if ast.favorites_only == Some(true) {
            return Err(invalid("due-date sorting does not support favorites"));
        }
        if ast.crm_association.is_some()
            || !ast.crm_associations().is_empty()
            || ast.requests_crm_scope()
            || ast.requests_crm_admin()
        {
            return Err(invalid("due-date sorting does not support CRM scope"));
        }
        if !crate::domain::models::non_task_filters_are_exclusions(ast) {
            return Err(invalid("due-date sorting accepts task filters only"));
        }
    }
    Ok(())
}

impl<T, U, V, C, K, Crm, F> SoupImpl<T, U, V, C, K, Crm, F>
where
    T: SoupRepo,
    anyhow::Error: From<T::Err>,
    U: FrecencyQueryService,
    V: EmailPreviewServiceReadOnly,
    C: ChannelListService,
    K: CallRecordQueryService,
    Crm: CrmService,
    F: GithubPullRequestListing,
{
    #[tracing::instrument(name = "tasks.due_date.read", err, skip_all, fields(limit, sort = ?cursor.sort_method()))]
    pub(super) async fn due_date_page<R: Serialize>(
        &self,
        user: MacroUserIdStr<'static>,
        limit: u16,
        cursor: Query<Uuid, DueDateSort, Option<EntityFilterAst>>,
        original_filter: R,
        include_projection: bool,
    ) -> Result<PaginatedCursor<SoupCandidate, String, DueDateSort, R>, SoupErr> {
        let cursor = cursor.map_filter(|filter| filter.unwrap_or_default());
        let sort_method = *cursor.sort_method();
        let rows = self
            .soup_storage
            .due_date_soup_page(DueDateRequest {
                user_id: user.clone(),
                limit,
                cursor,
            })
            .await
            .map_err(anyhow::Error::from)?;
        let next_cursor = if rows.len() == usize::from(limit) {
            rows.last().map(|last| {
                Base64Str::encode_json(Cursor {
                    id: last.id.to_string(),
                    limit: usize::from(limit),
                    val: CursorVal {
                        sort_type: sort_method,
                        last_val: last.due_at,
                    },
                    filter: original_filter,
                })
            })
        } else {
            None
        };
        let entities: Vec<_> = rows
            .iter()
            .map(|row| EntityType::Document.with_entity_string(row.id.to_string()))
            .collect();
        let hydrated = self
            .handle_soup_by_ids(
                SoupType::Expanded,
                AdvancedSortParams {
                    entities: &entities,
                    user_id: user.copied(),
                },
                include_projection,
            )
            .await
            .map_err(anyhow::Error::from)?;
        let mut by_id: HashMap<String, SoupCandidate> = hydrated
            .into_iter()
            .map(|candidate| (candidate.item.entity().entity_id.to_string(), candidate))
            .collect();
        let items = rows
            .into_iter()
            .filter_map(|row| by_id.remove(&row.id.to_string()))
            .collect();
        Ok(Paginated::from_parts(items, next_cursor))
    }
}

impl<T, U, V, C, K, Crm, F> SoupImpl<T, U, V, C, K, Crm, F>
where
    T: SoupRepo,
    anyhow::Error: From<T::Err>,
    U: FrecencyQueryService,
    V: EmailPreviewServiceReadOnly,
    C: ChannelListService,
    K: CallRecordQueryService,
    Crm: CrmService,
    F: GithubPullRequestListing,
{
    #[tracing::instrument(name = "tasks.due_date.groups.read", err, skip_all, fields(limit = req.limit, sort = ?req.cursor.sort_method()))]
    pub(super) async fn grouped_due_date_page(
        &self,
        mut req: crate::domain::models::due_date::GroupedDueDateRequest<'_>,
    ) -> Result<Vec<crate::domain::models::grouping::DueDateGroupedItem>, SoupErr> {
        use crate::domain::models::grouping::{DueDateGroupedItem, ItemGroupingInfo};
        crate::domain::models::due_date::validate_grouping(&req.grouping)?;
        if let Some(resolved) = self
            .resolve_crm_associations(&req.user_id, None, Some(req.cursor.filter()))
            .await?
        {
            req.cursor = req.cursor.map_filter(|ast| resolved.apply(ast));
        }
        validate_filter(Some(req.cursor.filter()), SoupType::Expanded, false)?;
        if matches!(req.cursor, Query::Cursor(_)) && req.grouping.group_key.is_none() {
            return Err(invalid("grouped continuation requires a group key"));
        }
        let user = req.user_id.clone();
        let rows = self
            .soup_storage
            .due_date_group_page(req)
            .await
            .map_err(anyhow::Error::from)?;
        let entities: Vec<_> = rows
            .iter()
            .map(|row| EntityType::Document.with_entity_string(row.id.to_string()))
            .collect();
        let items = self
            .soup_storage
            .expanded_soup_by_ids(AdvancedSortParams {
                entities: &entities,
                user_id: user.clone(),
            })
            .await
            .map_err(anyhow::Error::from)?;
        let items = self
            .soup_storage
            .populate_properties(user, items)
            .await
            .map_err(anyhow::Error::from)?;
        let by_id: HashMap<Uuid, _> = items.into_iter().map(|item| (item.id(), item)).collect();
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                by_id.get(&row.id).map(|item| DueDateGroupedItem {
                    grouping: ItemGroupingInfo {
                        key: row.key,
                        total_group_count: row.total_group_count,
                        index_in_group: row.index_in_group,
                        item: item.clone(),
                    },
                    due_at: row.due_at,
                })
            })
            .collect())
    }
}

#[cfg(test)]
mod test;
