//! One install's container, from fetching its image to its last exit. The
//! decisions are `teammate_lifecycle`'s: its restart policy after each exit
//! (one exit table for every backend) and its image update (try a new image
//! for 120 s, else go back to the previous one). This module carries them
//! out on the engine and keeps their state in the install store, so a
//! restarted macrod goes on where the last one stopped.

use std::path::PathBuf;
use std::pin::pin;
use std::time::Duration;

use agent_runtime_protocol::domain::schema::v0::{
    TeammateImage, TeammateInstall, TeammateRunFailure, TeammateRunState,
};
use chrono::{DateTime, Utc};
use teammate_lifecycle::exit::PreviousExit;
use teammate_lifecycle::replacement::{
    CHECKPOINT_GRACE, Fetch, ImageUpdate, UpdateAction, UpdateFailure, UpdateStatus,
};
use teammate_lifecycle::supervisor::{Action, ExitEvent, Phase, Terminal};
use tracing::Instrument as _;

use super::engine::{
    Delivery, Engine, EngineError, RunSpec, container_name, holder_name, network_name,
    provider_volume_name, volume_name,
};
use super::isolation::{self, Isolation, IsolationError};
use super::store::Lifecycle;

/// Starts in a row refused for the agent's network (its egress policy not
/// in place, or no route out) before the agent is parked: reported
/// `failed` with the reason, and still tried, [`PARKED_BACKOFF`] doubling
/// up to [`PARKED_MAX_BACKOFF`] apart, since both can pass (an engine
/// restarting, a VPN reconnecting). Each of the first starts waits the
/// policy's backoff.
pub const ISOLATION_ATTEMPTS: u8 = 5;

/// The first wait between tries of a parked agent.
pub const PARKED_BACKOFF: Duration = Duration::from_secs(60);

/// The longest wait between tries of a parked agent.
pub const PARKED_MAX_BACKOFF: Duration = Duration::from_secs(10 * 60);

/// How long an agent whose network is gone (its holder ended, or its
/// policy didn't check out) has to stop: it can't sync anyway.
const HOLDER_LOST_GRACE: Duration = Duration::from_secs(10);

/// How long a stopping agent has for its last sync (`docker stop -t 90`)
/// before it is killed.
pub const STOP_GRACE: Duration = CHECKPOINT_GRACE;

/// What one supervision runs.
#[derive(Debug, Clone)]
pub struct Supervision {
    /// The install and generation.
    pub install: TeammateInstall,
    /// Its image.
    pub image: TeammateImage,
    /// Its credentials file on the host.
    pub credentials_file: PathBuf,
    /// The teammate seccomp profile on the host.
    pub seccomp_profile: PathBuf,
    /// A local stack's network the holder also joins (development).
    pub network: Option<super::engine::TeammateNetwork>,
    /// The egress policy's explicit exceptions.
    pub allow: Vec<super::egress::Allow>,
    /// On a local stack, the services the agent was given (host, port).
    pub services: Vec<(String, u16)>,
    /// Whether macrod restarted and resumes this kept delivery (adopting
    /// its container if it still runs), rather than starting a new one.
    pub resume: bool,
    /// What the last supervisor of this install kept.
    pub lifecycle: Lifecycle,
    /// The trace of the request that asked for this delivery (none for a
    /// resumed install): the first fetch and start join it, later restarts
    /// link to it. A context, not the span, so the request's span closes.
    pub trace: Option<opentelemetry::Context>,
}

/// Wall-clock time that follows tokio's clock from when it was made, so the
/// policy's timestamps and the waits agree (and paused tests stay exact).
pub(crate) struct Clock {
    wall: DateTime<Utc>,
    instant: tokio::time::Instant,
}

impl Clock {
    pub(crate) fn new() -> Self {
        Self {
            wall: Utc::now(),
            instant: tokio::time::Instant::now(),
        }
    }

