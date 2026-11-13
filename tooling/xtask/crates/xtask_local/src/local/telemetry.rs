//! What a run records as local telemetry (on unless the developer opted out):
//! the run, every step, each service build and each container's health wait.
//! Sending, the settings file, its provisioning and the buffer are
//! `xtask_local_telemetry`'s.
//!
//! Hooked in through the supervisor's [`super::supervisor::Job`], which every
//! attached, detached and rebuild run already has, and through the [`Stage`] of
//! commands without a job (`stack up`, `stack update`, `build-services`), so the
//! flows themselves only report the bring-up's shape ([`RunTelemetry::bring_up`]).
//! Off, `begin` returns `None` and every hook is a no-op.
//!
//! Fields hold names of our own steps and services, opaque ids, counts and
//! timings: never paths, env values, error text or anything from the settings
//! file. Instance and branch names are hashed unless they are the defaults.

use std::collections::{BTreeMap, HashSet};
use std::process::Command;
use std::sync::{Arc, Mutex, PoisonError, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime};

use serde_json::Value;
use xtask_local_telemetry::{Event, Paths, Recorder, opaque_id, take_hint};

use super::instance::{DEFAULT_NAME, Instance};
use super::stage::Stage;
use super::supervisor::JobKind;
use super::{BringUp, Mode, Start, repo_root, workspace_root};

#[cfg(test)]
mod test;

/// How long closing a run waits for its build and inspection lanes (sccache,
/// Docker) before closing without them.
const LANE_WAIT: Duration = Duration::from_secs(2);
/// How long a background process waits for its last events to be sent. Nobody
/// waits on such a process, so this never delays a run.
pub(super) const DETACHED_FINISH_WAIT: Duration = Duration::from_secs(10);
/// Branch names sent as they are; any other is hashed.
const MAIN_BRANCHES: &[&str] = &["main"];
/// Steps whose captured output is a cargo build: they get a `build` event.
const BUILD_STEP: &str = "Building service binaries";
/// Waits for infra health; right after it, each container's first healthy probe
/// is still in Docker's short health log.
const INFRA_STEP: &str = "Starting infra";
/// How many probes `docker inspect` keeps in a container's health log.
const DOCKER_HEALTH_LOG_ENTRIES: usize = 5;
/// Labels that carry names, ids or lists after a fixed prefix, sent as the prefix's
/// stable step name so a step stays one series.
const STEP_NAMES: &[(&str, &str)] = &[
    ("Reloading ", "Reloading services"),
    ("Stopping ", "Stopping stack"),
    ("Building sandbox image ", "Building sandbox image"),
    ("Restoring init snapshot ", "Restoring init snapshot"),
    ("Saving init snapshot ", "Saving init snapshot"),
];

/// What a run is, for the `kind` field.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RunKind {
    Up,
    Rebuild,
    Stop,
    RestartFrontend,
    /// `just stack up`: a headless bring-up.
    StackUp,
    /// `just stack update`: adopt a new build into a running stack.
    StackUpdate,
    /// `cargo x build-services`: only the service binaries.
    BuildServices,
}

impl RunKind {
    fn as_str(self) -> &'static str {
        match self {
            RunKind::Up => "up",
            RunKind::Rebuild => "rebuild",
            RunKind::Stop => "stop",
            RunKind::RestartFrontend => "restart_frontend",
            RunKind::StackUp => "stack_up",
            RunKind::StackUpdate => "stack_update",
            RunKind::BuildServices => "build_services",
        }
    }
}

impl From<JobKind> for RunKind {
    fn from(kind: JobKind) -> Self {
        match kind {
            JobKind::Up => RunKind::Up,
            JobKind::Rebuild => RunKind::Rebuild,
        }
    }
}

/// One run's recording, shared with its background lanes. Clones share it: the
/// first `finish` closes the run, and hooks on a closed run do nothing.
#[derive(Clone)]
pub(super) struct RunTelemetry {
    shared: Arc<Shared>,
}

struct Shared {
    /// Taken by `finish`; a lane that outlives it has nowhere to record.
    recorder: Mutex<Option<Recorder>>,
    kind: RunKind,
    /// The Compose project whose containers are inspected; none for `build-services`.
    project: Option<String>,
    started_at: SystemTime,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    /// Fields every step gets once the bring-up's shape is known.
    shape: BTreeMap<String, Value>,
    steps: u32,
    /// sccache's counters when the build began, taken off the critical path.
    sccache_before: Option<JoinHandle<Option<SccacheStats>>>,
    /// Cargo output of the last build step, until its step event is recorded.
    build_output: Option<BuildOutput>,
    /// Services already reported, so the end-of-run inspection skips them.
    services: HashSet<String>,
    /// The first step that failed, for runs without a job to remember it.
    failed_step: Option<String>,
    lanes: Vec<JoinHandle<()>>,
}

