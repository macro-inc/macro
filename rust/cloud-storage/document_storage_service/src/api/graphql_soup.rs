use crate::api::context::ApiContext;
use async_graphql::{ServerError, http::GraphiQLSource};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    Router,
    extract::{FromRequest, FromRequestParts, OriginalUri, Request, State},
    response::{Html, IntoResponse, Response},
    routing::get,
};
use axum_extra::extract::Cached;
use graphql_soup::GraphqlSoupRequestParts;
use model_user::axum_extractor::OptionalMacroUserExtractor;

pub(crate) fn router() -> Router<ApiContext> {
    Router::new().route("/soup/graphql", get(graphiql).post(handler))
}

async fn graphiql(OriginalUri(uri): OriginalUri) -> Html<String> {
    Html(GraphiQLSource::build().endpoint(uri.path()).finish())
}

async fn handler(State(state): State<ApiContext>, req: Request) -> Response {
    let (mut parts, body) = req.into_parts();

    // Authentication stays eager: it gates execution for non-introspection
    // queries and primes the `Cached` entry that resolvers extract lazily.
    let auth =
        match Cached::<OptionalMacroUserExtractor>::from_request_parts(&mut parts, &state).await {
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

    let request = match <GraphQLRequest as FromRequest<()>>::from_request(synthetic, &()).await {
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

    let property_reader: std::sync::Arc<dyn graphql_soup::SoupPropertyEdgeReader> =
        state.properties_service.clone();
    let request = request
        .data(GraphqlSoupRequestParts::new(parts))
        .data(state.clone())
        .data(graphql_soup::entity_properties_loader(
            macro_user_id.clone(),
            property_reader,
        ))
        .data(graphql_soup::entity_notifications_loader(
            macro_user_id,
            state.graphql_notification_reader.clone(),
        ));

    GraphQLResponse::from(state.graphql_soup_schema.execute(request).await).into_response()
}

fn is_introspection_query(query: &str) -> bool {
    query.contains("__schema") || query.contains("__type")
}
