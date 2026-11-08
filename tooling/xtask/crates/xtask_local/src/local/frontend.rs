//! Frontend dev-server orchestration: generate the instance env, wait for the
//! backend to be reachable through the proxy, then launch Vite pointed
//! at the proxy origin.

use std::fs::{File, TryLockError};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use anyhow::{Context, Result};

use super::instance::{Instance, Port};
use super::{Mode, proxy, repo_root, stage::Stage};

/// How long Vite gets to serve. Cold starts may rebuild optimized Wasm packages
/// before it launches.
pub const STARTUP_TIMEOUT: Duration = Duration::from_secs(180);

/// Vite's output, kept across the whole dev server's life for `run_local logs`.
pub fn log_path(instance: &Instance) -> PathBuf {
    instance.artifact_dir().join("run/frontend.log")
}

fn pid_path(instance: &Instance) -> PathBuf {
    instance.artifact_dir().join("run/frontend.pid")
}

/// Preloaded into Vite's node: turns stdin EOF, which comes when the process
/// holding the pipe dies, into SIGTERM, which Vite handles by closing its server.
/// Vite listens for stdin `end` itself but never resumes the paused stream, so
/// on a pipe that event never fires.
const EXIT_ON_STDIN_EOF: &str = "data:text/javascript,\
    process.stdin.on('end',()=>process.kill(process.pid,'SIGTERM'));\
    process.stdin.resume();";

fn vite_bin() -> PathBuf {
    repo_root().join("node_modules/vite/bin/vite.js")
}

/// Stops a Vite left behind by a supervisor that died before the pipe could
/// stop it (one started before Vite had [`EXIT_ON_STDIN_EOF`]). The recorded
/// pid is only signalled while it still runs this repository's Vite, so a pid
/// reused by an unrelated process is left alone.
pub fn stop_recorded(instance: &Instance) {
    let Some(pid) = read_pid(instance).and_then(|pid| pid.trim().parse::<i32>().ok()) else {
        return;
    };
    let runs_vite = || {
        std::fs::read(format!("/proc/{pid}/cmdline")).is_ok_and(|cmdline| {
            cmdline
                .split(|byte| *byte == 0)
                .any(|arg| Path::new(std::ffi::OsStr::from_bytes(arg)) == vite_bin())
        })
    };
    if !runs_vite() {
        return;
    }
    // SAFETY: plain kill(2) on the group Vite leads (it is spawned with
    // process_group(0)); ESRCH is harmless when it already exited.
    unsafe {
        libc::kill(-pid, libc::SIGTERM);
    }
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while runs_vite() && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
    }
    if runs_vite() {
        // SAFETY: as above.
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
    }
}

/// The pid of the latest Vite, recorded once it is serving.
pub fn read_pid(instance: &Instance) -> Option<String> {
    std::fs::read_to_string(pid_path(instance)).ok()
}
const BUILD_LOCK_FILE: &str = ".frontend-build.lock";

/// The app dir where the Vite dev server runs.
fn app_dir() -> std::path::PathBuf {
    repo_root().join("apps/web")
}

/// Serialize frontend builds within one checkout. Every instance there shares
/// the generated wasm packages and `apps/web/dist`, and their builds check and
/// then write without coordinating, so two instances building at once read
/// each other's half-written files (wasm-opt fails with "error parsing wasm").
/// The lock releases when the returned file drops.
fn lock_checkout_build(stage: &Stage) -> Result<Option<File>> {
    if stage.is_dry_run() {
        return Ok(None);
    }
    lock_build_in(&repo_root().join("infra/local/generated"), || {
        stage.note("another instance in this checkout is building the frontend; waiting for it");
    })
    .map(Some)
}