impl RunTelemetry {
    /// Start recording, or `None` when opted out, when there is no token yet
    /// (a one-line hint, once), or when the settings file is unusable (reported
    /// and left off). Never waits on the network or Doppler.
    pub(super) fn begin(
        instance: Option<&Instance>,
        kind: RunKind,
        started_at: SystemTime,
        detached: bool,
    ) -> Option<Self> {
        let paths = Paths::for_user()?;
        let telemetry = Self::begin_in(&paths, instance, kind, started_at, detached);
        if telemetry.is_none()
            && let Some(hint) = take_hint(&paths)
        {
            eprintln!("{hint}");
        }
        telemetry
    }

    fn begin_in(
        paths: &Paths,
        instance: Option<&Instance>,
        kind: RunKind,
        started_at: SystemTime,
        detached: bool,
    ) -> Option<Self> {
        let common = || common_fields(instance, kind, detached);
        let recorder = match Recorder::start(paths, started_at, common) {
            Ok(recorder) => recorder?,
            Err(error) => {
                eprintln!("local telemetry is off: {error}");
                return None;
            }
        };
        Some(Self {
            shared: Arc::new(Shared {
                recorder: Mutex::new(Some(recorder)),
                kind,
                project: instance.map(|instance| instance.project_name().to_owned()),
                started_at,
                state: Mutex::new(State::default()),
            }),
        })
    }

    /// Record and send one short action, such as `stop`, that has no job.
    pub(super) fn action<T>(
        instance: &Instance,
        kind: RunKind,
        work: impl FnOnce() -> anyhow::Result<T>,
    ) -> anyhow::Result<T> {
        let telemetry = Self::begin(Some(instance), kind, SystemTime::now(), false);
        Self::finish_action(telemetry, work)
    }

    /// Record a command that has no job through its stage: every step `stage`
    /// and its children run, then one run event when [`RunTelemetry::close`] is
    /// called. A dry run records nothing.
    pub(super) fn attach(
        stage: Stage,
        instance: Option<&Instance>,
        kind: RunKind,
        started_at: SystemTime,
    ) -> (Stage, Option<Self>) {
        if stage.is_dry_run() {
            return (stage, None);
        }
        let telemetry = Self::begin(instance, kind, started_at, false);
        (stage.with_telemetry(telemetry.clone()), telemetry)
    }

    /// Close a run started with [`RunTelemetry::attach`]. The user is waiting,
    /// so it waits for nothing: what isn't sent yet goes with the next run.
    pub(super) fn close<T>(telemetry: Option<Self>, result: &anyhow::Result<T>) {
        if let Some(telemetry) = telemetry {
            let failed_step = telemetry.shared.state().failed_step.clone();
            telemetry.finish(result.is_ok(), failed_step.as_deref(), Duration::ZERO);
        }
    }

    fn finish_action<T>(
        telemetry: Option<Self>,
        work: impl FnOnce() -> anyhow::Result<T>,
    ) -> anyhow::Result<T> {
        let result = work();
        if let Some(telemetry) = telemetry {
            // The user is waiting on this command, so it waits for nothing: what
            // isn't sent before it exits goes with the next run.
            telemetry.finish(result.is_ok(), None, Duration::ZERO);
        }
        result
    }

    /// The bring-up's shape, added to every later step and to the run event.
    pub(super) fn bring_up(&self, mode: Mode, plan: &BringUp) {
        let start = match plan.start {
            Start::Fresh => "fresh",
            Start::Resume => "resume",
        };
        let mut state = self.shared.state();
        state.shape = BTreeMap::from([
            ("mode".to_owned(), Value::from(mode.label())),
            ("start".to_owned(), Value::from(start)),
            ("vite".to_owned(), Value::from(plan.vite)),
            (
                "static_frontend".to_owned(),
                Value::from(plan.static_bundle),
            ),
        ]);
    }

    pub(super) fn step_started(&self, label: &str) {
        let step = step_name(label);
        self.shared
            .with_recorder(|recorder| recorder.step_started(step));
        if step.starts_with(BUILD_STEP) {
            self.shared.state().sccache_before = Some(std::thread::spawn(sccache_stats));
        }
    }

    /// A step's captured output; only a build's is read, for its unit counts.
    pub(super) fn step_output(&self, label: &str, output: &[u8]) {
        if step_name(label).starts_with(BUILD_STEP) {
            self.shared.state().build_output = Some(BuildOutput::parse(output));
        }
    }

