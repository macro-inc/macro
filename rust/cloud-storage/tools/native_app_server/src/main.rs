use std::sync::Arc;

use native_app_service::{
    domain::{models::PlatformData, service::NativeAppServiceImpl},
    inbound::{RouterState, native_app_router},
    outbound::DefaultBundleFetcher,
};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let service = NativeAppServiceImpl {
        bundle_fetcher: DefaultBundleFetcher::default(),
        environment: macro_env::Environment::Local,
        platform_data: PlatformData {
            ios_development_team_id: String::new(),
            ios_app_bundle_id: String::new(),
        },
    };

    let state = RouterState {
        inner: Arc::new(service),
    };

    let app = native_app_router(state);

    let addr = "0.0.0.0:3001";
    tracing::info!("Listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
