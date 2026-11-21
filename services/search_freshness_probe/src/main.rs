//! Composition root of the search freshness probe: one probe per entity type,
//! all acting as the probe user through the public gateway.

use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use macro_service_urls::ApiGatewayUrl;
use search_freshness_probe::config::Config;
use search_freshness_probe::domain::model::CrowdedPrefix;
use search_freshness_probe::domain::ports::Rotation;
use search_freshness_probe::domain::probe;
use search_freshness_probe::domain::rotation::{Created, Fixture, LatePrefixWord, PropertyValue};
use search_freshness_probe::domain::watch::Schedule;
use search_freshness_probe::inbound::health;
use search_freshness_probe::outbound::entities::{Documents, Messages, Projects};
use search_freshness_probe::outbound::fixtures::{AgentSessions, Calls};
use search_freshness_probe::outbound::macro_api::MacroApi;
use search_freshness_probe::outbound::metrics::ProbeMetrics;
use search_freshness_probe::outbound::properties::Properties;
use search_freshness_probe::outbound::search::UnifiedSearch;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

/// Starts far more indexed words in every shard than a capped prefix
/// expansion keeps, in dev and in prod (services/search_freshness_probe/AGENTS.md).
const CROWDED_PREFIX: &str = "con";

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = run().await;
    entrypoint.shutdown();
    result
}

async fn run() -> Result<(), rootcause::Report> {
    let config = macro_config::ConfigLoader::load::<Config>()?;
    let gateway = ApiGatewayUrl::new()?;
    let api = MacroApi::new(&gateway, &config.probe_user_api_key)?;
    let search = UnifiedSearch::new(api.clone());

    let shutdown = CancellationToken::new();
    tokio::spawn({
        let shutdown = shutdown.clone();
        async move {
            shutdown_signal().await;
            shutdown.cancel();
        }
    });

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", config.port)).await?;
    let server_stop = CancellationToken::new();
    let server = tokio::spawn({
        let stop = server_stop.clone();
        async move {
            axum::serve(listener, health::router())
                .with_graceful_shutdown(stop.cancelled_owned())
                .await
        }
    });

    let probes = Probes {
        tracker: TaskTracker::new(),
        search: search.clone(),
        metrics: ProbeMetrics::global(),
        shutdown,
    };
    probes.start(Created::new(Documents::new(api.clone())));
    probes.start_with(
        LatePrefixWord::new(
            Documents::new(api.clone()),
            CrowdedPrefix::new(CROWDED_PREFIX)?,
        ),
        Schedule::RECALL,
    );
    probes.start(Created::new(Messages::new(api.clone())));
    probes.start(Created::new(Projects::new(api.clone())));
    probes.start(PropertyValue::new(Properties::new(api.clone())));
    probes.start(Fixture::new(AgentSessions::new(
        api.clone(),
        search.clone(),
    )));
    probes.start(Fixture::new(Calls::new(api, search)));

    probes.tracker.close();
    probes.tracker.wait().await;
    server_stop.cancel();
    match server.await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => tracing::error!(error = ?error, "the health server failed"),
        Err(error) => tracing::error!(error = ?error, "the health server task panicked"),
    }
    Ok(())
}

/// What every type's probe shares.
struct Probes {
    tracker: TaskTracker,
    search: UnifiedSearch,
    metrics: ProbeMetrics,
    shutdown: CancellationToken,
}

impl Probes {
    fn start<R: Rotation + 'static>(&self, rotation: R) {
        self.start_with(rotation, Schedule::PRODUCTION);
    }

    fn start_with<R: Rotation + 'static>(&self, rotation: R, schedule: Schedule) {
        self.tracker.spawn(probe::run(
            rotation,
            self.search.clone(),
            self.metrics.clone(),
            schedule,
            probe::PERIOD,
            self.shutdown.clone(),
        ));
    }
}