    pub(super) fn step_finished(&self, label: &str, elapsed: Duration, succeeded: bool) {
        let step = step_name(label);
        let outcome = outcome(succeeded);
        let shape = {
            let mut state = self.shared.state();
            state.steps += 1;
            if !succeeded && state.failed_step.is_none() {
                state.failed_step = Some(step.to_owned());
            }
            state.shape.clone()
        };
        let mut event = Event::new("step")
            .with("step", step)
            .with("seconds", seconds(elapsed))
            .with("outcome", outcome)
            .lasting(step, elapsed);
        for (key, value) in shape {
            event = event.with(&key, value);
        }
        self.shared.record(event);

        if step.starts_with(BUILD_STEP) {
            self.record_build(step, elapsed, outcome);
        }
        if step.starts_with(INFRA_STEP) && succeeded {
            self.inspect_services_later("infra");
        }
    }

    /// Close the run. The run event is buffered before this returns, so a process
    /// that exits right after still sends it later, except after a ready bring-up:
    /// its last container inspection runs first, on a lane. Sending is always in
    /// the background; a detached process waits up to `wait` for it, an attached
    /// one moves on at once.
    pub(super) fn finish(self, succeeded: bool, failed_step: Option<&str>, wait: Duration) {
        let ended = SystemTime::now();
        let mut fields = self.shared.state().shape.clone();
        fields.insert("outcome".to_owned(), Value::from(outcome(succeeded)));
        if let Some(step) = failed_step {
            fields.insert("failed_step".to_owned(), Value::from(step_name(step)));
        }
        let ready = ended
            .duration_since(self.shared.started_at)
            .unwrap_or_default();
        fields.insert("seconds".to_owned(), Value::from(seconds(ready)));

        let shared = self.shared;
        if !(shared.kind == RunKind::Up && succeeded) {
            // A rebuild can end right after its build step, before the build
            // lane has read sccache's counters and recorded, so the lanes are
            // joined first; but on a thread, since a wedged sccache or Docker
            // must not hold up a command that is done. Past `LANE_WAIT` the run
            // closes without what the lanes would have added.
            let (done, finished) = mpsc::channel();
            let lane_shared = Arc::clone(&shared);
            let lane_fields = fields.clone();
            std::thread::spawn(move || {
                lane_shared.join_lanes();
                lane_shared.close_run(lane_fields, ended, wait);
                let _ = done.send(());
            });
            if finished.recv_timeout(LANE_WAIT.max(wait)).is_err() {
                shared.close_run(fields, ended, Duration::ZERO);
            }
            return;
        }

        let (done, finished) = mpsc::channel();
        std::thread::spawn(move || {
            shared.join_lanes();
            if succeeded {
                inspect_services(&shared, "app");
            }
            shared.close_run(fields, ended, wait);
            let _ = done.send(());
        });
        let _ = finished.recv_timeout(wait);
    }

    /// A `build` event once sccache's counters after the build are read.
    fn record_build(&self, step: &str, elapsed: Duration, outcome: &'static str) {
        let shared = Arc::clone(&self.shared);
        let step = step.to_owned();
        let lane = std::thread::spawn(move || {
            let (before, output) = {
                let mut state = shared.state();
                (state.sccache_before.take(), state.build_output.take())
            };
            let before = before.and_then(|lane| lane.join().ok().flatten());
            let after = sccache_stats();
            let mut event = Event::new("build")
                .with("step", step.as_str())
                .with("seconds", seconds(elapsed))
                .with("outcome", outcome);
            if let Some(output) = output {
                event = event
                    .with("units_compiled", output.units_compiled)
                    .with("workspace_units_compiled", output.workspace_units_compiled);
            }
            if let (Some(before), Some(after)) = (before, after) {
                let delta = after.since(&before);
                event = event
                    .with("sccache_requests", delta.requests)
                    .with("sccache_hits", delta.hits)
                    .with("sccache_misses", delta.misses);
            }
            shared.record(event);
        });
        self.shared.state().lanes.push(lane);
    }

    fn inspect_services_later(&self, phase: &'static str) {
        let shared = Arc::clone(&self.shared);
        let lane = std::thread::spawn(move || inspect_services(&shared, phase));
        self.shared.state().lanes.push(lane);
    }
}

impl Shared {
    /// Wait for the build and inspection lanes, so their events are recorded.
    fn join_lanes(&self) {
        let lanes = std::mem::take(&mut self.state().lanes);
        for lane in lanes {
            let _ = lane.join();
        }
    }

