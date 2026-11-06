mod constants;
mod domain;
mod error;
mod generated;
mod inbound;
pub mod keepalive;
mod metrics;
mod mutex;
mod outbound;
#[cfg(feature = "openapi")]
pub mod swagger;
mod tags;
mod timeout;

use tracing_subscriber::{
    EnvFilter, fmt::time::UtcTime, layer::SubscriberExt, util::SubscriberInitExt,
};
use worker::{Context, Env, HttpRequest, Result, event};

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
            .with(worker_rs_otel::OtelLayer::new("sync-service"))
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
async fn fetch(
    req: HttpRequest,
    env: Env,
    ctx: Context,
) -> Result<axum::http::Response<axum::body::Body>> {
    use tower_service::Service;
    use tracing::Instrument;

    // WebSocket connects can't set headers, so they carry the traceparent as a
    // query parameter instead.
    let traceparent = worker_rs_otel::traceparent_from_headers(req.headers()).or_else(|| {
        req.uri().query()?.split('&').find_map(|pair| {
            let value = pair
                .strip_prefix(worker_rs_otel::TRACEPARENT)?
                .strip_prefix('=')?;
            worker_rs_otel::parse_traceparent(value)
        })
    });
    let (remote_id, remote_parent) = worker_rs_otel::remote_fields(traceparent.as_ref());
    let span = tracing::info_span!(
        "request",
        http.method = %req.method(),
        http.path = %req.uri().path(),
        trace.remote_id = %remote_id,
        trace.remote_parent = %remote_parent,
    );

    let mut router = crate::inbound::worker::outer_router(env.clone());
    worker_rs_otel::scope(
        &env,
        &ctx,
        async move {
            Ok(router
                .call(req)
                .await
                .unwrap_or_else(|e: std::convert::Infallible| match e {}))
        }
        .instrument(span),
    )
    .await
}
