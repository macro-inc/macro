use crate::api::context::ApiContext;
use async_graphql::{Response, ServerError, http::GraphiQLSource};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    Router,
    extract::{OriginalUri, State},
    response::Html,
    routing::get,
};
use axum_extra::extract::Cached;
use email::domain::ports::EmailService;
use entity_access::domain::{
    models::{Entity, EntityAccessReceipt, EntityPermission, EntityType, MemberTeamRole},
    ports::EntityAccessService as _,
};
use graphql_soup::GraphqlSoupRequestContext;
use model_user::axum_extractor::OptionalMacroUserExtractor;

pub(crate) fn router() -> Router<ApiContext> {
    Router::new().route("/soup/graphql", get(graphiql).post(handler))
}

async fn graphiql(OriginalUri(uri): OriginalUri) -> Html<String> {
    Html(GraphiQLSource::build().endpoint(uri.path()).finish())
}

async fn handler(
    State(state): State<ApiContext>,
    Cached(OptionalMacroUserExtractor { macro_user_id, .. }): Cached<OptionalMacroUserExtractor>,
    request: GraphQLRequest,
) -> GraphQLResponse {
    let request = request.into_inner();

    let Some(macro_user_id) = macro_user_id else {
        if is_introspection_query(&request.query) {
            return state.graphql_soup_schema.execute(request).await.into();
        }
        return Response::from_errors(vec![ServerError::new(
            "authentication required for GraphQL Soup queries",
            None,
        )])
        .into();
    };

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

    let team_receipt = match load_team_receipt(&state, &macro_user_id).await {
        Ok(team_receipt) => team_receipt,
        Err(err) => {
            return Response::from_errors(vec![ServerError::new(
                format!("failed to load caller team: {err:?}"),
                None,
            )])
            .into();
        }
    };

    let property_reader: std::sync::Arc<dyn graphql_soup::SoupPropertyEdgeReader> =
        state.properties_service.clone();
    let request = request
        .data(GraphqlSoupRequestContext {
            macro_user_id,
            link_ids,
            team_receipt,
        })
        .data(graphql_soup::entity_properties_loader(property_reader));

    state.graphql_soup_schema.execute(request).await.into()
}

fn is_introspection_query(query: &str) -> bool {
    query.contains("__schema") || query.contains("__type")
}

async fn load_team_receipt(
    state: &ApiContext,
    macro_user_id: &macro_user_id::user_id::MacroUserIdStr<'static>,
) -> async_graphql::Result<Option<EntityAccessReceipt<MemberTeamRole>>> {
    let Some(team_info) = state
        .entity_access_service
        .get_user_team(macro_user_id)
        .await
        .map_err(|err| async_graphql::Error::new(err.to_string()))?
    else {
        return Ok(None);
    };

    let permission = EntityPermission::TeamRole {
        role: team_info.role,
    };

    if !permission.satisfies::<MemberTeamRole>() {
        return Ok(None);
    }

    EntityAccessReceipt::try_new_authenticated_user(
        macro_user_id.clone(),
        Entity {
            entity_id: team_info.team_id.to_string(),
            entity_type: EntityType::Team,
        },
        permission,
    )
    .map(Some)
    .map_err(|err| async_graphql::Error::new(err.to_string()))
}
