//! Frontend dev-server orchestration: generate the instance env, wait for the
//! backend to be reachable through the proxy, then launch Vite pointed
//! at the proxy origin.

use std::io::Read;
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use anyhow::{Context, Result};

use super::instance::{Instance, Port};
use super::{Mode, proxy, repo_root, stage::Stage};

/// The app dir where the Vite dev server runs.
fn app_dir() -> std::path::PathBuf {
    repo_root().join("apps/web")
}

/// Host-facing frontend URL.
pub fn url(instance: &Instance) -> String {
    format!("http://localhost:{}/app", instance.port(Port::Frontend))
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
pub fn build_static(stage: &Stage, instance: &Instance, mode: Mode) -> Result<()> {
    let dist = {
        let mut cmd = Command::new("bun");
        cmd.current_dir(app_dir())
            .args(["run", "--bun", "build"])
            .env("MODE", "development")
            .env("NODE_ENV", "production")
            .env("VITE_LOCAL_SERVERS", "ALL")
            .env("VITE_LOCAL_BACKEND_ORIGIN", "same-origin");
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
/// the local proxy origin (single backend origin); the modes differ only in
/// what the *services* behind the proxy talk to (local infra vs dev resources).
///
/// When a trace collector is up (`--traces`), point the OTel exporter at the
/// analytics-proxy through the same proxy origin (`/i/otlp`), so tracing works
/// for any instance (named instances have no host-port binding for the proxy)
/// and exercises the real browser -> proxy -> collector path. Left unset
/// otherwise. This overrides the bare-dev defaults in apps/web/.env.local
/// (Vite lets process env win).
fn dev_env(
    instance: &Instance,
    mode: Mode,
    traces_enabled: bool,
    enable_onboarding: bool,
) -> Vec<(String, String)> {
    let mut env = vec![
        (
            "PORT".to_string(),
            instance.port(Port::Frontend).to_string(),
        ),
        ("VITE_LOCAL_SERVERS".to_string(), "ALL".to_string()),
        (
            "VITE_LOCAL_BACKEND_ORIGIN".to_string(),
            proxy::url(instance),
        ),
    ];
    if mode.spec().runs_local_infra {
        env.push((
            "VITE_AI_EDITING_WORKER_URL".to_string(),
            format!("{}/ai-editing", proxy::url(instance)),
        ));
    }
    if traces_enabled {
        env.push((
            "VITE_OTEL_EXPORTER_URL".to_string(),
            format!("{}/i/otlp/v1/traces", proxy::url(instance)),
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
    // Existing override: always set so the app's DEV_MODE default (on) does
    // not win. `just run_local --enable-onboarding` is the opt-in.
    env.push((
        "VITE_ENABLE_ONBOARDING_V4".to_string(),
        enable_onboarding.to_string(),
    ));
    env
}

/// Poll the backend (auth health, through the proxy) until ready.
pub fn wait_backend_ready(stage: &Stage, instance: &Instance) -> Result<()> {
    let url = format!("{}/auth/health", proxy::url(instance));
    let script = format!(
        "for i in $(seq 1 60); do curl -fsS --max-time 3 {url} >/dev/null 2>&1 && exit 0; sleep 2; done; echo 'backend not ready'; exit 1"
    );
    let mut cmd = Command::new("bash");
    cmd.arg("-lc").arg(script);
    stage.run("Waiting for backend (proxy /auth/health)", &mut cmd)
}

/// A running frontend dev server plus its captured output, so an unexpected
/// exit can be explained (the output is otherwise suppressed).
pub struct Frontend {
    pub child: Child,
    captured: Arc<Mutex<Vec<u8>>>,
    drains: Vec<JoinHandle<()>>,
}

impl Frontend {
    /// Stop the dev server and all its children. `bun run dev` spawns Vite (and
    /// friends), which we put in their own process group at spawn — so signal the
    /// GROUP (negative pid). SIGKILL is enough: the kernel releases the port the
    /// moment the processes die. Then reap `bun` and join the drain threads (their
    /// pipes close, so they exit).
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
        for h in self.drains.drain(..) {
            let _ = h.join();
        }
    }

    /// Join the drain threads and return the last `lines` lines of the dev
    /// server's captured output (for diagnosing why it exited).
    pub fn tail_output(&mut self, lines: usize) -> String {
        for h in self.drains.drain(..) {
            let _ = h.join();
        }
        let buf = self.captured.lock().unwrap_or_else(|e| e.into_inner());
        tail_str(&String::from_utf8_lossy(&buf), lines)
    }
}

impl Drop for Frontend {
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
/// is captured (suppressed — the vite banner would duplicate the summary's URL)
/// but retained so an unexpected exit can be diagnosed. Returns `None` in
/// dry-run mode.
pub fn start(
    stage: &Stage,
    instance: &Instance,
    mode: Mode,
    traces_enabled: bool,
    enable_onboarding: bool,
) -> Result<Option<Frontend>> {
    if mode.spec().wait_backend_before_frontend {
        wait_backend_ready(stage, instance)?;
    }
    if stage.is_dry_run() {
        stage.note(&format!(
            "Dry run: would start frontend at {}",
            url(instance)
        ));
        return Ok(None);
    }
    let port = instance.port(Port::Frontend);
    // A successful connect means something is already listening — almost
    // certainly a stale dev server from a previous run. (A bind probe is
    // unreliable: std's TcpListener sets SO_REUSEADDR, so it binds right
    // alongside the squatter.) Bail clearly rather than spawn a bun that can't
    // bind and dies with a confusing late "exited (status 1)".
    if std::net::TcpStream::connect_timeout(
        &([127, 0, 0, 1], port).into(),
        std::time::Duration::from_millis(300),
    )
    .is_ok()
    {
        anyhow::bail!(
            "frontend port {port} is already in use — likely a stale dev server from a \
             previous run. Free it (`lsof -ti tcp:{port} | xargs kill`) and retry."
        );
    }
    let mut prepare = Command::new("bash");
    prepare.current_dir(app_dir()).args([
        "-lc",
        "just ensure-cache-wasm && just ensure-agent-fold-wasm",
    ]);
    stage.run("Preparing frontend dependencies", &mut prepare)?;

    let mut cmd = Command::new("bun");
    cmd.current_dir(app_dir())
        .arg(repo_root().join("node_modules/vite/bin/vite.js"))
        .args(["-c", "vite.config.ts"])
        // Run Vite directly in its OWN process group. Avoiding the `bun run`
        // package-script wrapper keeps the listener in the process we own.
        .process_group(0)
        // Open-but-empty stdin (piped, held open, never written): vite sees a
        // non-TTY stdin so it won't bind its own keypress shortcuts (no fight
        // with our hotkey loop), but it never reaches EOF — Stdio::null is EOF
        // immediately, which makes vite shut itself down right after boot.
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in dev_env(instance, mode, traces_enabled, enable_onboarding) {
        cmd.env(k, v);
    }
    let mut child = cmd.spawn().context("launching `bun run dev`")?;

    // Drain stdout+stderr into a buffer on their own threads (a full pipe would
    // otherwise block bun); the output stays hidden unless the server exits.
    // stdin is intentionally NOT taken — its write end stays open so bun never
    // sees stdin EOF.
    let captured = Arc::new(Mutex::new(Vec::new()));
    let mut drains = Vec::new();
    if let Some(mut out) = child.stdout.take() {
        let buf = Arc::clone(&captured);
        drains.push(std::thread::spawn(move || drain_into(&mut out, &buf)));
    }
    if let Some(mut err) = child.stderr.take() {
        let buf = Arc::clone(&captured);
        drains.push(std::thread::spawn(move || drain_into(&mut err, &buf)));
    }

    // Wait until OUR child is serving: poll the port, but fail fast (with bun's
    // output) if the child exits first. A bare port poll would mistake a stale
    // server already on the port for "ready" while our child has died.
    let addr: std::net::SocketAddr = ([127, 0, 0, 1], port).into();
    let startup = stage.run_step("Starting frontend", || {
        // Cold starts may rebuild optimized Wasm packages before Vite launches.
        for _ in 0..600 {
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
            if std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(300))
                .is_ok()
            {
                return Ok(());
            }
        }
        anyhow::bail!("frontend dev server did not become ready after 180 seconds")
    });

    if let Err(error) = startup {
        let pgid = child.id() as i32;
        // SAFETY: the child leads the process group created above. ESRCH is
        // harmless when Bun already exited.
        unsafe {
            libc::kill(-pgid, libc::SIGKILL);
        }
        let _ = child.wait();
        for handle in drains.drain(..) {
            let _ = handle.join();
        }
        let out = tail_str(&String::from_utf8_lossy(&captured.lock().unwrap()), 30);
        anyhow::bail!("{error}\nfrontend output (last lines):\n{out}");
    }

    Ok(Some(Frontend {
        child,
        captured,
        drains,
    }))
}

/// Copy a child pipe into the shared capture buffer until EOF.
fn drain_into(reader: &mut impl Read, buf: &Mutex<Vec<u8>>) {
    let mut chunk = [0u8; 4096];
    while let Ok(n) = reader.read(&mut chunk) {
        if n == 0 {
            break;
        }
        if let Ok(mut b) = buf.lock() {
            b.extend_from_slice(&chunk[..n]);
        }
    }
}