    /// Record the run event and send, once: later calls find no recorder.
    fn close_run(&self, mut fields: BTreeMap<String, Value>, ended: SystemTime, wait: Duration) {
        fields.insert("steps".to_owned(), Value::from(self.state().steps));
        if let Some(recorder) = self.take_recorder() {
            recorder.finish(fields, ended, wait);
        }
    }

    fn take_recorder(&self) -> Option<Recorder> {
        self.recorder
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
    }

    fn with_recorder(&self, record: impl FnOnce(&Recorder)) {
        let recorder = self.recorder.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(recorder) = recorder.as_ref() {
            record(recorder);
        }
    }

    fn record(&self, event: Event) {
        self.with_recorder(|recorder| recorder.record(event));
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn outcome(succeeded: bool) -> &'static str {
    if succeeded { "success" } else { "failure" }
}

fn seconds(duration: Duration) -> f64 {
    (duration.as_secs_f64() * 1000.0).round() / 1000.0
}

/// The stable step name for a stage label.
pub(super) fn step_name(label: &str) -> &str {
    STEP_NAMES
        .iter()
        .find(|(prefix, _)| label.starts_with(prefix))
        .map_or(label, |(_, name)| name)
}

/// What every event of the run carries.
fn common_fields(
    instance: Option<&Instance>,
    kind: RunKind,
    detached: bool,
) -> BTreeMap<String, Value> {
    let mut fields = BTreeMap::from([
        ("kind".to_owned(), Value::from(kind.as_str())),
        ("detached".to_owned(), Value::from(detached)),
        (
            "platform".to_owned(),
            Value::from(format!(
                "{}-{}",
                std::env::consts::OS,
                std::env::consts::ARCH
            )),
        ),
        (
            "worktree".to_owned(),
            Value::from(opaque_id(&workspace_root().to_string_lossy())),
        ),
    ]);
    if let Some(instance) = instance {
        let instance_kind = if instance.name() == DEFAULT_NAME {
            "default"
        } else {
            "named"
        };
        // Instance and branch names are chosen by people and can carry names,
        // so only the defaults are sent as they are.
        let name = if instance.name() == DEFAULT_NAME {
            DEFAULT_NAME.to_owned()
        } else {
            opaque_id(instance.name())
        };
        fields.insert("instance".to_owned(), Value::from(name));
        fields.insert("instance_kind".to_owned(), Value::from(instance_kind));
    }
    if let Ok(cpus) = std::thread::available_parallelism() {
        fields.insert("cpus".to_owned(), Value::from(cpus.get()));
    }
    if let Some(host) = xtask_local_telemetry::host_name() {
        fields.insert("host".to_owned(), Value::from(opaque_id(&host)));
    }
    if let Some(sha) = git(&["rev-parse", "--short=12", "HEAD"]) {
        fields.insert("git_sha".to_owned(), Value::from(sha));
    }
    if let Some(branch) = git(&["symbolic-ref", "--short", "-q", "HEAD"]) {
        let branch = if MAIN_BRANCHES.contains(&branch.as_str()) {
            branch
        } else {
            opaque_id(&branch)
        };
        fields.insert("branch".to_owned(), Value::from(branch));
    }
    fields
}

fn git(args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .current_dir(repo_root())
        .args(args)
        .output()
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    let text = text.trim();
    (output.status.success() && !text.is_empty()).then(|| text.to_owned())
}

/// Unit counts from cargo's own progress lines.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct BuildOutput {
    pub units_compiled: u32,
    /// Of those, the ones in this repository: cargo prints their path.
    pub workspace_units_compiled: u32,
}

impl BuildOutput {
    pub(super) fn parse(output: &[u8]) -> Self {
        let text = String::from_utf8_lossy(output);
        let compiled: Vec<&str> = text
            .lines()
            .map(str::trim_start)
            .filter(|line| line.starts_with("Compiling "))
            .collect();
        Self {
            units_compiled: u32::try_from(compiled.len()).unwrap_or(u32::MAX),
            workspace_units_compiled: u32::try_from(
                compiled.iter().filter(|line| line.ends_with(')')).count(),
            )
            .unwrap_or(u32::MAX),
        }
    }
}

/// The counters of the shared sccache server.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct SccacheStats {
    pub requests: u64,
    pub hits: u64,
    pub misses: u64,
}