    pub(crate) fn now(&self) -> DateTime<Utc> {
        let elapsed = chrono::TimeDelta::from_std(self.instant.elapsed()).unwrap_or_default();
        self.wall + elapsed
    }
}

/// The image a start runs, and what the status says while it runs.
struct Running {
    image: TeammateImage,
    rolled_back: Option<TeammateRunFailure>,
}

/// Run the install's container until the policy gives up or the agent
/// stops as asked, reporting each state change and keeping the lifecycle
/// after each step. Returns the last state reported.
pub async fn supervise<EngineImpl: Engine>(
    engine: &EngineImpl,
    supervision: Supervision,
    keep: impl Fn(&Lifecycle),
    report: impl Fn(TeammateRunState),
) -> TeammateRunState {
    let clock = Clock::new();
    let install = &supervision.install;
    let name = container_name(&install.install_id);
    let mut lifecycle = supervision.lifecycle.clone();

    // Where to begin: adopt the running container, go on from the kept
    // state, or start the new delivery.
    let delivery = Delivery::of(install);
    let kept_update = lifecycle.update.as_ref().filter(|_| supervision.resume);
    let expected_image = kept_update.map_or(&supervision.image, ImageUpdate::running);
    let found = if supervision.resume {
        found_container(engine, &name, delivery, expected_image).await
    } else {
        Found::Nothing
    };
    let exited_before = matches!(
        lifecycle.policy.phase(),
        Phase::Running { .. } | Phase::Waiting { .. }
    ) && found == Found::Nothing;
    let adopted = found == Found::Adoptable;
    let mut action = match found {
        Found::Adoptable => lifecycle.policy.resume(true, clock.now()),
        Found::Nothing if supervision.resume => lifecycle.policy.resume(false, clock.now()),
        // A new delivery, or one whose container still runs another image
        // (macrod restarted in the middle of its update): carry it out.
        Found::Nothing | Found::OtherImage => lifecycle.policy.redelivered(clock.now()),
    };
    keep(&lifecycle);

    let kept_update = lifecycle.update.as_ref().filter(|_| supervision.resume);
    let mut running = match kept_update {
        Some(update) => Running {
            image: update.running().clone(),
            rolled_back: update.rolled_back().map(failure_of),
        },
        None if adopted => Running {
            image: supervision.image.clone(),
            rolled_back: None,
        },
        None => {
            report(TeammateRunState::Downloading);
            let span = tracing::info_span!(
                parent: None,
                "teammate.pull",
                install_id = install.install_id.as_str(),
                generation = install.generation,
                delivery = install.delivery,
                image_id = supervision.image.image_id.as_str(),
                outcome = tracing::field::Empty,
            );
            join(&span, supervision.trace.as_ref(), true);
            let fetch = match fetch_image(engine, &supervision.image)
                .instrument(span.clone())
                .await
            {
                Ok(()) => Fetch::Verified,
                Err(TeammateRunFailure::ImageMismatch) => Fetch::Mismatch,
                Err(_) => Fetch::Unavailable,
            };
            span.record("outcome", tracing::field::debug(fetch));
            // The fallback is the image the container being replaced runs
            // (it may not have finished its own trial yet), else the last
            // settled one.
            let fallback = running_image(engine, &name, &supervision.image)
                .await
                .or_else(|| lifecycle.settled_image.clone());
            let mut update = ImageUpdate::new(fallback, supervision.image.clone());
            let next = match update.fetched(fetch) {
                UpdateAction::Run { image, status } => Running {
                    image,
                    rolled_back: rolled_back_of(status),
                },
                UpdateAction::Fail(reason) => return failed(&report, failure_of(reason)),
                UpdateAction::Continue => Running {
                    image: supervision.image.clone(),
                    rolled_back: None,
                },
            };
            if let Some(reason) = next.rolled_back {
                record_rollback(install, &supervision.image, &next.image, reason);
            }
            lifecycle.update = Some(update);
            keep(&lifecycle);
            next
        }
    };

    let mut holder: Option<String>;
    let mut isolation_failures: u8 = 0;
    // The failure reported for a parked agent: tried again quietly.
    let mut parked: Option<TeammateRunFailure> = None;
    let mut attempt = 0;
    let mut announce_restart = supervision.resume && exited_before && !adopted;
    let mut first_start = true;
    loop {
        match action {
            Action::Start { after, .. } => {
                if announce_restart && parked.is_none() {
                    attempt += 1;
                    report(TeammateRunState::Restarting { attempt });
                }
                tokio::time::sleep(after).await;
                if parked.is_none() {
                    report(TeammateRunState::Starting);
                }
                // The first start joins the request's trace; a restart is
                // its own trace, linked to it.
                let span = tracing::info_span!(
                    parent: None,
                    "teammate.start",
                    install_id = install.install_id.as_str(),
                    generation = install.generation,
                    delivery = install.delivery,
                    image_id = running.image.image_id.as_str(),
                    attempt,
                    rolled_back = ?running.rolled_back,
                    previous_exit = tracing::field::Empty,
                );
                join(&span, supervision.trace.as_ref(), first_start);
                first_start = false;
                let started = start(engine, &supervision, &running.image, &mut lifecycle, &clock)
                    .instrument(span.clone())
                    .await;
                keep(&lifecycle);
                match started {
                    Ok((previous_exit, started_holder)) => {
                        isolation_failures = 0;
                        parked = None;
                        span.record("previous_exit", tracing::field::display(previous_exit));
                        holder = Some(started_holder);
                    }
                    Err(StartError::Network { failure, reason }) => {
                        // Never an open fallback: the agent doesn't start.
                        // Tried again with the policy's backoff a few
                        // times, then parked: failed, and tried again
                        // further apart for as long as it is kept.
                        isolation_failures = isolation_failures.saturating_add(1);
                        tracing::warn!(install_id = install.install_id.as_str(), generation = install.generation, failure = ?failure, reason = %reason, attempt = isolation_failures, "the teammate's network is not usable");
                        let lost = ExitEvent {
                            code: None,
                            requested: false,
                        };
                        action = lifecycle.policy.exited(lost, clock.now());
                        keep(&lifecycle);
                        announce_restart = true;
                        if isolation_failures >= ISOLATION_ATTEMPTS {
                            if parked != Some(failure) {
                                report(TeammateRunState::Failed { reason: failure });
                                parked = Some(failure);
                            }
                            if let Action::Start { previous, .. } = action {
                                action = Action::Start {
                                    after: parked_backoff(isolation_failures),
                                    previous,
                                };
                            }
                        }
                        continue;
                    }
                    Err(StartError::Engine(error)) => {
                        // Usually passing (an engine restarting, its socket
                        // gone, a full disk): backed off like a crash.
                        tracing::warn!(install_id = install.install_id.as_str(), generation = install.generation, error = %error, "the engine refused the teammate container");
                        let lost = ExitEvent {
                            code: None,
                            requested: false,
                        };
                        action = lifecycle.policy.exited(lost, clock.now());
                        keep(&lifecycle);
                        announce_restart = true;
                        continue;
                    }
                }
            }
            Action::Adopt => {
                // Adopted only with its policy still in place, as now
                // rendered; else stopped and rebuilt like a crash.
                match adopted_holder(engine, &supervision).await {
                    Ok(adopted) => holder = Some(adopted),
                    Err(reason) => {
                        tracing::warn!(install_id = install.install_id.as_str(), reason = %reason, "the adopted teammate's egress policy is not in place; restarting it");
                        let _ = engine.stop(&name, HOLDER_LOST_GRACE).await;
                        let lost = ExitEvent {
                            code: None,
                            requested: false,
                        };
                        action = lifecycle.policy.exited(lost, clock.now());
                        keep(&lifecycle);
                        announce_restart = true;
                        continue;
                    }
                }
            }
            Action::Failed(terminal) => return failed(&report, terminal_failure(terminal)),
            Action::Stopped | Action::Nothing => {
                report(TeammateRunState::Stopped);
                return TeammateRunState::Stopped;
            }
        }
        report(match running.rolled_back {
            Some(reason) => TeammateRunState::RolledBack { reason },
            None => TeammateRunState::Running,
        });

        let exit = wait(
            engine,
            &name,
            holder.as_deref(),
            &mut lifecycle,
            &clock,
            &keep,
        )
        .await;
        if replaced(engine, &name, delivery).await {
            // Another delivery's container took the name: its exits are
            // its own supervisor's.
            return TeammateRunState::Stopped;
        }
        let event = ExitEvent {
            code: exit.as_ref().ok().and_then(|code| u8::try_from(*code).ok()),
            requested: false,
        };
        let now = clock.now();
        if let Some(update) = lifecycle.update.as_mut()
            && let UpdateAction::Run { image, status } = update.exited(event, now)
        {
            let rolled_back = rolled_back_of(status);
            if let Some(reason) = rolled_back {
                record_rollback(install, &running.image, &image, reason);
            }
            running = Running { image, rolled_back };
        }
        action = lifecycle.policy.exited(event, now);
        keep(&lifecycle);
        tracing::info!(install_id = install.install_id.as_str(), generation = install.generation, delivery = install.delivery, exit = ?exit, action = ?action, "the teammate container exited");
        announce_restart = true;
    }
}

