//! What a run records when its user opted in to local telemetry: the run, every
//! step, each service build and each container's health wait. Sending, the
//! opt-in file and the buffer are `xtask_local_telemetry`'s.
//!
//! Hooked in through the supervisor's [`super::supervisor::Job`], which every
//! attached, detached and rebuild run already has, so the flows themselves only
//! report the bring-up's shape ([`RunTelemetry::bring_up`]). Opted out, `begin`
//! returns `None` and every hook is a no-op.
//!
//! Fields hold names of our own steps and services, opaque ids, counts and
//! timings: never paths, env values, error text or anything from the opt-in file.

use std::collections::{BTreeMap, HashSet};
use std::process::Command;
use std::sync::{Arc, Mutex, PoisonError, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime};

use serde_json::Value;
use xtask_local_telemetry::{Event, Paths, Recorder, opaque_id};

use super::instance::{DEFAULT_NAME, Instance};
use super::supervisor::JobKind;
use super::{BringUp, Mode, Start, repo_root, workspace_root};

#[cfg(test)]
mod test;

/// How long a background process waits for its last events to be sent. Nobody
/// waits on such a process, so this never delays a run.
pub(super) const DETACHED_FINISH_WAIT: Duration = Duration::from_secs(10);
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
];

/// What a run is, for the `kind` field.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RunKind {
    Up,
    Rebuild,
    Stop,
    RestartFrontend,
}

impl RunKind {
    fn as_str(self) -> &'static str {
        match self {
            RunKind::Up => "up",
            RunKind::Rebuild => "rebuild",
            RunKind::Stop => "stop",
            RunKind::RestartFrontend => "restart_frontend",
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

/// One run's recording, shared with its background lanes.
pub(super) struct RunTelemetry {
    shared: Arc<Shared>,
}

struct Shared {
    /// Taken by `finish`; a lane that outlives it has nowhere to record.
    recorder: Mutex<Option<Recorder>>,
    project: String,
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
    lanes: Vec<JoinHandle<()>>,
}

impl RunTelemetry {
    /// Start recording, or `None` when the user hasn't opted in (or the opt-in
    /// file is unusable, which is reported once and leaves telemetry off).
    pub(super) fn begin(
        instance: &Instance,
        kind: RunKind,
        started_at: SystemTime,
        detached: bool,
    ) -> Option<Self> {
        let paths = Paths::for_user()?;
        let recorder = match Recorder::start(&paths, started_at, common_fields(instance, kind, detached)) {
            Ok(recorder) => recorder?,
            Err(error) => {
                eprintln!("local telemetry is off: {error}");
                return None;
            }
        };
        Some(Self {
            shared: Arc::new(Shared {
                recorder: Mutex::new(Some(recorder)),
                project: instance.project_name().to_owned(),
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
        let telemetry = Self::begin(instance, kind, SystemTime::now(), false);
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
            ("static_frontend".to_owned(), Value::from(plan.static_bundle)),
        ]);
    }

    pub(super) fn step_started(&self, label: &str) {
        let step = step_name(label);
        self.shared.with_recorder(|recorder| recorder.step_started(step));
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

    /// Close the run. Its last inspection and the send run on a lane; a detached
    /// process waits up to `wait` for them, an attached one moves on at once.
    pub(super) fn finish(self, succeeded: bool, failed_step: Option<&str>, wait: Duration) {
        let ended = SystemTime::now();
        let mut fields = self.shared.state().shape.clone();
        fields.insert("outcome".to_owned(), Value::from(outcome(succeeded)));
        if let Some(step) = failed_step {
            fields.insert("failed_step".to_owned(), Value::from(step_name(step)));
        }
        let ready = ended.duration_since(self.shared.started_at).unwrap_or_default();
        fields.insert("ready_seconds".to_owned(), Value::from(seconds(ready)));

        let (done, finished) = mpsc::channel();
        let shared = self.shared;
        std::thread::spawn(move || {
            let lanes = std::mem::take(&mut shared.state().lanes);
            for lane in lanes {
                let _ = lane.join();
            }
            if succeeded {
                inspect_services(&shared, "app");
            }
            fields.insert(
                "steps".to_owned(),
                Value::from(shared.state().steps),
            );
            let recorder = shared
                .recorder
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .take();
            if let Some(recorder) = recorder {
                recorder.finish(fields, ended, wait);
            }
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
fn common_fields(instance: &Instance, kind: RunKind, detached: bool) -> BTreeMap<String, Value> {
    let instance_kind = if instance.name() == DEFAULT_NAME {
        "default"
    } else {
        "named"
    };
    let mut fields = BTreeMap::from([
        ("kind".to_owned(), Value::from(kind.as_str())),
        ("detached".to_owned(), Value::from(detached)),
        ("instance".to_owned(), Value::from(instance.name())),
        ("instance_kind".to_owned(), Value::from(instance_kind)),
        (
            "platform".to_owned(),
            Value::from(format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)),
        ),
        (
            "worktree".to_owned(),
            Value::from(opaque_id(&workspace_root().to_string_lossy())),
        ),
    ]);
    if let Ok(cpus) = std::thread::available_parallelism() {
        fields.insert("cpus".to_owned(), Value::from(cpus.get()));
    }
    if let Some(host) = host_name() {
        fields.insert("host".to_owned(), Value::from(opaque_id(&host)));
    }
    if let Some(sha) = git(&["rev-parse", "--short=12", "HEAD"]) {
        fields.insert("git_sha".to_owned(), Value::from(sha));
    }
    if let Some(branch) = git(&["symbolic-ref", "--short", "-q", "HEAD"]) {
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

fn host_name() -> Option<String> {
    let mut buffer = [0u8; 256];
    // SAFETY: gethostname writes at most `len` bytes into the buffer we own.
    let status = unsafe { libc::gethostname(buffer.as_mut_ptr().cast(), buffer.len()) };
    if status != 0 {
        return None;
    }
    let end = buffer.iter().position(|byte| *byte == 0)?;
    String::from_utf8(buffer[..end].to_vec()).ok()
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
                Some((end, probe.get("ExitCode").and_then(Value::as_i64) == Some(0)))
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
    let Some(containers) = project_containers(&shared.project) else {
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