fn lock_build_in(dir: &Path, on_wait: impl FnOnce()) -> Result<File> {
    std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    let path = dir.join(BUILD_LOCK_FILE);
    let file = File::create(&path).with_context(|| format!("creating {}", path.display()))?;
    match file.try_lock() {
        Ok(()) => return Ok(file),
        Err(TryLockError::WouldBlock) => on_wait(),
        Err(TryLockError::Error(error)) => {
            return Err(error).with_context(|| format!("locking {}", path.display()));
        }
    }
    file.lock()
        .with_context(|| format!("locking {}", path.display()))?;
    Ok(file)
}

fn prepare_dependencies(stage: &Stage) -> Result<()> {
    let mut prepare = Command::new("bun");
    prepare.current_dir(app_dir()).args(["run", "dev:prepare"]);
    stage.run("Preparing frontend dependencies", &mut prepare)
}

/// Host-facing frontend URL.
pub fn url(instance: &Instance) -> String {
    format!("http://localhost:{}/app", instance.port(Port::Frontend))
}

/// Browser-facing origin for development redirects and integration callbacks.
pub fn https_origin(instance: &Instance) -> Result<String> {
    Ok(format!(
        "https://{}:{}",
        super::tls::hostname()?,
        instance.port(Port::Proxy)
    ))
}

/// Browser-facing development URL, using the machine certificate and proxy.
pub fn https_url(instance: &Instance) -> Result<String> {
    Ok(format!("{}/app/", https_origin(instance)?))
}

/// Frontend URL when the proxy serves the static bundle (headless stacks): the
/// app lives on the single proxy origin, not a dev-server port.
pub fn static_url(instance: &Instance) -> String {
    format!("{}/app/", proxy::url(instance))
}

/// Where the instance's static frontend build is staged. Mounted read-only into
/// the proxy container at `/srv/frontend` (see `gen_compose::add_proxy_service`).
/// Staged per instance — not served from `dist/` directly — so concurrent
/// instances in one checkout can't clobber each other's running frontend, and a
/// later `bun run build` can't mutate a live stack out from under itself.
pub fn static_dir(instance: &Instance) -> std::path::PathBuf {
    instance.artifact_dir().join("frontend")
}

/// Build the app bundle for headless serving and stage it into the instance
/// dir. The build mirrors `just build-dev`
/// (dev-mode bundle, production optimizations), except the backend origin is
/// the `same-origin` sentinel — resolved from `location.origin` at runtime — so
/// the one bundle works on localhost and through any tunneled hostname.
///
/// Setting `VITE_LOCAL_BACKEND_ORIGIN` also keeps `import.meta.env.DEV` true
/// in the static bundle (see `keepImportMetaDev` in apps/web/scripts). `vite build`
/// otherwise compiles DEV from `NODE_ENV=production`, which drops local-only
/// paths such as passwordless auto-login (`just run_local` uses `vite serve`,
/// where DEV is already true). Headless `stack up` sets the same origin env.
///
/// `VITE_LOCAL_ONLY` makes the bundle count as local, as the dev server does
/// through `import.meta.hot`, so local-only flags, routes and tools match
/// `just run_local`.
pub fn build_static(stage: &Stage, instance: &Instance, mode: Mode) -> Result<()> {
    // Held through staging: `dist/` is shared until it's copied out.
    let _build_lock = lock_checkout_build(stage)?;
    prepare_dependencies(stage)?;
    let dist = {
        let mut cmd = Command::new("bun");
        cmd.current_dir(app_dir())
            .args(["run", "--bun", "build"])
            .env("MODE", "development")
            .env("NODE_ENV", "production")
            .env("VITE_LOCAL_SERVERS", "ALL")
            .env("VITE_LOCAL_BACKEND_ORIGIN", "same-origin")
            .env("VITE_LOCAL_ONLY", "true");
        if mode.spec().runs_local_infra {
            cmd.env("VITE_AI_EDITING_WORKER_URL", "/ai-editing");
        }
        stage.run("Building frontend bundle", &mut cmd)?;
        app_dir().join("dist")
    };
    if stage.is_dry_run() {
        return Ok(());
    }
    if !dist.join("index.html").exists() {
        anyhow::bail!(
            "no index.html in {} — frontend build did not produce a bundle",
            dist.display()
        );
    }
    stage.run_step("Staging frontend bundle", || {
        let staged = static_dir(instance);
        if staged.exists() {
            std::fs::remove_dir_all(&staged)
                .with_context(|| format!("clearing {}", staged.display()))?;
        }
        instance.ensure_artifact_dir()?;
        let status = Command::new("cp")
            .arg("-a")
            .arg(&dist)
            .arg(&staged)
            .status()
            .context("running cp -a")?;
        anyhow::ensure!(status.success(), "cp -a exited with {status}");
        Ok(())
    })
}

