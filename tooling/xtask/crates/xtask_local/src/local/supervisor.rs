//! Detached `run_local`: the flow agents and humans share when no terminal stays
//! attached.
//!
//! `just run_local` without a terminal (or with `--detach`) re-executes itself as
//! a background process and only watches it. Bring-up and rebuilds then outlive
//! a Bash tool call that times out, a killed parent shell, and the
//! `nix develop --command` that launched them.
//!
//! - The **job** (`job.json`, `job.lock`) is one bring-up or rebuild: its current
//!   step, the step that failed, and its log. The foreground streams the log and
//!   exits on the job's outcome. A held lock proves the job is alive, without
//!   trusting a pid that could have been reused.
//! - The **supervisor** (`supervisor.lock`) is the bring-up process staying alive
//!   to hold Vite and any Cloudflare tunnels. It exits once ready when it holds
//!   neither. Vite exits with it, through stdin EOF, so a dead supervisor never
//!   leaves a stray dev server holding the port.
//!
//! Containers keep running regardless: only Docker owns them.

use std::fs::{File, OpenOptions, TryLockError};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::cli::{InstanceArgs, RunArgs};
use super::instance::Instance;
use super::stage::Stage;
use super::{BringUp, Mode, Start, frontend, kafka, stack, summary};

#[cfg(test)]
mod test;

/// How long a freshly spawned background process gets to report its pid. It only
/// has to reach `main` and take its locks, so missing this means it failed to
/// start.
const SPAWN_HANDSHAKE: Duration = Duration::from_secs(30);
/// How long a stopped process gets to exit before it is killed.
const STOP_GRACE: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(200);
/// Exit code of `wait` when it gave up while the job is still running.
const EXIT_WAIT_TIMED_OUT: i32 = 3;

/// `just run_local` subcommands. Each works on any instance that has recorded
/// state, whichever terminal or process started it.
#[derive(Subcommand, Clone)]
pub enum RunAction {
    /// Report phase, containers, health, and URLs (`--json` for machines).
    Status(stack::StatusArgs),
    /// Block until the running bring-up or rebuild finishes.
    Wait(WaitArgs),
    /// Print a log: the last job's, or `--service <name>`'s (`frontend` is Vite).
    Logs(LogsArgs),
    /// Rebuild changed services and reload them. Data survives.
    Rebuild(RebuildArgs),
    /// Restart Vite with the same port and configuration.
    RestartFrontend(InstanceArgs),
    /// Stop the supervisor and containers. Data survives.
    Stop(InstanceArgs),
}

#[derive(Args, Clone, Default)]
pub struct WaitArgs {
    #[command(flatten)]
    pub instance: InstanceArgs,
    /// Give up after this many seconds, exiting 3. The job keeps running.
    #[arg(long)]
    pub timeout: Option<u64>,
    /// Print machine-readable status as the final line.
    #[arg(long)]
    pub json: bool,
}

#[derive(Args, Clone, Default)]
pub struct LogsArgs {
    #[command(flatten)]
    pub instance: InstanceArgs,
    /// A compose service, or `frontend` for Vite. Defaults to the last job's log.
    #[arg(long)]
    pub service: Option<String>,
    /// Keep following the log.
    #[arg(long, short)]
    pub follow: bool,
    /// How many lines to print.
    #[arg(long, short = 'n', default_value_t = 200)]
    pub lines: u32,
}

#[derive(Args, Clone, Default)]
pub struct RebuildArgs {
    #[command(flatten)]
    pub instance: InstanceArgs,
    /// Also rebuild and restage a static frontend bundle, if this stack has one.
    #[arg(long)]
    pub frontend: bool,
    /// Rebuild every repository-built local Docker service and recreate it.
    #[arg(long)]
    pub build_aux_services: bool,
    /// Rebuild and restart only these Rust services (comma-separated compose or
    /// binary names). The others keep running older code until a full rebuild;
    /// `status` lists them.
    #[arg(long, value_delimiter = ',', num_args = 1..)]
    pub services: Vec<String>,
    /// Stream subprocess output and show per-step timings.
    #[arg(long, short)]
    pub verbose: bool,
    /// Return as soon as the rebuild is running; check it with `wait`.
    #[arg(long)]
    pub no_wait: bool,
    /// Print machine-readable status as the final line.
    #[arg(long)]
    pub json: bool,
    /// Internal: this process is the background rebuild.
    #[arg(long, hide = true)]
    pub supervise: bool,
}

