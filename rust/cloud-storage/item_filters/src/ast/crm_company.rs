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
}

impl ExpandFrame<CrmCompanyLiteral> for CrmCompanyFilters {
    type Err = ExpandErr;

    fn expand_ast(input: Self) -> Result<Option<Expr<CrmCompanyLiteral>>, Self::Err> {
        let CrmCompanyFilters { company_ids } = input;

        Ok(company_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(CrmCompanyLiteral::Id), Expr::or)?)
    }
}
