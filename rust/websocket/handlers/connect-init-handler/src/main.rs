mod config;
mod dynamodb_connection;
mod model;
use anyhow::{Context, Ok, Result};
use aws_sdk_dynamodb::Client as DynamoDbClient;
use config::{check_env_vars, get_verbose, load_aws_config};
use dynamodb_connection::add_connection;

use lambda_http::{
    aws_lambda_events::apigw::ApiGatewayWebsocketProxyRequestContext,
    http::StatusCode,
    request::RequestContext,
    run, service_fn,
    tracing::{self, subscriber::EnvFilter, trace},
    Body, Error, Request, RequestExt, Response,
};

#[tracing::instrument(skip(dynamodb_client))]
async fn ws_handler(
    dynamodb_client: &DynamoDbClient,
    ws_context: ApiGatewayWebsocketProxyRequestContext,
) -> Result<()> {
    tracing::trace!(context = ?ws_context, "WebSocket connection request context");

    let connection_id = ws_context
        .connection_id
        .context("Failed to get connection id")?;

    let user_id_option = ws_context
        .authorizer
        .fields
        .get("authenticated_user_id")
        .and_then(|f| f.as_str());

    let email_option = ws_context
        .authorizer
        .fields
        .get("authenticated_email")
        .and_then(|f| f.as_str());

    tracing::trace!(user_id = ?user_id_option, "Authenticated user ID");
    tracing::trace!(email = ?email_option, "Authenticated email");

    add_connection(
        dynamodb_client,
        &connection_id,
        user_id_option,
        email_option,
    )
    .await?;
    tracing::trace!(connection_id=?connection_id, user_id=?user_id_option, "Added connection to dynamodb");

    Ok(())
}

async fn handler(dynamodb_client: &DynamoDbClient, event: Request) -> Result<Response<Body>> {
    let verbose = get_verbose();
    verbose.then(|| trace!(event = ?event, "Event info"));

    match event.request_context() {
        RequestContext::WebSocket(ws_context) => {
            ws_handler(dynamodb_client, ws_context).await?;
        }
        _ => {
            return Ok(Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from("Request must be a WebSocket request"))
                .expect("Failed to render response"));
        }
    }

    Ok(Response::builder()
        .status(StatusCode::OK)
        .body(Body::Empty)
        .expect("Failed to render response"))
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing::subscriber::fmt()
        .with_line_number(true)
        .json()
        .with_env_filter(EnvFilter::from_default_env())
        .with_current_span(true) // Include current span in formatted events
        .with_span_list(false) // Disable nesting all spans
        .flatten_event(true) // Flattens event fields.init();
        .init();

    tracing::trace!("Starting Lambda Handler");

    check_env_vars()?;

    tracing::trace!("Environment variables are set correctly");

    let shared_config = &load_aws_config().await;
    let shared_dynamodb_client = &DynamoDbClient::new(shared_config);

    let func =
        service_fn(
            move |event: Request| async move { handler(shared_dynamodb_client, event).await },
        );
    run(func).await
}