/// What a job is doing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    Up,
    Rebuild,
}

impl JobKind {
    fn log_name(self) -> &'static str {
        match self {
            JobKind::Up => "up.log",
            JobKind::Rebuild => "rebuild.log",
        }
    }

    fn label(self) -> &'static str {
        match self {
            JobKind::Up => "bring-up",
            JobKind::Rebuild => "rebuild",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Running,
    Succeeded,
    Failed,
}

/// The durable record of the latest job, in `job.json`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JobRecord {
    pub kind: JobKind,
    pub status: JobStatus,
    /// `None` until the background process has started and taken its lock.
    pub pid: Option<u32>,
    pub step: Option<String>,
    pub failed_step: Option<String>,
    pub error: Option<String>,
    /// `None` for an attached run, whose output is the terminal.
    pub log: Option<PathBuf>,
    pub started_at: u64,
    pub finished_at: Option<u64>,
    /// Services a rebuild reloaded.
    #[serde(default)]
    pub reloaded: Vec<String>,
}

impl JobRecord {
    fn new(kind: JobKind, log: Option<PathBuf>) -> Self {
        Self {
            kind,
            status: JobStatus::Running,
            pid: None,
            step: None,
            failed_step: None,
            error: None,
            log,
            started_at: unix_now(),
            finished_at: None,
            reloaded: Vec::new(),
        }
    }

    /// A newly started step clears an earlier failure, because a caller that
    /// carried on past it treated that failure as survivable.
    pub(super) fn step_started(&mut self, label: &str) {
        self.step = Some(label.to_owned());
        self.failed_step = None;
    }

    /// The first failure wins: an enclosing step failing because its inner step
    /// did must not replace the more precise name.
    pub(super) fn step_failed(&mut self, label: &str) {
        if self.failed_step.is_none() {
            self.failed_step = Some(label.to_owned());
        }
    }

    fn describe_failure(&self) -> String {
        let place = match (self.failed_step.as_deref(), self.step.as_deref()) {
            (Some(step), _) => format!("at '{step}'"),
            // The error came between steps, after this one had succeeded.
            (None, Some(step)) => format!("after '{step}'"),
            (None, None) => "before the first step".to_owned(),
        };
        let log = self
            .log
            .as_deref()
            .map_or_else(|| "the terminal".to_owned(), |p| p.display().to_string());
        format!("{} failed {place}. Log: {log}", self.kind.label())
    }
}

/// A running job: its record plus the lock that proves it is alive.
pub struct Job {
    path: PathBuf,
    record: Mutex<JobRecord>,
    lock: Mutex<Option<File>>,
}

impl Job {
    /// Take the job lock and start recording, keeping a record the foreground
    /// already wrote (so its log path and start time stay) or creating one.
    fn begin(instance: &Instance, kind: JobKind) -> Result<Arc<Self>> {
        let dir = run_dir(instance)?;
        let Some(lock) = try_lock(&dir.join("job.lock"))? else {
            bail!(
                "another job is already running on instance {}",
                instance.name()
            );
        };
        let mut record = read_job(instance)
            .filter(|r| r.kind == kind && r.status == JobStatus::Running && r.pid.is_none())
            .unwrap_or_else(|| JobRecord::new(kind, None));
        record.pid = Some(std::process::id());
        let job = Arc::new(Self {
            path: job_path(instance),
            record: Mutex::new(record),
            lock: Mutex::new(Some(lock)),
        });
        job.save();
        Ok(job)
    }

    fn record(&self) -> MutexGuard<'_, JobRecord> {
        self.record.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn step_started(&self, label: &str) {
        self.record().step_started(label);
        self.save();
    }

    pub(super) fn step_failed(&self, label: &str) {
        self.record().step_failed(label);
        self.save();
    }

    fn set_reloaded(&self, reloaded: Vec<String>) {
        self.record().reloaded = reloaded;
        self.save();
    }

