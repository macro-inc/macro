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
use graphql_soup::soup_item_loader;
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
    let Some(acting_user) = auth
        .authorization
        .as_ref()
        .and_then(UserOrInternalServiceAuthorization::acting_user)
    else {
        return (
            StatusCode::UNAUTHORIZED,
            "authentication required for GraphQL Soup subscriptions",
        )
            .into_response();
    };
    let macro_user_id = acting_user.macro_user_id.clone();
    let organization_id = acting_user.user_context.organization_id.map(i64::from);

    let schema = state.graphql_soup_schema.clone();
    let data = graphql_subscription_context_data(&state, macro_user_id, organization_id);
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

fn graphql_subscription_context_data(
    state: &ApiContext,
    user: MacroUserIdStr<'static>,
    organization_id: Option<i64>,
) -> Data {
    let mut data = Data::default();
    insert_graphql_context_data(&mut data, state, Some(user), organization_id);
    data
}

fn graphql_query_context_data(
    mut req: async_graphql::Request,
    state: &ApiContext,
    macro_user_id: Option<MacroUserIdStr<'static>>,
    organization_id: Option<i64>,
) -> async_graphql::Request {
    insert_graphql_context_data(&mut req.data, state, macro_user_id, organization_id);
    req
}

fn insert_graphql_context_data(
    data: &mut Data,
    state: &ApiContext,
    macro_user_id: Option<MacroUserIdStr<'static>>,
    organization_id: Option<i64>,
) {
    data.insert(state.clone());

    let Some(macro_user_id) = macro_user_id else {
        return;
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
    let soup_item_loader = soup_item_loader(
        state.soup_router_state.service(),
        state.soup_router_state.email_service(),
    );
    data.insert(macro_user_id.clone());
    data.insert(entity_mutation::EntityMutationActor {
        user_id: macro_user_id.clone(),
        organization_id,
    });
    data.insert(favorites::domain::models::FavoritesMutationActor {
        user_id: macro_user_id.clone(),
        organization_id,
    });
    data.insert(state.graphql_entity_mutation_service.clone());
    data.insert(state.favorites_mutation_service.clone());
    data.insert(state.channel_service.clone());
    data.insert(state.graphql_notification_reader.clone());
    data.insert(state.soup_router_state.email_service());
    data.insert(state.entity_access_service.clone());
    data.insert(soup_item_loader);
    data.insert(complete_graph::entity_properties_loader(
        macro_user_id.clone(),
        property_reader,
    ));
    data.insert(complete_graph::email_content_loader(
        macro_user_id.clone(),
        email_content_reader.clone(),
    ));
    data.insert(complete_graph::email_thread_metadata_loader(
        macro_user_id.clone(),
        email_content_reader,
    ));
    data.insert(complete_graph::entity_favorite_loader(
        macro_user_id.clone(),
        state.favorites_service.clone(),
    ));
    data.insert(complete_graph::entity_permission_loader(
        macro_user_id.clone(),
        organization_id,
        state.entity_access_service.clone(),
    ));
    data.insert(property_writer);
    data.insert(complete_graph::entity_notifications_loader(
        macro_user_id,
        state.graphql_notification_reader.clone(),
    ));
    // The feed resolver reads the reader directly; the edge goes through
    // the request's DataLoader.
    data.insert(state.activity_reader.clone());
    data.insert(complete_graph::entity_activity_loader(
        state.activity_reader.clone(),
    ));
}
