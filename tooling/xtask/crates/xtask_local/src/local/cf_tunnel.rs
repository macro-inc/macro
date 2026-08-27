//! Cloudflare quick tunnels: opt-in public ingress into a local stack.
//!
//! Nothing here runs unless `--with-cf-tunnel` is passed — a plain `run_local`
//! never dials out. With the flag, two tunnels open:
//!
//! - **egress**: a `@cursor` session runs on cursor.com, not in the compose
//!   network, and the MCP servers the harness hands it point at
//!   `EGRESS_BASE_URL`. In-network that URL is
//!   `http://agent-harness-service:8102`, which means nothing to Cursor's VM —
//!   so the tunnel targets the instance's published egress port and
//!   `EGRESS_BASE_URL` resolves to the minted `https://….trycloudflare.com`
//!   hostname instead.
//! - **app**: the single-origin reverse proxy (Caddy), so the whole running
//!   product can be shared with someone who is not on this machine. The proxy
//!   — not the Vite dev server — is the only target that works remotely: the
//!   dev bundle calls the backend on an absolute `localhost:<proxy>` origin
//!   (`VITE_LOCAL_BACKEND_ORIGIN`), which a remote browser cannot reach. The
//!   share therefore serves the headless static bundle through the proxy,
//!   built against the `same-origin` sentinel, so every API and WebSocket call
//!   follows whatever hostname the visitor loaded the page from.
//!
//! *Quick* tunnels deliberately: no account, no DNS record, a fresh random
//! hostname per run — which is fine because the env is regenerated per run
//! too, so nothing can go stale. The trade is that local sandboxes now also
//! reach the proxy out through Cloudflare and back; one extra hop on a dev
//! stack, and one URL both renderings agree on.
//!
//! Same lifecycle as the SDK webhook tunnel: started before the env is
//! resolved (the egress URL has to be known to be written into it), pid-filed
//! per tunnel name so the next run reaps a leaked one, and killed when the
//! guard drops.

use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use anyhow::{Context, Result, bail};

use super::instance::Instance;

#[cfg(test)]
mod test;

/// How long the quick tunnel gets to mint its hostname. Ordinarily it takes a
/// couple of seconds; well past this it is not coming (no network, Cloudflare
/// unreachable), and the caller downgrades to localhost-only with a warning.
const HOSTNAME_DEADLINE: Duration = Duration::from_secs(30);

/// A running quick tunnel. Dropping it kills the `cloudflared` process, which
/// is what tears the public hostname down.
pub struct QuickTunnel {
    child: Child,
    /// The minted public origin, e.g. `https://odds-and-ends.trycloudflare.com`.
    pub url: String,
}

impl Drop for QuickTunnel {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Where the tunnel's pid is recorded, keyed by name so the egress and app
/// tunnels reap independently.
fn pid_path(instance: &Instance, name: &str) -> PathBuf {
    instance.artifact_dir().join(format!("{name}-tunnel.pid"))
}

/// Open a named quick tunnel to a local port and wait for the minted hostname.
/// Reaps a same-named tunnel leaked by a previous run first, so at most one
/// per (instance, name) exists.
pub fn open(instance: &Instance, name: &str, port: u16) -> Result<QuickTunnel> {
    reap_stale(instance, name);
    let mut child = Command::new("cloudflared")
        .args([
            "tunnel",
            "--no-autoupdate",
            "--url",
            &format!("http://localhost:{port}"),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .context("starting cloudflared (is it in the dev shell?)")?;

    let stderr = child
        .stderr
        .take()
        .context("cloudflared spawned without a stderr pipe")?;

    match await_hostname(stderr) {
        Ok(url) => {
            let _ = std::fs::write(pid_path(instance, name), child.id().to_string());
            Ok(QuickTunnel { child, url })
        }
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(error)
        }
    }
}

/// Kill a previously started tunnel, if one leaked past its process.
fn reap_stale(instance: &Instance, name: &str) {
    let path = pid_path(instance, name);
    let Some(pid) = std::fs::read_to_string(&path)
        .ok()
        .and_then(|p| p.trim().parse::<i32>().ok())
    else {
        return;
    };
    let _ = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status();
    let _ = std::fs::remove_file(path);
}

/// Read cloudflared's log until the quick-tunnel hostname appears.
///
/// The reader thread outlives this function on purpose: cloudflared keeps
/// logging for the life of the tunnel, and a pipe nobody drains eventually
/// blocks the process, which would take the tunnel down mid-run. After the
/// hostname is found the same thread keeps draining to the sink.
fn await_hostname(stderr: impl Read + Send + 'static) -> Result<String> {
    let (found, hostname) = mpsc::channel::<Option<String>>();
    std::thread::spawn(move || {
        let mut looking = true;
        for line in BufReader::new(stderr).lines() {
            let Ok(line) = line else { break };
            if looking && let Some(url) = quick_tunnel_url(&line) {
                looking = false;
                let _ = found.send(Some(url));
            }
        }
        // EOF with no hostname: cloudflared died. Unblock the wait so the
        // caller reports that instead of sitting out the whole deadline.
        let _ = found.send(None);
    });

    match hostname.recv_timeout(HOSTNAME_DEADLINE) {
        Ok(Some(url)) => Ok(url),
        Ok(None) => bail!("cloudflared exited before minting a quick-tunnel hostname"),
        Err(mpsc::RecvTimeoutError::Timeout) => bail!(
            "cloudflared did not mint a quick-tunnel hostname within {}s",
            HOSTNAME_DEADLINE.as_secs()
        ),
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            bail!("cloudflared's log reader stopped before a hostname appeared")
        }
    }
}

/// The quick-tunnel origin in one of cloudflared's log lines, if this line
/// carries it. The line looks like
/// `2026-08-27T00:00:00Z INF |  https://odds-and-ends.trycloudflare.com  |`.
fn quick_tunnel_url(line: &str) -> Option<String> {
    line.split_whitespace()
        .find(|token| token.starts_with("https://") && token.ends_with(".trycloudflare.com"))
        .map(str::to_owned)
}