    fn finish<T>(&self, result: Result<T>) -> Result<T> {
        {
            let mut record = self.record();
            record.finished_at = Some(unix_now());
            match &result {
                Ok(_) => {
                    record.status = JobStatus::Succeeded;
                    record.failed_step = None;
                }
                Err(error) => {
                    record.status = JobStatus::Failed;
                    record.error = Some(format!("{error:#}"));
                }
            }
        }
        self.save();
        // A background stage thread can outlive this call, so release the lock
        // explicitly instead of when the last handle drops.
        *self.lock.lock().unwrap_or_else(PoisonError::into_inner) = None;
        result
    }

    /// Best effort: a status file that can't be written must not fail the work
    /// it describes, and the waiting foreground reports a dead job anyway.
    /// Holds the record's lock through the write: background lanes record their
    /// steps from other threads, and two writes through the one temp file could
    /// rename a half-written record into place.
    fn save(&self) {
        let record = self.record();
        if let Err(error) = write_job(&self.path, &record) {
            eprintln!("could not record job state: {error:#}");
        }
    }
}

/// `<artifact dir>/run`, created on demand.
fn run_dir(instance: &Instance) -> Result<PathBuf> {
    let dir = instance.artifact_dir().join("run");
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    Ok(dir)
}

fn job_path(instance: &Instance) -> PathBuf {
    instance.artifact_dir().join("run/job.json")
}

fn lock_path(instance: &Instance, name: &str) -> PathBuf {
    instance.artifact_dir().join("run").join(name)
}

