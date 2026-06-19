use crate::api::context::{ApiContext, EntityAccessService};
use async_graphql::{Response, ServerError};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{Router, extract::State, routing::post};
use axum_extra::extract::Cached;
use email::domain::ports::EmailService;
use entity_access::{
    domain::models::MemberTeamRole, inbound::axum_extractors::OptionalMacroUserTeamExtractor,
};
use graphql_soup::GraphqlSoupRequestContext;
use model_user::axum_extractor::MacroUserExtractor;

pub(crate) fn router() -> Router<ApiContext> {
    Router::new().route("/soup/graphql", post(handler))
}

async fn handler(
    State(state): State<ApiContext>,
    Cached(MacroUserExtractor { macro_user_id, .. }): Cached<MacroUserExtractor>,
    team: OptionalMacroUserTeamExtractor<MemberTeamRole, EntityAccessService>,
    request: GraphQLRequest,
) -> GraphQLResponse {
    let link_ids = match state
        .soup_router_state
        .email_service()
        .get_inboxes_for_macro_id(macro_user_id.clone())
        .await
    {
        Ok(links) => links.into_iter().map(|link| link.id).collect(),
        Err(err) => {
            return Response::from_errors(vec![ServerError::new(
                format!("failed to load caller inboxes: {err}"),
                None,
            )])
            .into();
        }
    };

    let request = request.into_inner().data(GraphqlSoupRequestContext {
        macro_user_id,
        link_ids,
        team_receipt: team.entity_access_receipt,
    });

    state.graphql_soup_schema.execute(request).await.into()
}