/// Wait for the container's exit. A new image that stays up its trial
/// settles meanwhile: it becomes the image to go back to.
async fn wait<EngineImpl: Engine>(
    engine: &EngineImpl,
    name: &str,
    holder: Option<&str>,
    lifecycle: &mut Lifecycle,
    clock: &Clock,
    keep: &impl Fn(&Lifecycle),
) -> Result<i64, EngineError> {
    let mut exit = pin!(engine.wait(name));
    // The holder ending takes the agent's network with it: the agent is
    // stopped and counted as crashed, and its next start rebuilds both.
    let holder_exit = async {
        match holder {
            Some(holder) => {
                let _ = engine.wait(holder).await;
            }
            None => std::future::pending().await,
        }
    };
    let mut holder_exit = pin!(holder_exit);
    loop {
        let trial_ends = lifecycle.update.as_ref().and_then(ImageUpdate::trial_ends);
        let remaining = trial_ends.map(|ends| (ends - clock.now()).to_std().unwrap_or_default());
        tokio::select! {
            code = &mut exit => return code,
            () = &mut holder_exit => {
                tracing::warn!(container = name, "the teammate's holder exited; stopping the teammate");
                let _ = engine.stop(name, HOLDER_LOST_GRACE).await;
                return Err(EngineError("the holder of the teammate's network exited".to_owned()));
            }
            () = tokio::time::sleep(remaining.unwrap_or_default()), if remaining.is_some() => {
                let now = clock.now();
                let settled = lifecycle
                    .update
                    .as_mut()
                    .and_then(|update| update.settle(now).then(|| update.running().clone()));
                if let Some(image) = settled {
                    tracing::info!(image_id = image.image_id.as_str(), "the teammate image settled");
                    lifecycle.settled_image = Some(image);
                    keep(lifecycle);
                }
            }
        }
    }
}