pub(super) fn read_job(instance: &Instance) -> Option<JobRecord> {
    let raw = std::fs::read_to_string(job_path(instance)).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Forget the last job, when the instance it described is destroyed.
pub(super) fn clear_job(instance: &Instance) {
    let _ = std::fs::remove_file(job_path(instance));
}

/// Written through a rename, so a reader never sees half a record.
fn write_job(path: &Path, record: &JobRecord) -> Result<()> {
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    std::fs::write(&tmp, serde_json::to_vec_pretty(record)?)
        .with_context(|| format!("writing {}", tmp.display()))?;
    std::fs::rename(&tmp, path).with_context(|| format!("replacing {}", path.display()))
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn open_lock(path: &Path) -> Result<File> {
    OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .with_context(|| format!("opening {}", path.display()))
}

/// Take an exclusive lock, or `None` when another process holds it. The kernel
/// releases it when the holder dies, however it dies.
pub(super) fn try_lock(path: &Path) -> Result<Option<File>> {
    let file = open_lock(path)?;
    match file.try_lock() {
        Ok(()) => Ok(Some(file)),
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Error(error)) => {
            Err(error).with_context(|| format!("locking {}", path.display()))
        }
    }
}

fn lock_blocking(path: &Path) -> Result<File> {
    let file = open_lock(path)?;
    file.lock()
        .with_context(|| format!("locking {}", path.display()))?;
    Ok(file)
}

/// Whether a live process holds this lock. A shared probe, so it can't make a
/// concurrent status check look like a holder.
pub(super) fn is_locked(path: &Path) -> bool {
    let Ok(file) = OpenOptions::new().read(true).open(path) else {
        return false;
    };
    matches!(file.try_lock_shared(), Err(TryLockError::WouldBlock))
}

pub(super) fn supervisor_alive(instance: &Instance) -> bool {
    is_locked(&lock_path(instance, "supervisor.lock"))
}

fn job_alive(instance: &Instance) -> bool {
    is_locked(&lock_path(instance, "job.lock"))
}

/// Hold the supervisor lock and record this process as its holder.
fn take_supervisor_lock(instance: &Instance) -> Result<File> {
    let dir = run_dir(instance)?;
    let Some(mut lock) = try_lock(&dir.join("supervisor.lock"))? else {
        bail!(
            "instance {} is already running in another process; \
             check `just run_local status --instance {0}`",
            instance.name()
        );
    };
    lock.set_len(0)?;
    write!(lock, "{}", std::process::id())?;
    Ok(lock)
}

fn supervisor_pid(instance: &Instance) -> Option<i32> {
    std::fs::read_to_string(lock_path(instance, "supervisor.lock"))
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// Start `program` as a background process that survives its parent. The double
/// fork reparents it away from the caller, so a harness that kills a process tree
/// by walking parent pids can't reach it; `setsid` leaves the caller's process
/// group and terminal. Output is appended to `log`.
pub(super) fn spawn_detached(program: &Path, args: &[String], log: &Path) -> Result<()> {
    let out = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)
        .with_context(|| format!("opening {}", log.display()))?;
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(out.try_clone()?)
        .stderr(out);
    // SAFETY: fork, setsid and _exit are async-signal-safe, and nothing else runs
    // between this fork and the exec.
    unsafe {
        cmd.pre_exec(|| {
            match libc::fork() {
                -1 => return Err(std::io::Error::last_os_error()),
                0 => {}
                _ => libc::_exit(0),
            }
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut intermediate = cmd
        .spawn()
        .with_context(|| format!("starting {}", program.display()))?;
    intermediate.wait()?;
    Ok(())
}

/// Write a fresh job record and log, spawn this binary with `args`, and wait
/// until it has taken over the record.
fn spawn_job(instance: &Instance, kind: JobKind, args: &[String]) -> Result<PathBuf> {
    let dir = run_dir(instance)?;
    let log = dir.join(kind.log_name());
    File::create(&log).with_context(|| format!("creating {}", log.display()))?;
    write_job(
        &job_path(instance),
        &JobRecord::new(kind, Some(log.clone())),
    )?;
    let exe = std::env::current_exe().context("locating the xtask binary")?;
    spawn_detached(&exe, args, &log)?;

    let deadline = Instant::now() + SPAWN_HANDSHAKE;
    loop {
        if read_job(instance).is_some_and(|r| r.pid.is_some()) {
            return Ok(log);
        }
        if Instant::now() > deadline {
            bail!(
                "the background {} did not start within {}s. Log: {}",
                kind.label(),
                SPAWN_HANDSHAKE.as_secs(),
                log.display()
            );
        }
        std::thread::sleep(POLL);
    }
}

/// This process's own arguments plus `--supervise`.
fn supervise_argv() -> Vec<String> {
    std::env::args()
        .skip(1)
        .chain(["--supervise".to_owned()])
        .collect()
}

/// What `just run_local` should do given what the instance is already doing.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum StartDecision {
    /// A bring-up or rebuild is running: wait for it instead of starting another.
    AttachToJob,
    /// Healthy already: report it. Starting over would risk the data for nothing.
    AlreadyRunning,
    /// Bring it up: resuming from existing volumes, or `--fresh`.
    Spawn,
}

pub(super) fn decide_start(phase: stack::Phase, job_running: bool, fresh: bool) -> StartDecision {
    if fresh {
        return StartDecision::Spawn;
    }
    if job_running {
        return StartDecision::AttachToJob;
    }
    match phase {
        stack::Phase::Ready => StartDecision::AlreadyRunning,
        _ => StartDecision::Spawn,
    }
}

/// `just run_local` with no terminal: bring the stack up in the background and
/// watch it. Safe to repeat: a healthy instance is left alone and a stopped one
/// resumes with its data. Only `--fresh` wipes.
pub fn start_detached(args: &RunLocalFlags, run: &RunArgs) -> Result<()> {
    let instance = Instance::resolve(run.instance.instance.as_deref(), run.instance.port_base)?;
    instance.ensure_artifact_dir()?;
    let dir = run_dir(&instance)?;
    let start_lock = lock_blocking(&dir.join("start.lock"))?;

    let job_running = job_alive(&instance);
    let phase = stack::current_phase(&instance)?;
    match decide_start(phase, job_running, args.fresh) {
        StartDecision::AttachToJob => {
            println!(
                "instance {} already has a job running; waiting for it",
                instance.name()
            );
        }
        StartDecision::AlreadyRunning => {
            println!(
                "instance {} is already running; nothing to do \
                 (`just run_local rebuild` picks up edits, `--fresh` wipes and restarts)",
                instance.name()
            );
            return finish_output(&instance, args.json);
        }
        StartDecision::Spawn => {
            stop_processes(&instance);
            let log = spawn_job(&instance, JobKind::Up, &supervise_argv())?;
            println!("starting in the background. Log: {}", log.display());
        }
    }
    drop(start_lock);

    if args.no_wait {
        return finish_output(&instance, args.json);
    }
    wait_for_job(&instance, None, args.json)
}

/// The flags only `just run_local` has, on top of the [`RunArgs`] it shares with
/// `stack up`.
#[derive(Args, Clone, Default)]
pub struct RunLocalFlags {
    /// Run in the background even with a terminal attached. This is automatic
    /// when stdin or stdout isn't a terminal.
    #[arg(long)]
    pub detach: bool,
    /// Return as soon as the bring-up is running; check it with `wait`.
    #[arg(long)]
    pub no_wait: bool,
    /// Delete the instance's data and start clean. A detached start otherwise
    /// keeps existing volumes; an attached one always starts clean.
    #[arg(long)]
    pub fresh: bool,
    /// Serve a built bundle from the proxy instead of running Vite.
    #[arg(long, conflicts_with = "no_frontend")]
    pub static_frontend: bool,
    /// Print machine-readable status as the final line.
    #[arg(long)]
    pub json: bool,
    /// Internal: this process is the background bring-up.
    #[arg(long, hide = true)]
    pub supervise: bool,
}

/// How this run's frontend flags translate into a bring-up.
pub(super) fn plan_for(mode: Mode, flags: &RunLocalFlags, run: &RunArgs, start: Start) -> BringUp {
    let share_app = run.with_cf_tunnel && mode == Mode::Local;
    BringUp {
        vite: !run.no_frontend && !flags.static_frontend,
        static_bundle: share_app || flags.static_frontend,
        share_app,
        infra_only: false,
        start,
    }
}

/// The background bring-up: run it, then keep holding Vite and any tunnels.
pub fn supervise(mode: Mode, flags: &RunLocalFlags, run: &RunArgs) -> Result<()> {
    if mode.spec().runs_local_infra {
        kafka::ensure_available(&format!("run-{}", mode.label()))?;
    }
    // The lock and job are keyed by name; the window is allocated once the job
    // can record the allocation step.
    let mut instance = Instance::derive(run.instance.instance.as_deref(), run.instance.port_base)?;
    let _supervisor_lock = take_supervisor_lock(&instance)?;
    let job = Job::begin(&instance, JobKind::Up)?;
    let stage = Stage::from_env_cli(run.verbose).with_job(Arc::clone(&job));

    let result = (|| {
        instance = super::allocator::allocate(
            &stage,
            mode,
            run.instance.instance.as_deref(),
            run.instance.port_base,
        )?;
        // Volumes mean someone's data, so only an explicit `--fresh` may wipe them.
        let start = if flags.fresh || !super::instance_has_volumes(&instance)? {
            Start::Fresh
        } else {
            Start::Resume
        };
        stage.section(&format!(
            "macro {} stack (detached, {}) — instance {}",
            mode.label(),
            match start {
                Start::Fresh => "fresh",
                Start::Resume => "keeping data",
            },
            instance.name()
        ));
        let plan = plan_for(mode, flags, run, start);
        let up = super::bring_up(&stage, mode, &mut instance, run, &plan)?;
        let frontend = if plan.vite {
            frontend::start(
                &stage,
                &instance,
                mode,
                run.traces.enabled() && summary::port_open(4318),
            )?
        } else {
            stage.note("Vite not started");
            None
        };
        stage.print_timings("bring-up");
        super::print_stack_summary(mode, &instance, &up, &plan)?;
        Ok((frontend, up.tunnels))
    })();
    let (frontend, tunnels) = job.finish(result)?;

    if frontend.is_some() || !tunnels.is_empty() {
        hold(&stage, frontend)?;
    }
    drop(tunnels);
    Ok(())
}

static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);
static RESTART_REQUESTED: AtomicBool = AtomicBool::new(false);

extern "C" fn on_stop(_signal: libc::c_int) {
    STOP_REQUESTED.store(true, Ordering::SeqCst);
}

extern "C" fn on_restart(_signal: libc::c_int) {
    RESTART_REQUESTED.store(true, Ordering::SeqCst);
}

/// Stay alive holding the dev server until asked to stop, or until it exits. The
/// default signal action is deliberately kept during bring-up, so stopping one
/// mid-build ends it right there.
fn hold(stage: &Stage, mut frontend: Option<frontend::Frontend>) -> Result<()> {
    // SAFETY: both handlers only store to an atomic, which is async-signal-safe.
    unsafe {
        libc::signal(libc::SIGTERM, on_stop as *const () as libc::sighandler_t);
        libc::signal(libc::SIGINT, on_stop as *const () as libc::sighandler_t);
        libc::signal(libc::SIGUSR1, on_restart as *const () as libc::sighandler_t);
        libc::signal(libc::SIGHUP, libc::SIG_IGN);
    }
    loop {
        std::thread::sleep(POLL);
        if STOP_REQUESTED.load(Ordering::SeqCst) {
            if let Some(fe) = frontend.as_mut() {
                fe.shutdown();
            }
            return Ok(());
        }
        let Some(fe) = frontend.as_mut() else {
            continue;
        };
        if RESTART_REQUESTED.swap(false, Ordering::SeqCst) {
            fe.restart(stage)?;
        }
        if let Some(status) = fe.process.child.try_wait()? {
            let output = fe.tail_output(40);
            bail!("frontend dev server exited with {status}\n{output}");
        }
    }
}

/// Run a parsed subcommand of `just run_local`.
pub fn run_action(action: &RunAction) -> Result<()> {
    match action {
        RunAction::Status(args) => stack::status(args),
        RunAction::Wait(args) => {
            let instance = instance_of(&args.instance)?;
            wait_for_job(&instance, args.timeout.map(Duration::from_secs), args.json)
        }
        RunAction::Logs(args) => logs(args),
        RunAction::Rebuild(args) if args.supervise => supervise_rebuild(args),
        RunAction::Rebuild(args) => rebuild(args),
        RunAction::RestartFrontend(args) => restart_frontend(&instance_of(args)?),
        RunAction::Stop(args) => super::stop(args),
    }
}

fn instance_of(args: &InstanceArgs) -> Result<Instance> {
    Instance::resolve(args.instance.as_deref(), args.port_base)
}

/// Stream the current job's log until it finishes. Nonzero, naming the step and
/// log, when it fails. Exit code 3 when `timeout` passes first, which is not a
/// failure: the job keeps running and this can simply be called again.
fn wait_for_job(instance: &Instance, timeout: Option<Duration>, json: bool) -> Result<()> {
    let Some(first) = read_job(instance) else {
        // A stack with no job on record (`just stack up`) can still be healthy.
        if stack::current_phase(instance)? == stack::Phase::Ready {
            return finish_output(instance, json);
        }
        bail!(
            "instance {0} has nothing running. Start it with `just run_local --instance {0}`",
            instance.name()
        );
    };
    let deadline = timeout.map(|t| Instant::now() + t);
    let mut stream = first.log.as_deref().and_then(|p| LogStream::open(p).ok());
    let mut stdout = std::io::stdout();
    loop {
        // Read the record first, so a finished job's last output is still streamed.
        let mut record = read_job(instance).context("the job record disappeared")?;
        let mut died = false;
        if record.status == JobStatus::Running && record.pid.is_some() && !job_alive(instance) {
            // finish() saves the record before it unlocks, so a fresh read tells
            // a job that just finished from one that died.
            record = read_job(instance).context("the job record disappeared")?;
            died = record.status == JobStatus::Running;
        }
        let finished = record.status != JobStatus::Running;
        if let Some(stream) = stream.as_mut() {
            stream.copy_new(&mut stdout)?;
        }
        if record.status == JobStatus::Failed {
            bail!("{}", record.describe_failure());
        }
        if died {
            bail!(
                "{} stopped before it finished, at '{}'. Log: {}",
                record.kind.label(),
                record.step.as_deref().unwrap_or("its first step"),
                record
                    .log
                    .as_deref()
                    .map_or_else(|| "the terminal".to_owned(), |p| p.display().to_string())
            );
        }
        if finished {
            return finish_output(instance, json);
        }
        if deadline.is_some_and(|d| Instant::now() > d) {
            eprintln!(
                "still running at '{}'. It continues in the background; check it with \
                 `just run_local wait --instance {}`",
                record.step.as_deref().unwrap_or("its first step"),
                instance.name()
            );
            std::process::exit(EXIT_WAIT_TIMED_OUT);
        }
        std::thread::sleep(POLL);
    }
}

/// Copies whatever a log gained since the last call.
struct LogStream {
    file: File,
    position: u64,
}

impl LogStream {
    fn open(path: &Path) -> Result<Self> {
        Ok(Self {
            file: File::open(path)?,
            position: 0,
        })
    }

    fn copy_new(&mut self, out: &mut impl Write) -> Result<()> {
        self.file.seek(SeekFrom::Start(self.position))?;
        let mut new_bytes = Vec::new();
        self.file.read_to_end(&mut new_bytes)?;
        self.position += new_bytes.len() as u64;
        out.write_all(&new_bytes)?;
        out.flush()?;
        Ok(())
    }
}

fn finish_output(instance: &Instance, json: bool) -> Result<()> {
    if json {
        println!("{}", serde_json::to_string(&stack::status_json(instance)?)?);
    }
    Ok(())
}

fn logs(args: &LogsArgs) -> Result<()> {
    let instance = instance_of(&args.instance)?;
    let lines = args.lines.to_string();
    let path = match args.service.as_deref() {
        Some("frontend") => frontend::log_path(&instance),
        Some(service) => {
            let mut compose = Command::new("docker");
            compose.args([
                "compose",
                "-p",
                instance.project_name(),
                "logs",
                "--tail",
                &lines,
            ]);
            if args.follow {
                compose.arg("--follow");
            }
            return check_status(
                compose
                    .arg(service)
                    .status()
                    .context("running docker compose")?,
            );
        }
        None => read_job(&instance)
            .and_then(|r| r.log)
            .with_context(|| format!("instance {} has no job log yet", instance.name()))?,
    };
    if !path.exists() {
        bail!("no log at {}", path.display());
    }
    println!("==> {}", path.display());
    let mut tail = Command::new("tail");
    tail.args(["-n", &lines]);
    if args.follow {
        tail.arg("-F");
    }
    check_status(tail.arg(&path).status().context("running tail")?)
}

fn check_status(status: std::process::ExitStatus) -> Result<()> {
    if status.success() {
        Ok(())
    } else {
        bail!("exited with {status}")
    }
}

/// `just run_local rebuild`: run the same rebuild as the `r` hotkey in the
/// background, wait for it, and report. Never bootstraps: without a recorded
/// stack there is nothing to reload into, and this command never wipes.
fn rebuild(args: &RebuildArgs) -> Result<()> {
    let instance = instance_of(&args.instance)?;
    if !stack::is_recorded(&instance) {
        bail!(
            "instance {0} has no recorded stack to rebuild. Start it with \
             `just run_local --instance {0}`",
            instance.name()
        );
    }
    if stack::current_phase(&instance)? == stack::Phase::Stopped {
        bail!(
            "instance {0} is stopped. Start it with `just run_local --instance {0}`, \
             which rebuilds and keeps its data",
            instance.name()
        );
    }

    // An earlier job may predate the edit being asked for, so let it finish and
    // then run another instead of attaching to it.
    if job_alive(&instance) {
        println!(
            "instance {} has a job running; waiting for it first",
            instance.name()
        );
        if let Err(error) = wait_for_job(&instance, None, false) {
            println!("that job failed ({error:#}); rebuilding anyway");
        }
    }
    let dir = run_dir(&instance)?;
    let start_lock = lock_blocking(&dir.join("start.lock"))?;
    let log = spawn_job(&instance, JobKind::Rebuild, &supervise_argv())?;
    drop(start_lock);
    println!("rebuilding in the background. Log: {}", log.display());

    if args.no_wait {
        return finish_output(&instance, args.json);
    }
    wait_for_job(&instance, None, args.json)
}

fn supervise_rebuild(args: &RebuildArgs) -> Result<()> {
    let instance = instance_of(&args.instance)?;
    let job = Job::begin(&instance, JobKind::Rebuild)?;
    let stage = Stage::from_env_cli(args.verbose).with_job(Arc::clone(&job));
    let result = stack::rebuild_recorded(
        &stage,
        &stack::UpdateArgs {
            instance: args.instance.clone(),
            frontend: args.frontend,
            build_aux_services: args.build_aux_services,
            services: args.services.clone(),
            verbose: args.verbose,
            ..Default::default()
        },
    );
    if let Ok(reloaded) = &result {
        if reloaded.is_empty() {
            println!("no service binary changed; nothing reloaded");
        } else {
            println!("reloaded: {}", reloaded.join(", "));
        }
        job.set_reloaded(reloaded.clone());
    }
    job.finish(result).map(|_| ())
}

fn restart_frontend(instance: &Instance) -> Result<()> {
    let Some(pid) = supervisor_pid(instance).filter(|_| supervisor_alive(instance)) else {
        bail!(
            "instance {0} has no process holding the frontend. \
             Run `just run_local --instance {0}`, which restarts it and keeps the data",
            instance.name()
        );
    };
    let frontend_pid = frontend::read_pid(instance);
    // SAFETY: a plain kill(2); the held lock shows this pid is the supervisor.
    if unsafe { libc::kill(pid, libc::SIGUSR1) } != 0 {
        return Err(std::io::Error::last_os_error()).context("signalling the supervisor");
    }
    let deadline = Instant::now() + frontend::STARTUP_TIMEOUT;
    while Instant::now() < deadline {
        std::thread::sleep(POLL);
        if !supervisor_alive(instance) {
            bail!(
                "the frontend did not come back. Log: {}",
                frontend::log_path(instance).display()
            );
        }
        if frontend::read_pid(instance) != frontend_pid {
            println!("frontend restarted");
            return Ok(());
        }
    }
    bail!(
        "the frontend did not restart in time. Log: {}",
        frontend::log_path(instance).display()
    )
}

/// Stop this instance's supervisor and any running job, named by their held
/// locks. Their whole process groups go, so a mid-build `cargo` or `docker compose`
/// stops with them. Containers are left to the caller.
pub(super) fn stop_processes(instance: &Instance) {
    if !instance.artifact_dir().join("run").is_dir() {
        return;
    }
    if job_alive(instance)
        && let Some(pid) = read_job(instance).and_then(|r| r.pid)
    {
        stop_process(pid as i32, || job_alive(instance));
    }
    if supervisor_alive(instance)
        && let Some(pid) = supervisor_pid(instance)
    {
        stop_process(pid, || supervisor_alive(instance));
    }
    frontend::stop_recorded(instance);
}

fn stop_process(pid: i32, is_alive: impl Fn() -> bool) {
    signal_group(pid, libc::SIGTERM);
    let deadline = Instant::now() + STOP_GRACE;
    while is_alive() && Instant::now() < deadline {
        std::thread::sleep(POLL);
    }
    if is_alive() {
        signal_group(pid, libc::SIGKILL);
    }
}

/// Signal a background process's group, or just the process when it isn't a group
/// leader (an attached run in someone's terminal).
fn signal_group(pid: i32, signal: libc::c_int) {
    // SAFETY: plain kill(2) calls; a stale target only yields ESRCH.
    unsafe {
        if libc::kill(-pid, signal) != 0 {
            libc::kill(pid, signal);
        }
    }
}

/// Attached runs hold the same locks and record, so the subcommands work against
/// them from another shell. Returns what to keep alive while attached.
pub(super) struct AttachedRun {
    _supervisor_lock: File,
    pub(super) job: Arc<Job>,
}

pub(super) fn begin_attached(instance: &Instance) -> Result<AttachedRun> {
    instance.ensure_artifact_dir()?;
    stop_processes(instance);
    let supervisor_lock = take_supervisor_lock(instance)?;
    write_job(&job_path(instance), &JobRecord::new(JobKind::Up, None))?;
    let job = Job::begin(instance, JobKind::Up)?;
    Ok(AttachedRun {
        _supervisor_lock: supervisor_lock,
        job,
    })
}

impl AttachedRun {
    pub(super) fn finish<T>(&self, result: Result<T>) -> Result<T> {
        self.job.finish(result)
    }
}

/// The JSON a job contributes to `status --json`.
pub(super) fn job_json(instance: &Instance) -> serde_json::Value {
    match read_job(instance) {
        Some(record) => json!(record),
        None => serde_json::Value::Null,
    }
}

/// The inputs to [`stack::Phase`] that come from this module.
pub(super) fn job_state(instance: &Instance) -> Option<(JobKind, JobStatus, bool)> {
    read_job(instance).map(|r| (r.kind, r.status, job_alive(instance)))
}
