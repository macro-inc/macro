#![recursion_limit = "256"]
mod config;
mod health;
use std::sync::Arc;

use anyhow::Context;
use config::{Config, Environment};
use contacts::domain::service::{ContactsDomainService, ContactsOutboxServiceImpl};
use contacts::inbound::http::{ApiDoc, AppState};
use contacts::inbound::worker::{ContactsWorker, OutboxWorker};
use contacts::outbound::gateway::ConnectionGatewayNotifier;
use contacts::outbound::repository::DbContactsRepository;
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use rate_limit::{RateLimitServiceImpl, RedisRateLimitAdapter};
use secretsmanager_client::SecretManager;
use sqlx::postgres::PgPoolOptions;
use sqs_worker::SQSWorker;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

async fn connect_to_database(config: &Config) -> anyhow::Result<sqlx::PgPool> {
    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (5, 30),
        Environment::Develop => (1, 25),
        Environment::Local => (1, 10),
    };

    let database_url = &config.database_url;

    let db = PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(database_url)
        .await
        .context("could not connect to db")?;
    Ok(db)
}

async fn create_sqs_worker(config: &Config) -> SQSWorker {
    let queue_url = config.queue_url.clone();
    let aws_config = macro_aws_config::get_macro_aws_config().await;

    let sqs_client = aws_sdk_sqs::Client::new(&aws_config);
    sqs_worker::SQSWorker::new(
        sqs_client,
        queue_url,
        config.queue_max_messages,
        config.queue_wait_time_seconds,
    )
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let config = Config::from_env().context("expected to be able to generate config")?;

    let db = connect_to_database(&config).await?;
    let sqs_worker = create_sqs_worker(&config).await;

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&macro_aws_config::get_macro_aws_config().await),
    );

    let notifier = if let Some(url) = config.connection_gateway_url.as_ref() {
        let internal_api_secret = secretsmanager_client
            .get_maybe_secret_value(config.environment, InternalApiSecretKey::new()?)
            .await?;
        Some(
            ConnectionGatewayNotifier::new(internal_api_secret.as_ref().to_string(), url.clone())
                .unwrap(),
        )
    } else {
        None
    };

    let repository = DbContactsRepository::new(db.clone());
    let outbox_repo = DbContactsRepository::new(db.clone());
    let service = Arc::new(ContactsDomainService {
        repository,
        notifier,
    });

    let worker = ContactsWorker::new(sqs_worker, service.clone());
    tokio::spawn(async move {
        worker.poll().await;
    });

    let outbox_worker = OutboxWorker {
        service: ContactsOutboxServiceImpl {
            outbox_repo,
            inner_service: service.clone(),
        },
    };
    tokio::spawn(async move {
        outbox_worker.run().await;
    });

    let jwt_args = macro_auth::middleware::decode_jwt::JwtValidationArgs::new_with_secret_manager(
        config.environment,
        &secretsmanager_client,
    )
    .await?;

    let redis_client =
        redis::Client::open(config.redis_uri.as_str()).context("failed to create redis client")?;

    let rate_limit_service = RateLimitServiceImpl {
        repo: RedisRateLimitAdapter {
            redis: redis_client,
        },
    };

    let cors = macro_cors::cors_layer();
    let port = config.port;

    let app = contacts::inbound::http::api_router(AppState {
        port,
        jwt_args,
        contacts_service: service,
        rate_limit_service,
    })
    .layer(cors.clone())
    .merge(health::router().layer(cors))
    .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", ApiDoc::openapi()));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();

    tracing::info!("contacts service is up and running on port {}", &port);

    axum::serve(listener, app.into_make_service())
        .await
        .context("error starting service")?;
    Ok(())
}