/// The wait before the next try of an agent parked after `failures` starts
/// in a row: [`PARKED_BACKOFF`] doubling, at most [`PARKED_MAX_BACKOFF`].
fn parked_backoff(failures: u8) -> Duration {
    let doublings = u32::from(failures.saturating_sub(ISOLATION_ATTEMPTS)).min(16);
    PARKED_BACKOFF
        .saturating_mul(1 << doublings)
        .min(PARKED_MAX_BACKOFF)
}

/// The adopted agent's holder, with its policy read back and checked.
async fn adopted_holder<EngineImpl: Engine>(
    engine: &EngineImpl,
    supervision: &Supervision,
) -> Result<String, String> {
    // Not gated on the host's routes: a running agent whose policy reads
    // back intact keeps running while the host is offline (a resume with
    // Wi-Fi down); only a new start needs a route out.
    let install_id = &supervision.install.install_id;
    let state = engine
        .container(&holder_name(install_id))
        .await
        .map_err(|error| error.to_string())?;
    let Some(holder_id) = state
        .filter(|state| state.running)
        .and_then(|state| state.id)
    else {
        return Err("it has no running holder (it predates enforced egress)".to_owned());
    };
    isolation::check(
        engine,
        &holder_id,
        &isolation_of(supervision, &supervision.image.image_id),
    )
    .await
    .map_err(|error| error.to_string())?;
    Ok(holder_id)
}

