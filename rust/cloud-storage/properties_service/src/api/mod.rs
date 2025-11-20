use crate::api::context::ApiContext;
use anyhow::Context;
use axum::Router;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

pub mod context;
mod health;
mod internal;
pub mod swagger;

pub async fn setup_and_serve(state: ApiContext) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();

    let port = state.config.port;
    let env = state.config.environment;
    let app = api_router(state)
        .layer(TraceLayer::new_for_http())
        .merge(health::router())
        .layer(cors)
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()));

    let bind_address = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&bind_address)
        .await
        .with_context(|| format!("failed to bind to address {}", bind_address))?;

    tracing::info!(
        "properties service is up and running with environment {:?} on port {}",
        &env,
        &port
    );

    axum::serve(listener, app.into_make_service())
        .await
        .context("error running axum server")
}

fn api_router(app_state: ApiContext) -> Router {
    use axum::routing::post;
    use properties_service::inbound::http::create_property_definition;

    // Replace old routes with hexagonal architecture routes (same paths, new handlers)
    let properties_routes = Router::new()
        // Property Definition Management
        .route("/definitions", post(create_property_definition));
    // TODO: Implement remaining handlers
    // .route("/definitions", get(list_property_definitions))
    // .route("/definitions/:id", get(get_property_definition))
    // .route("/definitions/:id", delete(delete_property_definition))
    // // Property Options Management
    // .route(
    //     "/definitions/:definition_id/options",
    //     get(get_property_options),
    // )
    // .route(
    //     "/definitions/:definition_id/options",
    //     post(create_property_option),
    // )
    // .route(
    //     "/definitions/:definition_id/options/:option_id",
    //     delete(delete_property_option),
    // )
    // // Entity Property Operations
    // .route(
    //     "/entities/:entity_type/:entity_id",
    //     get(get_entity_properties),
    // )
    // .route(
    //     "/entities/:entity_type/:entity_id/:property_id",
    //     put(set_entity_property),
    // )
    // .route(
    //     "/entity_properties/:entity_property_id",
    //     delete(delete_entity_property),
    // );

    Router::new()
        .nest(
            "/properties",
            properties_routes.layer(axum::middleware::from_fn_with_state(
                app_state.jwt_args.clone(),
                macro_middleware::auth::decode_jwt::handler,
            )),
        )
        .nest(
            "/internal",
            internal::router().layer(axum::middleware::from_fn_with_state(
                app_state.clone(),
                macro_middleware::auth::internal_access::handler,
            )),
        )
        .with_state(app_state)
}
