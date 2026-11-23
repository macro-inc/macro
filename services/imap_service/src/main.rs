use imap_engine::{
    domain::service::{Engine, VerificationScopeKey},
    inbound::http::{ApiState, router},
    outbound::{
        crypto::KmsCipher,
        discovery::MailDiscovery,
        network::{Connector, LocalEndpoints},
        notifications::HttpNotifier,
        postgres::PgRepository,
        protocol::ProtocolTransport,
    },
};
use macro_config::ConfigLoader;
use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use macro_env::Environment;
use std::{collections::BTreeMap, sync::Arc, time::Duration};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
mod config;
mod database;
mod scheduler;
mod shutdown;

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let telemetry = MacroEntrypoint::default().init();
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        rustls::crypto::aws_lc_rs::default_provider()
            .install_default()
            .map_err(|_| rootcause::report!("TLS provider initialization failed"))?;
    }
    // async-imap logs raw protocol commands through log::trace, including LOGIN.
    log::set_max_level(log::LevelFilter::Warn);
    let config = ConfigLoader::load::<config::Config>()?;
    if config.internal_auth_key.trim().is_empty() {
        return Err(rootcause::report!("INTERNAL_AUTH_KEY must be nonempty"));
    }
    let local =
        !config.imap_test_endpoint_map.is_empty() || !config.imap_test_trust_root_pem.is_empty();
    if local && !matches!(config.environment, Environment::Local) {
        return Err(rootcause::report!(
            "IMAP test overrides require local environment"
        ));
    }
    let addresses = if config.imap_test_endpoint_map.is_empty() {
        BTreeMap::new()
    } else {
        serde_json::from_str(&config.imap_test_endpoint_map)?
    };
    let endpoints = LocalEndpoints {
        addresses,
        trust_root_pem: if config.imap_test_trust_root_pem.is_empty() {
            None
        } else {
            Some(config.imap_test_trust_root_pem)
        },
    };
    let connector = Connector::new(endpoints)?;
    let pool = database::pool(config.database_url.as_ref())?;
    let aws = macro_aws_config::get_macro_aws_config().await;
    let notifier = HttpNotifier::new(
        macro_service_urls::EmailServiceUrl::new_for_environment(config.environment)?.to_string(),
        config.internal_auth_key.to_string(),
    )?;
    let repository = Arc::new(PgRepository::new(pool.clone()));
    let tasks = TaskTracker::new();
    let cancel = CancellationToken::new();
    let engine = Arc::new(
        Engine::new(
            VerificationScopeKey::derive(config.internal_auth_key.as_ref())?,
            repository.clone(),
            Arc::new(KmsCipher::new(
                aws_sdk_kms::Client::new(&aws),
                config.imap_credential_kms_key_id.to_string(),
            )),
            Arc::new(ProtocolTransport::new(connector).with_settings(repository.clone())),
            tasks.clone(),
            cancel.clone(),
        )
        .with_settings(repository)
        .with_notifier(Arc::new(notifier))
        .with_discovery(Arc::new(MailDiscovery::new(
            macro_service_urls::ThunderbirdAutoconfigUrl::new_for_environment(config.environment)?,
        ))),
    );
    let (first_binding, first_binding_seen) = tokio::sync::oneshot::channel();
    tasks.spawn(scheduler::configuration_notifications(
        pool,
        first_binding_seen,
        engine.clone(),
        cancel.clone(),
    ));
    let actor_tasks = tasks.clone();
    tasks.spawn(scheduler::run(
        engine.clone(),
        cancel.clone(),
        actor_tasks,
        first_binding,
    ));
    let state = ApiState {
        engine,
        internal_key: config.internal_auth_key.to_string(),
    };
    let app = router(state)
        .layer(
            macro_tower_layers::MacroRequestIdAndTracingLayer::new(Duration::from_secs(1))
                .into_inner(),
        )
        .layer(axum::extract::DefaultBodyLimit::max(40 * 1024 * 1024));
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", config.port)).await?;
    tracing::info!("imap_service is up and running");
    let stop_server = CancellationToken::new();
    let stopping = stop_server.clone();
    let server = axum::serve(listener, app).with_graceful_shutdown(stopping.cancelled_owned());
    let server = std::future::IntoFuture::into_future(server);
    tokio::pin!(server);
    let server_result = tokio::select! {
        result = &mut server => Some(result),
        _ = shutdown_signal() => None,
    };
    cancel.cancel();
    stop_server.cancel();
    tasks.close();
    let drained = shutdown::drain(
        async move {
            match server_result {
                Some(result) => result,
                None => server.await,
            }
        },
        &tasks,
    )
    .await;
    telemetry.shutdown();
    drained
}
