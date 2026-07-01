use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Request-scoped data required to execute a Soup GraphQL query.
///
/// The embedding Axum/service layer remains responsible for authentication and
/// for resolving inbox link IDs. This keeps `graphql_soup` independent from the
/// existing REST extractors.
#[derive(Clone)]
pub struct GraphqlSoupRequestContext {
    /// Authenticated Macro user executing the request.
    pub macro_user_id: MacroUserIdStr<'static>,
    /// Link IDs available to the request.
    pub link_ids: Vec<Uuid>,
    /// Optional team access receipt used for CRM-scoped queries.
    pub team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
}
