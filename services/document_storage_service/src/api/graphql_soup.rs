use crate::api::context::{ApiContext, AuthorizationService};
use async_graphql::{
    Data, ServerError,
    http::{ALL_WEBSOCKET_PROTOCOLS, GraphiQLSource},
};
use async_graphql_axum::{GraphQLProtocol, GraphQLRequest, GraphQLResponse, GraphQLWebSocket};
use axum::{
    Router,
    extract::{FromRequest, FromRequestParts, Request, State, WebSocketUpgrade},
    http::{StatusCode, header, request::Parts},
    response::{Html, IntoResponse, Response},
    routing::get,
};
use axum_extra::extract::Cached;
use complete_graph::{GraphqlAuthorizedUser, GraphqlSoupRequestParts};
use macro_authorization::OptionalMacroAuthorizationExtractor;
use macro_user_id::user_id::MacroUserIdStr;

#[cfg(test)]
mod test;

pub(crate) fn router() -> Router<ApiContext> {
    Router::new().route("/soup/graphql", get(get_handler).post(handler))
}

async fn get_handler(State(state): State<ApiContext>, request: Request) -> Response {
    if is_websocket_upgrade(&request) {
        subscription_handler(state, request).await
    } else {
        let path = request.uri().path();
        Html(
            GraphiQLSource::build()
                .endpoint(path)
                .subscription_endpoint(path)
                .finish(),
        )
        .into_response()
    }
}

fn is_websocket_upgrade(request: &Request) -> bool {
    request
        .headers()
        .get(header::UPGRADE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
}

async fn subscription_handler(state: ApiContext, request: Request) -> Response {
    let (mut parts, _body) = request.into_parts();
    let auth =
        match Cached::<OptionalMacroAuthorizationExtractor<AuthorizationService>>::from_request_parts(
            &mut parts, &state,
        )
        .await
        {
            Ok(Cached(auth)) => auth,
            Err(error) => return error.into_response(),
        };
    let Some(macro_user_id) = auth.macro_user_id else {
        return (
            StatusCode::UNAUTHORIZED,
            "authentication required for GraphQL Soup subscriptions",
        )
            .into_response();
    };

    let protocol = match GraphQLProtocol::from_request_parts(&mut parts, &state).await {
        Ok(protocol) => protocol,
        Err(error) => return error.into_response(),
    };
    let upgrade = match WebSocketUpgrade::from_request_parts(&mut parts, &state).await {
        Ok(upgrade) => upgrade,
        Err(error) => return error.into_response(),
    };
    let schema = state.graphql_soup_schema.clone();
    let data = graphql_request_data(&state, macro_user_id, parts);

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

async fn handler(State(state): State<ApiContext>, req: Request) -> Response {
    let (mut parts, body) = req.into_parts();

    // Authentication stays eager: it gates execution for non-introspection
    // queries and primes the `Cached` entry that resolvers extract lazily.
    let auth =
        match Cached::<OptionalMacroAuthorizationExtractor<AuthorizationService>>::from_request_parts(
            &mut parts, &state,
        )
        .await
        {
            Ok(Cached(auth)) => auth,
            Err(err) => return err.into_response(),
        };

    // `GraphQLRequest` consumes a whole request, but the original parts (with
    // the middleware-populated extensions) must survive for the resolvers, so
    // parse the body from a shallow copy of method/uri/headers.
    let mut synthetic = Request::new(body);
    *synthetic.method_mut() = parts.method.clone();
    *synthetic.uri_mut() = parts.uri.clone();
    *synthetic.headers_mut() = parts.headers.clone();

    let mut request = match <GraphQLRequest as FromRequest<()>>::from_request(synthetic, &()).await
    {
        Ok(request) => request.into_inner(),
        Err(rejection) => return rejection.into_response(),
    };

    let Some(macro_user_id) = auth.macro_user_id else {
        if is_introspection_query(&request.query) {
            return GraphQLResponse::from(state.graphql_soup_schema.execute(request).await)
                .into_response();
        }
        return GraphQLResponse::from(async_graphql::Response::from_errors(vec![
            ServerError::new("authentication required for GraphQL Soup queries", None),
        ]))
        .into_response();
    };

    request.data = graphql_request_data(&state, macro_user_id, parts);
    GraphQLResponse::from(state.graphql_soup_schema.execute(request).await).into_response()
}

fn graphql_request_data(
    state: &ApiContext,
    macro_user_id: MacroUserIdStr<'static>,
    parts: Parts,
) -> Data {
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

    let mut data = Data::default();
    data.insert(GraphqlSoupRequestParts::new(parts));
    data.insert(GraphqlAuthorizedUser::new(macro_user_id.clone()));
    data.insert(state.clone());
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

fn is_introspection_query(query: &str) -> bool {
    query.contains("__schema") || query.contains("__type")
}