fn isolation_of<'supervision>(
    supervision: &'supervision Supervision,
    image_id: &str,
) -> Isolation<'supervision> {
    let install_id = &supervision.install.install_id;
    let mut networks = vec![network_name(install_id)];
    networks.extend(
        supervision
            .network
            .iter()
            .map(|network| network.as_str().to_owned()),
    );
    Isolation {
        install_id: install_id.clone(),
        image_id: image_id.to_owned(),
        networks,
        allow: &supervision.allow,
        services: &supervision.services,
    }
}

/// `teammate.rollback`: the update went back from `abandoned` to `image`.
/// Its own trace: a rollback can come long after the request.
fn record_rollback(
    install: &TeammateInstall,
    abandoned: &TeammateImage,
    image: &TeammateImage,
    reason: TeammateRunFailure,
) {
    let span = tracing::info_span!(
        parent: None,
        "teammate.rollback",
        install_id = install.install_id.as_str(),
        generation = install.generation,
        delivery = install.delivery,
        reason = ?reason,
        // The image that failed, and the one running again in its place.
        image_id = abandoned.image_id.as_str(),
        previous_image_id = image.image_id.as_str(),
    );
    span.in_scope(|| {
        tracing::warn!(reason = ?reason, "the teammate went back to its previous image");
    });
}

fn failed(report: &impl Fn(TeammateRunState), reason: TeammateRunFailure) -> TeammateRunState {
    let state = TeammateRunState::Failed { reason };
    report(state.clone());
    state
}

/// The status of a policy that gave up.
pub fn terminal_failure(terminal: Terminal) -> TeammateRunFailure {
    match terminal {
        Terminal::IncompatibleRuntime => TeammateRunFailure::IncompatibleRuntime,
        Terminal::BadConfiguration => TeammateRunFailure::BadConfiguration,
    }
}

fn failure_of(reason: UpdateFailure) -> TeammateRunFailure {
    match reason {
        UpdateFailure::ImageUnavailable => TeammateRunFailure::ImageUnavailable,
        UpdateFailure::ImageMismatch => TeammateRunFailure::ImageMismatch,
        UpdateFailure::CrashLoop => TeammateRunFailure::CrashLoop,
    }
}

fn rolled_back_of(status: UpdateStatus) -> Option<TeammateRunFailure> {
    match status {
        UpdateStatus::Trying => None,
        UpdateStatus::RolledBack(reason) => Some(failure_of(reason)),
    }
}

/// Parent `span` on the request's trace, or only link it there.
fn join(span: &tracing::Span, trace: Option<&opentelemetry::Context>, parent: bool) {
    use opentelemetry::trace::TraceContextExt as _;
    use tracing_opentelemetry::OpenTelemetrySpanExt as _;

    let Some(trace) = trace else {
        return;
    };
    if parent {
        let _ = span.set_parent(trace.clone());
    } else {
        span.add_link(trace.span().span_context().clone());
    }
}

/// Whether the container under the install's name now carries another
/// delivery's labels.
async fn replaced<EngineImpl: Engine>(engine: &EngineImpl, name: &str, delivery: Delivery) -> bool {
    matches!(
        engine.container(name).await,
        Ok(Some(state)) if state.delivery.is_some_and(|labelled| labelled != delivery)
    )
}

