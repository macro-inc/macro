use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use filter_ast::Expr;
use item_filters::ast::{EntityFilterAst, crm_company::CrmCompanyLiteral};

pub(crate) fn resolve_crm_team_receipt(
    crm_scope_requested: bool,
    receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
) -> async_graphql::Result<Option<EntityAccessReceipt<MemberTeamRole>>> {
    if crm_scope_requested && receipt.is_none() {
        return Err(async_graphql::Error::new(
            "CRM-scoped queries require team membership",
        ));
    }
    Ok(receipt)
}

pub(crate) fn require_crm_admin_role(
    admin_requested: bool,
    receipt: &Option<EntityAccessReceipt<MemberTeamRole>>,
) -> async_graphql::Result<()> {
    if !admin_requested {
        return Ok(());
    }
    let Some(receipt) = receipt else {
        return Err(async_graphql::Error::new(
            "Querying hidden CRM companies requires admin/owner team role",
        ));
    };
    if !receipt
        .entity_permission()
        .satisfies::<entity_access::domain::models::AdminTeamRole>()
    {
        return Err(async_graphql::Error::new(
            "Querying hidden CRM companies requires admin/owner team role",
        ));
    }
    Ok(())
}

pub(crate) fn requests_crm_scope(filter: &EntityFilterAst) -> bool {
    filter.email_filter.crm_scope.is_some()
}

pub(crate) fn requests_crm_admin(filter: &EntityFilterAst) -> bool {
    filter
        .crm_company_filter
        .as_deref()
        .is_some_and(ast_requests_crm_admin)
}

fn ast_requests_crm_admin(expr: &Expr<CrmCompanyLiteral>) -> bool {
    match expr {
        Expr::Literal(CrmCompanyLiteral::Hidden(_)) => true,
        Expr::And(a, b) | Expr::Or(a, b) => ast_requests_crm_admin(a) || ast_requests_crm_admin(b),
        Expr::Not(a) => ast_requests_crm_admin(a),
        _ => false,
    }
}
