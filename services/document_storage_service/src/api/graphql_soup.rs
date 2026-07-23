use crate::api::context::{ApiContext, AuthorizationService};
use async_graphql::{
    Data,
    http::{ALL_WEBSOCKET_PROTOCOLS, GraphiQLSource},
};
use async_graphql_axum::{GraphQLProtocol, GraphQLRequest, GraphQLResponse, GraphQLWebSocket};
use axum::{
    Router,
    extract::{State, WebSocketUpgrade},
    http::StatusCode,
    response::{Html, IntoResponse, Response},
    routing::get,
};
use axum_extra::extract::Cached;
use complete_graph::{GraphqlAuthorizedUser, GraphqlSoupRequestParts};
use macro_authorization::OptionalMacroAuthorizationExtractor;
use macro_user_id::user_id::MacroUserIdStr;

const GRAPHQL_PATH: &str = "/soup/graphql";
const GRAPHQL_SUBSCRIPTION_PATH: &str = "/soup/graphql/ws";

pub(crate) fn router() -> Router<ApiContext> {
    Router::new()
        .route(GRAPHQL_PATH, get(graphiql).post(graphql_handler))
        .route(GRAPHQL_SUBSCRIPTION_PATH, get(subscription_handler))
}

async fn graphiql() -> Html<String> {
    Html(
        GraphiQLSource::build()
            .endpoint(GRAPHQL_PATH)
            .subscription_endpoint(GRAPHQL_SUBSCRIPTION_PATH)
            .finish(),
    )
}

async fn graphql_handler(
    State(state): State<ApiContext>,
    Cached(auth): Cached<OptionalMacroAuthorizationExtractor<AuthorizationService>>,
    request_parts: GraphqlSoupRequestParts,
    request: GraphQLRequest,
) -> GraphQLResponse {
    let mut request = request.into_inner();
    let mut data = graphql_context_data(&state, auth.macro_user_id);
    data.insert(request_parts);
    request.data = data;
    state.graphql_soup_schema.execute(request).await.into()
}

async fn subscription_handler(
    State(state): State<ApiContext>,
    Cached(auth): Cached<OptionalMacroAuthorizationExtractor<AuthorizationService>>,
    protocol: GraphQLProtocol,
    upgrade: WebSocketUpgrade,
) -> Response {
    let Some(macro_user_id) = auth.macro_user_id else {
        return (
            StatusCode::UNAUTHORIZED,
            "authentication required for GraphQL Soup subscriptions",
        )
            .into_response();
    };

    let schema = state.graphql_soup_schema.clone();
    let data = graphql_context_data(&state, Some(macro_user_id));
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

fn graphql_context_data(
    state: &ApiContext,
    macro_user_id: Option<MacroUserIdStr<'static>>,
) -> Data {
    let mut data = Data::default();
    data.insert(state.clone());

    let Some(macro_user_id) = macro_user_id else {
        return data;
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

    data.insert(GraphqlAuthorizedUser::new(macro_user_id.clone()));
    data.insert(complete_graph::entity_properties_loader(
        macro_user_id.clone(),
        property_reader,
    ));
    data.insert(complete_graph::email_content_loader(
        macro_user_id.clone(),
        email_content_reader,
    ));
    data.insert(property_writer);
    data.insert(complete_graph::entity_notifications_loader(
        macro_user_id,
        state.graphql_notification_reader.clone(),
    ));
    data
}