/// The image the install's running container runs, as the engine reports
/// it (of `like`'s repository: only its id is used to run it again).
async fn running_image<EngineImpl: Engine>(
    engine: &EngineImpl,
    name: &str,
    like: &TeammateImage,
) -> Option<TeammateImage> {
    let state = engine.container(name).await.ok()??;
    let image_id = state.image_id.filter(|_| state.running)?;
    Some(TeammateImage {
        repository: like.repository.clone(),
        image_id,
    })
}

/// What a restarted macrod finds under the install's name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Found {
    /// This delivery's container runs the expected image: adopt it.
    Adoptable,
    /// This delivery's container runs another image: the update it was in
    /// the middle of goes on (the image the engine reports, never assumed).
    OtherImage,
    /// Nothing of this delivery runs.
    Nothing,
}

async fn found_container<EngineImpl: Engine>(
    engine: &EngineImpl,
    name: &str,
    delivery: Delivery,
    expected: &TeammateImage,
) -> Found {
    match engine.container(name).await {
        Ok(Some(state)) if state.running && state.delivery == Some(delivery) => {
            if state.image_id.as_deref() == Some(expected.image_id.as_str()) {
                Found::Adoptable
            } else {
                tracing::info!(running_image_id = ?state.image_id, image_id = expected.image_id.as_str(), "the teammate container runs another image");
                Found::OtherImage
            }
        }
        Ok(_) => Found::Nothing,
        Err(error) => {
            tracing::warn!(error = %error, "could not inspect the teammate container");
            Found::Nothing
        }
    }
}

/// Have the image locally with exactly the asked id: the local copy when
/// there is one, else fetched from `<repository>:<id hex>`. An image whose
/// id differs is refused, so the tag is only where to look.
async fn fetch_image<EngineImpl: Engine>(
    engine: &EngineImpl,
    image: &TeammateImage,
) -> Result<(), TeammateRunFailure> {
    let Some(hex) = image_id_hex(&image.image_id) else {
        return Err(TeammateRunFailure::ImageUnavailable);
    };
    if !valid_repository(&image.repository) {
        return Err(TeammateRunFailure::ImageUnavailable);
    }
    if let Ok(Some(local)) = engine.image_id(&image.image_id).await
        && local == image.image_id
    {
        return Ok(());
    }

    let reference = format!("{}:{hex}", image.repository);
    if let Err(error) = engine.pull(&reference).await {
        tracing::warn!(error = %error, "could not fetch the teammate image");
        return Err(TeammateRunFailure::ImageUnavailable);
    }
    match engine.image_id(&reference).await {
        Ok(Some(fetched)) if fetched == image.image_id => Ok(()),
        Ok(_) => Err(TeammateRunFailure::ImageMismatch),
        Err(error) => {
            tracing::warn!(error = %error, "could not inspect the fetched teammate image");
            Err(TeammateRunFailure::ImageUnavailable)
        }
    }
}

/// Why a start didn't happen.
#[derive(Debug)]
enum StartError {
    /// The engine failed a step: backed off like a crash.
    Engine(EngineError),
    /// The agent's network isn't usable: its egress policy couldn't be put
    /// in place (never started open), or the host has no route out.
    Network {
        /// `networkIsolationUnavailable` or `egressBlocked`.
        failure: TeammateRunFailure,
        /// What said so.
        reason: String,
    },
}

/// Why a host with no default route can't run an agent.
const NO_WAY_OUT: &str =
    "the host has no route to the internet: every destination the policy leaves is unreachable";

impl std::fmt::Display for StartError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Engine(error) => write!(formatter, "{error}"),
            Self::Network { reason, .. } => formatter.write_str(reason),
        }
    }
}

impl From<EngineError> for StartError {
    fn from(error: EngineError) -> Self {
        Self::Engine(error)
    }
}

