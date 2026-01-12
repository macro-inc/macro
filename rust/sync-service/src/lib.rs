mod auth;
mod cf_worker;
mod constants;
mod d1;
mod durable_object;
mod error;
mod generated;
pub mod keepalive;
mod metrics;
mod mutex;
mod secrets;
#[cfg(feature = "search-service")]
mod sps;
mod state;
mod storage;
mod tags;
mod timeout;
mod websocket;

use tracing_subscriber::{
    EnvFilter, fmt::time::UtcTime, layer::SubscriberExt, util::SubscriberInitExt,
};
use worker::{Context, Env, Result, event};

pub const GIT_DESCRIBE: &str = env!("GIT_DESCRIBE");

fn inner_start() {
    let filter = EnvFilter::new("sync_service=trace,loro=warn");

    let fmt_layer = tracing_subscriber::fmt::layer()
        .json()
        .with_file(true)
        .with_target(true)
        .with_line_number(true)
        .with_level(true)
        .with_ansi(false)
        .with_timer(UtcTime::rfc_3339());

    let layered = tracing_subscriber::registry().with(filter);

    #[cfg(target_arch = "wasm32")]
    {
        use tracing_web::{MakeConsoleWriter, performance_layer};
        layered
            .with(fmt_layer.with_writer(MakeConsoleWriter))
            .with(
                performance_layer()
                    .with_details_from_fields(tracing_subscriber::fmt::format::Pretty::default()),
            )
            .init();
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        layered.with(fmt_layer).init();
    }

    tracing::info!("Starting. GIT_DESCRIBE = [{GIT_DESCRIBE}]");
}
#[event(start)]
fn start() {
    inner_start()
}

#[event(fetch)]
async fn fetch(req: worker::Request, env: Env, _ctx: Context) -> Result<worker::Response> {
    use crate::cf_worker::router;
    router(env, req).await
}