/// The env the dev server runs with. Both local and dev point the whole app at
/// the Vite origin, which forwards backend routes to the instance proxy. The
/// modes differ in what the services talk to (local infra vs dev resources).
///
/// When a trace collector is up (`--traces`), point the OTel exporter at the
/// analytics-proxy through the same proxy origin (`/i/otlp`), so tracing works
/// for any instance (named instances have no host-port binding for the proxy)
/// and exercises the real browser -> proxy -> collector path. Left unset
/// otherwise. This overrides the bare-dev defaults in apps/web/.env.local
/// (Vite lets process env win).
fn dev_env(instance: &Instance, mode: Mode, traces_enabled: bool) -> Result<Vec<(String, String)>> {
    let mut env = vec![
        (
            "PORT".to_string(),
            instance.port(Port::Frontend).to_string(),
        ),
        ("VITE_LOCAL_SERVERS".to_string(), "ALL".to_string()),
        ("MACRO_LOCAL_HOSTNAME".to_string(), super::tls::hostname()?),
        (
            "NODE_EXTRA_CA_CERTS".to_string(),
            proxy::ca_pem().display().to_string(),
        ),
        (
            "VITE_LOCAL_BACKEND_ORIGIN".to_string(),
            "same-origin".to_string(),
        ),
        (
            "MACRO_LOCAL_BACKEND_PROXY".to_string(),
            proxy::url(instance),
        ),
        (
            "MACRO_LOCAL_BACKEND_ROUTES".to_string(),
            proxy::frontend_path_prefixes().join(","),
        ),
    ];
    if mode.spec().runs_local_infra {
        env.push((
            "VITE_AI_EDITING_WORKER_URL".to_string(),
            "/ai-editing".to_string(),
        ));
    }
    if traces_enabled {
        env.push((
            "VITE_OTEL_EXPORTER_URL".to_string(),
            "/i/otlp/v1/traces".to_string(),
        ));
        // Tag frontend telemetry with the same env the Datadog agent uses
        // (DD_ENV, default `local`), so the summary's traces/logs links —
        // filtered by that env — actually match the emitted spans/records.
        env.push((
            "VITE_OTEL_ENV".to_string(),
            macro_env_var::maybe_read_env("DD_ENV").unwrap_or_else(|| "local".into()),
        ));
    }
    env.push((
        "VITE_ENABLE_BROWSER_OTEL".to_string(),
        traces_enabled.to_string(),
    ));
    Ok(env)
}

/// Poll the backend (auth health, through the proxy) until ready.
pub fn wait_backend_ready(stage: &Stage, instance: &Instance) -> Result<()> {
    let url = format!("{}/auth/health", proxy::url(instance));
    let cacert = proxy::ca_pem();
    let script = format!(
        "for i in $(seq 1 600); do curl -fsS --cacert '{cacert}' --max-time 3 {url} >/dev/null 2>&1 && exit 0; sleep 0.2; done; echo 'backend not ready'; exit 1",
        cacert = cacert.display()
    );
    let mut cmd = Command::new("bash");
    cmd.arg("-lc").arg(script);
    stage.run("Waiting for backend (proxy /auth/health)", &mut cmd)
}