/// Stop the old container (an older delivery's agent gets [`STOP_GRACE`]
/// for its last sync, its checkpoint, which the next boot sees as a clean
/// stop) and remove it, make sure the install's network and volumes exist,
/// put the egress policy in place (a fresh holder, the guard, the
/// readback), and only then run `image` in the holder's namespace. Returns
/// the exit passed to the boot and the holder's id.
async fn start<EngineImpl: Engine>(
    engine: &EngineImpl,
    supervision: &Supervision,
    image: &TeammateImage,
    lifecycle: &mut Lifecycle,
    clock: &Clock,
) -> Result<(PreviousExit, String), StartError> {
    let install_id = &supervision.install.install_id;
    let name = container_name(install_id);
    if let Some(state) = engine.container(&name).await?
        && state.running
    {
        let span = tracing::info_span!("teammate.checkpoint", install_id = install_id.as_str());
        engine.stop(&name, STOP_GRACE).instrument(span).await?;
        let stop = ExitEvent {
            code: None,
            requested: true,
        };
        lifecycle.policy.exited(stop, clock.now());
    }
    engine.remove_container(&name).await?;
    engine.create_network(&network_name(install_id)).await?;
    engine.create_volume(&volume_name(install_id)).await?;
    engine
        .create_volume(&provider_volume_name(install_id))
        .await?;

    // No route out: the agent would run and reach nothing, Macro included.
    let host = isolation::host_network(engine)
        .await
        .map_err(|error| StartError::Network {
            failure: TeammateRunFailure::NetworkIsolationUnavailable,
            reason: error.to_string(),
        })?;
    if !host.to_the_internet {
        return Err(StartError::Network {
            failure: TeammateRunFailure::EgressBlocked,
            reason: NO_WAY_OUT.to_owned(),
        });
    }

    let span = tracing::info_span!(
        "teammate.isolate",
        install_id = install_id.as_str(),
        generation = supervision.install.generation,
        outcome = tracing::field::Empty,
    );
    let isolated = isolation::isolate(engine, &isolation_of(supervision, &image.image_id))
        .instrument(span.clone())
        .await;
    span.record(
        "outcome",
        if isolated.is_ok() {
            "enforced"
        } else {
            "refused"
        },
    );
    let holder_id = match isolated {
        Ok(holder_id) => holder_id,
        Err(IsolationError::Engine(error)) => return Err(StartError::Engine(error)),
        Err(error @ IsolationError::Unavailable { .. }) => {
            return Err(StartError::Network {
                failure: TeammateRunFailure::NetworkIsolationUnavailable,
                reason: error.to_string(),
            });
        }
    };

    let previous_exit = lifecycle.policy.started(clock.now());
    if let Some(update) = lifecycle.update.as_mut() {
        update.started(clock.now());
    }
    engine
        .run(&RunSpec {
            install_id: install_id.clone(),
            delivery: Delivery::of(&supervision.install),
            image_id: image.image_id.clone(),
            credentials_file: supervision.credentials_file.clone(),
            seccomp_profile: supervision.seccomp_profile.clone(),
            previous_exit,
            holder_id: holder_id.clone(),
        })
        .await?;
    Ok((previous_exit, holder_id))
}

/// The 64 hex digits of `sha256:<hex>`, `None` for anything else.
pub fn image_id_hex(image_id: &str) -> Option<&str> {
    let hex = image_id.strip_prefix("sha256:")?;
    let valid = hex.len() == 64
        && hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    valid.then_some(hex)
}

/// A registry repository the engine can't read as a flag or a tag:
/// lowercase letters, digits and `.`, `_`, `-`, `/`, `:` (a registry port),
/// starting with a letter or digit.
fn valid_repository(repository: &str) -> bool {
    let starts_well = repository
        .bytes()
        .next()
        .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit());
    starts_well
        && repository.len() <= 255
        && repository.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-/:".contains(&byte)
        })
}
