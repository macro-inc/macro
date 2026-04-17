use std::sync::Arc;

use ai_tools::build_tool_service_context_from_env;
use anyhow::{Context, Result};
use axum::Router;
use connection_gateway_client::client::ConnectionGatewayClient;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use macro_env_var::env_var;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use scheduled_action::domain::ports::ScheduledActionDispatcher;
use scheduled_action::domain::service::ScheduledActionServiceImpl;
use scheduled_action::inbound::axum_router::{
    ScheduledActionRouterState, health, scheduled_action_router,
};
use scheduled_action::outbound::conn_gateway_live_updates::ConnGatewayLiveUpdates;
use scheduled_action::outbound::inprocess_executor::InProcessExecutor;
use scheduled_action::outbound::pg_polling_dispatcher::PgPollingDispatcher;
use scheduled_action::outbound::pg_scheduled_action_repo::PgScheduledActionRepo;
use scheduled_action::swagger::ApiDoc;
use secretsmanager_client::SecretManager;
use sqlx::postgres::PgPoolOptions;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

env_var! {
    pub struct EnvVars {
        Port,
        DatabaseUrl,
        NotificationQueue,
        ConnectionGatewayUrl,
    }
}

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> Result<()> {
    MacroEntrypoint::default().init();

    let env = EnvVars::new().context("failed to read environment")?;
    let environment = Environment::new_or_prod();

    let db = PgPoolOptions::new()
        .min_connections(3)
        .max_connections(10)
        .connect(&env.database_url)
        .await
        .context("failed to connect to macrodb")?;

    let tool_context = build_tool_service_context_from_env(db.clone())
        .await
        .context("failed to build tool service context")?;

    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let notification_ingress = Arc::new(SqsNotificationIngress {
        queue: SqsQueue::new(
            aws_sdk_sqs::Client::new(&aws_config),
            env.notification_queue.to_string(),
        ),
    });

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&macro_aws_config::get_macro_aws_config().await),
    );
    let internal_api_secret = secretsmanager_client
        .get_maybe_secret_value(environment, InternalApiSecretKey::new()?)
        .await
        .context("failed to fetch internal api secret")?;

    let conn_gateway_client = Arc::new(ConnectionGatewayClient::new(
        internal_api_secret.as_ref().to_string(),
        env.connection_gateway_url.as_ref().to_string(),
    ));
    let live_updates = Arc::new(ConnGatewayLiveUpdates::new(Arc::clone(
        &conn_gateway_client,
    )));

    let repo = Arc::new(PgScheduledActionRepo::new(db.clone()));

    // The dispatcher consumes its executor, so build a second executor for the
    // service to use when handling execute-now requests. Both executors share
    // the underlying repo/pool/tool-context via cheap Arc/PgPool clones.
    let dispatcher_executor = InProcessExecutor::new(
        Arc::clone(&repo),
        db.clone(),
        tool_context.clone(),
        Arc::clone(&notification_ingress),
        Arc::clone(&live_updates),
    );
    let service_executor = Arc::new(InProcessExecutor::new(
        Arc::clone(&repo),
        db.clone(),
        tool_context,
        notification_ingress,
        live_updates,
    ));

    let dispatcher = PgPollingDispatcher::new(Arc::clone(&repo), dispatcher_executor);
    let (dispatcher_tx, _execution_rx) = dispatcher.begin_dispatch_loop();

    let service = Arc::new(ScheduledActionServiceImpl::new(
        Arc::clone(&repo),
        service_executor,
        dispatcher_tx,
    ));

    let jwt_args = JwtValidationArgs::new_with_secret_manager(environment, &secretsmanager_client)
        .await
        .context("failed to build jwt validation args")?;

    let state = ScheduledActionRouterState { service };
    let authed_routes = scheduled_action_router::<_, ()>(state).layer(
        axum::middleware::from_fn_with_state(jwt_args, macro_middleware::auth::decode_jwt::handler),
    );

    let router = Router::new()
        .route("/health", axum::routing::get(health))
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", ApiDoc::openapi()))
        .merge(authed_routes)
        .layer(macro_cors::cors_layer());

    let addr = format!("0.0.0.0:{}", &*env.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("failed to bind {addr}"))?;

    tracing::info!("scheduled_action service listening on {addr}");

    axum::serve(listener, router.into_make_service())
        .await
        .context("server closed")?;
    unreachable!();
}