/// A listening Vite port does not prove the containerized proxy can reach it.
/// Verify the browser's route before announcing that the stack is ready.
fn wait_frontend_proxy_ready(stage: &Stage, instance: &Instance) -> Result<()> {
    let mut cmd = Command::new("curl");
    cmd.args([
        "--fail",
        "--silent",
        "--show-error",
        "--retry",
        "8",
        "--retry-connrefused",
        "--retry-delay",
        "1",
        "--retry-max-time",
        "45",
        "--max-time",
        "5",
        "--output",
        "/dev/null",
        "--cacert",
    ])
    .arg(proxy::ca_pem())
    .arg(format!("{}/app/", proxy::url(instance)));
    stage
        .run("Checking frontend through HTTPS proxy", &mut cmd)
        .with_context(|| {
            format!(
                "HTTPS proxy could not serve the frontend. Check proxy logs and Docker-to-host \
                 firewall access to host.docker.internal:{} (Vite's port). \
                 Direct Vite URL: {}",
                instance.port(Port::Frontend),
                url(instance)
            )
        })
}

/// A running frontend dev server. Its output goes to a log file, so an
/// unexpected exit can be explained and `run_local logs` can read it.
pub struct Frontend {
    pub process: FrontendProcess,
    command: Command,
    port: u16,
    log: PathBuf,
    pid_file: PathBuf,
}

/// One dev-server process, replaced on restart.
pub struct FrontendProcess {
    pub child: Child,
}

impl Frontend {
    /// Restart only Vite, preserving the command, environment, and instance port.
    /// Killing the old process group also recovers a stuck in-process reload.
    pub fn restart(&mut self, stage: &Stage) -> Result<()> {
        self.shutdown();
        self.process = spawn(stage, &mut self.command, self.port, &self.log)?;
        record_pid(&self.pid_file, &self.process);
        Ok(())
    }

    /// Stop the current dev-server process group.
    pub fn shutdown(&mut self) {
        self.process.shutdown();
    }

    /// Return the last output from an exited dev server.
    pub fn tail_output(&mut self, lines: usize) -> String {
        tail_of_log(&self.log, lines)
    }
}

/// Best effort: only a later `restart-frontend` reads it, to see the restart land.
fn record_pid(path: &Path, process: &FrontendProcess) {
    let _ = std::fs::write(path, process.child.id().to_string());
}

fn tail_of_log(log: &Path, lines: usize) -> String {
    let output = std::fs::read(log).unwrap_or_default();
    tail_str(&String::from_utf8_lossy(&output), lines)
}

impl FrontendProcess {
    /// Stop the dev server and all its children. We put Vite and its children
    /// in their own process group at spawn — so signal the
    /// GROUP (negative pid). SIGKILL is enough: the kernel releases the port the
    /// moment the processes die. Then reap Vite.
    pub fn shutdown(&mut self) {
        if matches!(self.child.try_wait(), Ok(None)) {
            let pgid = self.child.id() as i32;
            // SAFETY: a plain `kill(2)`; an invalid/already-dead group is a harmless
            // ESRCH. The negative pid targets the whole process group.
            unsafe {
                libc::kill(-pgid, libc::SIGKILL);
            }
        }
        let _ = self.child.wait();
    }
}

