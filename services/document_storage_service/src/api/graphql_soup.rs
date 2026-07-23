use crate::api::context::{ApiContext, AuthorizationService};
use async_graphql::{
    Data,
    http::{ALL_WEBSOCKET_PROTOCOLS, GraphiQLSource},
};
use async_graphql_axum::{GraphQLProtocol, GraphQLRequest, GraphQLResponse, GraphQLWebSocket};
use axum::{
    Router,
    extract::{OriginalUri, State, WebSocketUpgrade},
    http::{StatusCode, request::Parts},
    response::{Html, IntoResponse, Response},
    routing::get,
};
use axum_extra::extract::Cached;
use complete_graph::GraphqlRequestParts;
use macro_authorization::{
    OptionalMacroAuthorizationExtractor, UserOrInternalService, UserOrInternalServiceAuthorization,
};
use macro_user_id::user_id::MacroUserIdStr;

const GRAPHQL_PATH: &str = "/soup/graphql";
const GRAPHQL_SUBSCRIPTION_PATH: &str = "/soup/graphql/ws";

pub(crate) fn router() -> Router<ApiContext> {
    Router::new()
        .route(GRAPHQL_PATH, get(graphiql).post(graphql_handler))
        .route(GRAPHQL_SUBSCRIPTION_PATH, get(subscription_handler))
}

async fn graphiql(OriginalUri(uri): OriginalUri) -> Html<String> {
    Html(graphiql_source(uri.path()))
}

fn graphiql_source(endpoint: &str) -> String {
    let subscription_endpoint = format!("{endpoint}/ws");
    GraphiQLSource::build()
        .endpoint(endpoint)
        .subscription_endpoint(&subscription_endpoint)
        .finish()
}

async fn graphql_handler(
    State(state): State<ApiContext>,
    Cached(auth): Cached<
        OptionalMacroAuthorizationExtractor<AuthorizationService, UserOrInternalService>,
    >,
    request_parts: Parts,
    request: GraphQLRequest,
) -> GraphQLResponse {
    let acting_user = auth
        .authorization
        .as_ref()
        .and_then(UserOrInternalServiceAuthorization::acting_user);
    let request = graphql_query_context_data(
        request.into_inner(),
        &state,
        acting_user.map(|user| user.macro_user_id.clone()),
        acting_user.and_then(|user| user.user_context.organization_id.map(i64::from)),
    );
    state
        .graphql_soup_schema
        .execute(request.data(GraphqlRequestParts::new(request_parts)))
        .await
        .into()
}

async fn subscription_handler(
    State(state): State<ApiContext>,
    Cached(auth): Cached<
        OptionalMacroAuthorizationExtractor<AuthorizationService, UserOrInternalService>,
    >,
    protocol: GraphQLProtocol,
    upgrade: WebSocketUpgrade,
) -> Response {
    let Some(macro_user_id) = auth
        .authorization
        .as_ref()
        .and_then(UserOrInternalServiceAuthorization::acting_user)
        .map(|user| user.macro_user_id.clone())
    else {
        return (
            StatusCode::UNAUTHORIZED,
            "authentication required for GraphQL Soup subscriptions",
        )
            .into_response();
    };

    let schema = state.graphql_soup_schema.clone();
    let data = graphql_subscription_context_data(state, macro_user_id);
    upgrade
        .protocols(ALL_WEBSOCKET_PROTOCOLS)
        .on_upgrade(move |socket| async move {
            GraphQLWebSocket::new(socket, schema, protocol)
                .with_data(data)
                .serve()
                .await;
        })
        .into_response()
}

fn graphql_subscription_context_data(state: ApiContext, user: MacroUserIdStr<'static>) -> Data {
    let mut data = Data::default();
    data.insert(state);
    data.insert(user);
    data
}

fn graphql_query_context_data(
    req: async_graphql::Request,
    state: &ApiContext,
    macro_user_id: Option<MacroUserIdStr<'static>>,
    organization_id: Option<i64>,
) -> async_graphql::Request {
    let req = req.data(state.clone());

    let Some(macro_user_id) = macro_user_id else {
        return req;
    };

    let property_reader = complete_graph::PropertiesEntityPropertyReader::new(
        state.properties_service.clone(),
        state.entity_access_service.clone(),
    );
    let property_writer = complete_graph::PropertiesEntityPropertyWriter::new(
        state.properties_service.clone(),
        state.entity_access_service.clone(),
        macro_user_id.clone(),
    );
    let email_content_reader = complete_graph::EmailServiceEmailContentReader::new(
        state.soup_router_state.email_service(),
        state.entity_access_service.clone(),
    );
    let favorite_reader = state.favorites_service.clone();
    let permission_reader = state.entity_access_service.clone();
    let mutation_actor = entity_mutation::EntityMutationActor {
        user_id: macro_user_id.clone(),
        organization_id,
    };

    req.data(mutation_actor)
        .data(state.graphql_entity_mutation_service.clone())
        .data(complete_graph::entity_properties_loader(
            macro_user_id.clone(),
            property_reader,
        ))
        .data(complete_graph::email_content_loader(
            macro_user_id.clone(),
            email_content_reader,
        ))
        .data(complete_graph::entity_favorite_loader(
            macro_user_id.clone(),
            favorite_reader,
        ))
        .data(complete_graph::entity_permission_loader(
            macro_user_id.clone(),
            organization_id,
            permission_reader,
        ))
        .data(property_writer)
        .data(complete_graph::entity_notifications_loader(
            macro_user_id,
            state.graphql_notification_reader.clone(),
        ))
}