impl SccacheStats {
    pub(super) fn parse(json: &Value) -> Option<Self> {
        let stats = json.get("stats")?;
        let sum = |key: &str| -> u64 {
            stats
                .get(key)
                .and_then(|value| value.get("counts"))
                .and_then(Value::as_object)
                .map_or(0, |counts| counts.values().filter_map(Value::as_u64).sum())
        };
        Some(Self {
            requests: stats.get("compile_requests")?.as_u64()?,
            hits: sum("cache_hits"),
            misses: sum("cache_misses"),
        })
    }

    /// The counts since `before`. The server is shared, so other builds count too.
    fn since(&self, before: &Self) -> Self {
        Self {
            requests: self.requests.saturating_sub(before.requests),
            hits: self.hits.saturating_sub(before.hits),
            misses: self.misses.saturating_sub(before.misses),
        }
    }
}

/// Only when the build goes through sccache, as the Nix dev shell sets up.
fn sccache_stats() -> Option<SccacheStats> {
    let wrapper = std::env::var_os("RUSTC_WRAPPER")?;
    let output = Command::new(wrapper)
        .args(["--show-stats", "--stats-format", "json"])
        .output()
        .ok()
        .filter(|output| output.status.success())?;
    SccacheStats::parse(&serde_json::from_slice(&output.stdout).ok()?)
}

/// A container's health wait, from `docker inspect`.
#[derive(Debug, PartialEq)]
pub(super) struct ServiceHealth {
    pub service: String,
    pub health: String,
    /// From the container starting to its first passing probe.
    pub seconds_to_healthy: Option<f64>,
    pub restarts: u64,
}

impl ServiceHealth {
    pub(super) fn parse(container: &Value) -> Option<Self> {
        let service = container
            .pointer("/Config/Labels/com.docker.compose.service")?
            .as_str()?
            .to_owned();
        let state = container.get("State")?;
        let health = state.get("Health");
        let status = health
            .and_then(|health| health.get("Status"))
            .and_then(Value::as_str)
            .unwrap_or("none")
            .to_owned();
        let started = state
            .get("StartedAt")
            .and_then(Value::as_str)
            .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok());
        let mut probes: Vec<(chrono::DateTime<chrono::FixedOffset>, bool)> = health
            .and_then(|health| health.get("Log"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|probe| {
                let end = chrono::DateTime::parse_from_rfc3339(probe.get("End")?.as_str()?).ok()?;
                Some((
                    end,
                    probe.get("ExitCode").and_then(Value::as_i64) == Some(0),
                ))
            })
            .collect();
        probes.sort_by_key(|(end, _)| *end);
        let first_pass = probes.iter().position(|(_, passed)| *passed);
        // Docker keeps the last few probes only. Once it dropped some, a passing
        // oldest probe may not be the first pass, so the wait is unknown.
        let complete = probes.len() < DOCKER_HEALTH_LOG_ENTRIES;
        let seconds_to_healthy = first_pass
            .filter(|index| complete || *index > 0)
            .and_then(|index| probes.get(index))
            .zip(started)
            .map(|((passed_at, _), started)| {
                let millis = (*passed_at - started).num_milliseconds();
                millis.max(0) as f64 / 1000.0
            });
        Some(Self {
            service,
            health: status,
            seconds_to_healthy,
            restarts: container
                .get("RestartCount")
                .and_then(Value::as_u64)
                .unwrap_or(0),
        })
    }
}

/// A `service` event per container not reported yet. Best effort: no Docker, no
/// events.
fn inspect_services(shared: &Shared, phase: &str) {
    let Some(containers) = shared.project.as_deref().and_then(project_containers) else {
        return;
    };
    for health in containers.iter().filter_map(ServiceHealth::parse) {
        if !shared.state().services.insert(health.service.clone()) {
            continue;
        }
        let mut event = Event::new("service")
            .with("service", health.service.as_str())
            .with("phase", phase)
            .with("health", health.health.as_str())
            .with("restarts", health.restarts);
        if let Some(seconds) = health.seconds_to_healthy {
            event = event
                .with("seconds_to_healthy", seconds)
                .lasting(&health.service, Duration::from_secs_f64(seconds));
        }
        shared.record(event);
    }
}

fn project_containers(project: &str) -> Option<Vec<Value>> {
    let label = format!("label=com.docker.compose.project={project}");
    let ids = Command::new("docker")
        .args(["ps", "-q", "--filter", &label])
        .output()
        .ok()
        .filter(|output| output.status.success())?;
    let ids: Vec<String> = String::from_utf8_lossy(&ids.stdout)
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    if ids.is_empty() {
        return None;
    }
    let inspected = Command::new("docker")
        .arg("inspect")
        .args(&ids)
        .output()
        .ok()
        .filter(|output| output.status.success())?;
    serde_json::from_slice(&inspected.stdout).ok()
}