impl Drop for FrontendProcess {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn tail_str(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

/// Start the frontend dev server and wait until *our* child is serving. Output
/// goes to [`log_path`] (the vite banner would duplicate the summary's URL), so
/// an unexpected exit can be diagnosed. Callers have already waited for the
/// backend. Returns `None` in dry-run mode.
pub fn start(
    stage: &Stage,
    instance: &Instance,
    mode: Mode,
    traces_enabled: bool,
) -> Result<Option<Frontend>> {
    if stage.is_dry_run() {
        stage.note(&format!(
            "Dry run: would start frontend at {}",
            url(instance)
        ));
        return Ok(None);
    }
    let port = instance.port(Port::Frontend);
    // A successful connect means something is already listening — almost
    // certainly a stale dev server from a previous run. (A bind probe can miss
    // it; see `accepting`.) Bail clearly rather than spawn a bun that can't
    // bind and dies with a confusing late "exited (status 1)".
    if xtask_ports::probe::accepting(port, std::time::Duration::from_millis(300)) {
        anyhow::bail!(
            "frontend port {port} is already in use — likely a stale dev server from a \
             previous run. Free it (`lsof -ti tcp:{port} | xargs kill`) and retry."
        );
    }
    {
        let _build_lock = lock_checkout_build(stage)?;
        prepare_dependencies(stage)?;
    }

    // Vite's node-http-proxy WebSocket upgrades hang under Bun (including
    // 1.3.13). Use Node for the dev server, while keeping Bun for dependencies
    // and builds: https://github.com/oven-sh/bun/issues/10441.
    let mut cmd = Command::new("node");
    cmd.current_dir(app_dir())
        .args(["--import", EXIT_ON_STDIN_EOF])
        .arg(vite_bin())
        .args(["-c", "vite.config.ts"])
        // Run Vite directly in its OWN process group. Avoiding the `bun run`
        // package-script wrapper keeps the listener in the process we own.
        .process_group(0)
        // Open-but-empty stdin (piped, held open, never written): vite sees a
        // non-TTY stdin so it won't bind its own keypress shortcuts (no fight
        // with our hotkey loop). When this process dies, however it dies, the
        // pipe closes and EXIT_ON_STDIN_EOF stops Vite instead of leaving it
        // holding the port.
        .stdin(Stdio::piped());
    for (k, v) in dev_env(instance, mode, traces_enabled)? {
        cmd.env(k, v);
    }
    instance.ensure_artifact_dir()?;
    let log = log_path(instance);
    let pid_file = pid_path(instance);
    if let Some(dir) = log.parent() {
        std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    }
    let process = spawn(stage, &mut cmd, port, &log)?;
    record_pid(&pid_file, &process);
    wait_frontend_proxy_ready(stage, instance)?;
    Ok(Some(Frontend {
        process,
        command: cmd,
        port,
        log,
        pid_file,
    }))
}

fn spawn(stage: &Stage, cmd: &mut Command, port: u16, log: &Path) -> Result<FrontendProcess> {
    let output =
        std::fs::File::create(log).with_context(|| format!("creating {}", log.display()))?;
    cmd.stdout(output.try_clone()?).stderr(output);

    // stdin is intentionally NOT taken — its write end stays open in `Child` so
    // Vite never sees stdin EOF while we live.
    let mut child = cmd.spawn().context("launching the Vite dev server")?;

    // Wait until OUR child is serving: poll the port, but fail fast (with Vite's
    // output) if the child exits first. A bare port poll would mistake a stale
    // server already on the port for "ready" while our child has died.
    let startup = stage.run_step("Starting frontend", || {
        let deadline = std::time::Instant::now() + STARTUP_TIMEOUT;
        while std::time::Instant::now() < deadline {
            // Settle first: a failed bind (e.g. port already in use) makes vite
            // exit near-instantly, so if the child is still alive after this it
            // genuinely bound the port — rather than us connecting to a stale
            // server squatting it.
            std::thread::sleep(std::time::Duration::from_millis(300));
            if let Some(status) = child.try_wait()? {
                anyhow::bail!(
                    "frontend dev server exited during startup ({status})\n\
                     (if the port is in use, free it: `lsof -ti tcp:{port} | xargs kill`)"
                );
            }
            if xtask_ports::probe::accepting(port, std::time::Duration::from_millis(300)) {
                return Ok(());
            }
        }
        anyhow::bail!(
            "frontend dev server did not become ready after {} seconds",
            STARTUP_TIMEOUT.as_secs()
        )
    });

    if let Err(error) = startup {
        let pgid = child.id() as i32;
        // SAFETY: the child leads the process group created above. ESRCH is
        // harmless when Vite already exited.
        unsafe {
            libc::kill(-pgid, libc::SIGKILL);
        }
        let _ = child.wait();
        let out = tail_of_log(log, 30);
        anyhow::bail!("{error}\nfrontend output (last lines):\n{out}");
    }

    Ok(FrontendProcess { child })
}

#[cfg(test)]
mod test;
