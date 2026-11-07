use filter_ast::{ExpandFrame, Expr, TryExpandNode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{CrmCompanyFilters, ast::ExpandErr};

/// the literal ast types for a crm company
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum CrmCompanyLiteral {
    /// matches a single crm_company by id
    #[serde(rename = "id")]
    Id(Uuid),
    /// matches companies by `crm_companies.hidden` — `true` requires
    /// admin/owner team role (enforced upstream in soup's axum router)
    #[serde(rename = "hidden")]
    Hidden(bool),
}

impl ExpandFrame<CrmCompanyLiteral> for CrmCompanyFilters {
    type Err = ExpandErr;

    fn expand_ast(input: Self) -> Result<Option<Expr<CrmCompanyLiteral>>, Self::Err> {
        let CrmCompanyFilters {
            company_ids,
            hidden,
        } = input;

        let ids_expr = company_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(CrmCompanyLiteral::Id), Expr::or)?;

        let hidden_expr = hidden.map(|b| Expr::val(CrmCompanyLiteral::Hidden(b)));

        Ok(match (ids_expr, hidden_expr) {
            (None, None) => None,
            (Some(e), None) | (None, Some(e)) => Some(e),
            (Some(ids), Some(h)) => Some(Expr::and(ids, h)),
        })
    }
}
