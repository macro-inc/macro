//! Translate Soup pagination into the CRM contact listing contract.

use crm::domain::{
    auth::CrmTeamReceipt,
    companies_repo::{CrmCompanyListSort, CrmCompanySoupCursor},
    contact_listing::CrmContactListQuery,
};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use item_filters::ast::EntityFilterAst;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{CursorWithValAndFilter, Query, SimpleSortMethod};

use super::{SimpleQueryInner, SoupErr, SoupQuery, SoupRequest, SoupSortDirection};

pub(crate) struct GetCrmContactsRequest {
    pub user_id: MacroUserIdStr<'static>,
    pub access: Option<CrmTeamReceipt<MemberTeamRole>>,
    pub query: CrmContactListQuery,
}

impl SoupRequest<Option<EntityFilterAst>> {
    pub(crate) fn build_crm_contact_request(
        &self,
        team_receipt: Option<&EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<Option<GetCrmContactsRequest>, SoupErr> {
        if self.properties_filter_blocks_propertyless() {
            return Ok(None);
        }
        let Some(filter) = self
            .entity_ast()
            .and_then(|ast| ast.crm_contact_filter.as_deref())
        else {
            return Ok(None);
        };
        let (sort, cursor) = match &self.cursor {
            SoupQuery::Simple(SimpleQueryInner(Query::Sort(sort, _))) => (*sort, None),
            SoupQuery::Simple(SimpleQueryInner(Query::Cursor(CursorWithValAndFilter {
                id,
                val,
                ..
            }))) => (
                val.sort_type,
                Some(CrmCompanySoupCursor {
                    last_sort_ts: val.last_val,
                    last_id: *id,
                }),
            ),
            _ => return Ok(None),
        };
        let access = team_receipt
            .cloned()
            .map(CrmTeamReceipt::from_team_receipt)
            .transpose()
            .map_err(|_| SoupErr::CrmErr)?;
        Ok(Some(GetCrmContactsRequest {
            user_id: self.user.clone(),
            access,
            query: CrmContactListQuery {
                filter: filter.clone(),
                sort: match sort {
                    SimpleSortMethod::CreatedAt => CrmCompanyListSort::CreatedAt,
                    SimpleSortMethod::UpdatedAt => CrmCompanyListSort::UpdatedAt,
                    SimpleSortMethod::ViewedAt => CrmCompanyListSort::ViewedAt,
                    SimpleSortMethod::ViewedUpdated => CrmCompanyListSort::ViewedUpdated,
                },
                cursor,
                ascending: matches!(self.sort_direction, SoupSortDirection::Asc),
                limit: self.limit.clamp(1, 500),
            },
        }))
    }
}
