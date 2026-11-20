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
    Delivery, Engine, EngineError, RunSpec, container_name, network_name, provider_volume_name,
    volume_name,
};
use super::store::Lifecycle;

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
struct Clock {
    wall: DateTime<Utc>,
    instant: tokio::time::Instant,
}

impl Clock {
    fn new() -> Self {
        Self {
            wall: Utc::now(),
            instant: tokio::time::Instant::now(),
        }
    }

    fn now(&self) -> DateTime<Utc> {
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
            let mut update =
                ImageUpdate::new(lifecycle.settled_image.clone(), supervision.image.clone());
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

    let mut attempt = 0;
    let mut announce_restart = supervision.resume && exited_before && !adopted;
    let mut first_start = true;
    loop {
        match action {
            Action::Start { after, .. } => {
                if announce_restart {
                    attempt += 1;
                    report(TeammateRunState::Restarting { attempt });
                }
                tokio::time::sleep(after).await;
                report(TeammateRunState::Starting);
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
                    Ok(previous_exit) => {
                        span.record("previous_exit", tracing::field::display(previous_exit));
                    }
                    Err(error) => {
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
            Action::Adopt => {}
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

        let exit = wait(engine, &name, &mut lifecycle, &clock, &keep).await;
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
    lifecycle: &mut Lifecycle,
    clock: &Clock,
    keep: &impl Fn(&Lifecycle),
) -> Result<i64, EngineError> {
    let mut exit = pin!(engine.wait(name));
    loop {
        let Some(trial_ends) = lifecycle.update.as_ref().and_then(ImageUpdate::trial_ends) else {
            return exit.await;
        };
        let remaining = (trial_ends - clock.now()).to_std().unwrap_or_default();
        tokio::select! {
            code = &mut exit => return code,
            () = tokio::time::sleep(remaining) => {
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
        image_id = image.image_id.as_str(),
        previous_image_id = abandoned.image_id.as_str(),
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

/// Stop the old container (an older delivery's agent gets [`STOP_GRACE`]
/// for its last sync, its checkpoint, which the next boot sees as a clean
/// stop) and remove it, make sure the install's network and volumes exist,
/// and run `image`. Returns the exit passed to the boot.
async fn start<EngineImpl: Engine>(
    engine: &EngineImpl,
    supervision: &Supervision,
    image: &TeammateImage,
    lifecycle: &mut Lifecycle,
    clock: &Clock,
) -> Result<PreviousExit, EngineError> {
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
        })
        .await?;
    Ok(previous_exit)
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
