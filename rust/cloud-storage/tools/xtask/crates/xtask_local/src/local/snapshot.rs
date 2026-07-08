//! Content-addressed snapshots of the stack's *initialized* infra state.
//!
//! A cold bring-up pays for the expensive one-time init — DB migrations, the
//! FusionAuth kickstart (~a minute), OpenSearch index creation. That state is
//! fully determined by a small set of inputs (the migrations, the generated
//! kickstart, the index mappings, the infra image pins, the container
//! platform), so instead of re-running the init on every `stack up`, we key
//! it: hash the inputs, and if
//! a snapshot of the stateful volumes exists under that key, restore it
//! and skip the init entirely. The full-delete/full-create idempotency
//! guarantee survives because the key *is* the definition of "clean" — any
//! change to an input misses the cache and falls back to a real init (which
//! then saves the new snapshot).
//!
//! Snapshots are tarballs of the Docker volumes, written by a throwaway helper
//! container, stored under `infra/local/generated/.snapshots/<key>/` (override
//! with `MACRO_STACK_SNAPSHOT_DIR` — CI bakes this dir into preview images).

use std::path::PathBuf;
use std::process::Command;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::instance::Instance;
use super::stage::Stage;
use super::{env_layer, fusionauth, gen_compose, repo_root, workspace_root};

/// Bump when the snapshot mechanism itself changes shape (archive layout,
/// volume set) so old snapshots can't be restored into a new scheme.
/// 2: Kafka's volume joined the set (topics live in the broker data dir, so a
/// restore carries them and the rdkafka-backed provisioning is skipped).
/// 3: invalidates snapshots saved while the FusionAuth kickstart could still
/// be mid-flight (the readiness gate only checked `/api/status`, so a save
/// could freeze a tenant-less FusionAuth DB — and the key never changed, so
/// the bad snapshot was sticky).
const FORMAT: u32 = 3;

/// The throwaway container image used to tar/untar volumes. Alpine for its
/// size; only needs `tar` + `sh`.
const HELPER_IMAGE: &str = "alpine:3";

/// The stateful volumes a snapshot captures, as `(archive name, volume)`
/// pairs. Redis is deliberately absent — it's a cache, and an empty cache is
/// valid clean state.
fn archives(instance: &Instance) -> [(&'static str, String); 5] {
    [
        ("postgres.tar.gz", instance.volume_postgres()),
        ("opensearch.tar.gz", instance.volume_opensearch()),
        ("kafka.tar.gz", instance.volume_kafka()),
        ("fusionauth-db.tar.gz", instance.volume_fusionauth_db()),
        (
            "fusionauth-config.tar.gz",
            instance.volume_fusionauth_config(),
        ),
    ]
}

/// The compose services that own those volumes — quiesced (stopped) while the
/// archives are written so the files are consistent.
const STATEFUL_SERVICES: &[&str] = &["postgres", "search", "kafka", "fusionauth", "db"];

/// Where snapshots live. `MACRO_STACK_SNAPSHOT_DIR` overrides for CI bakes and
/// preview images; the default sits inside the gitignored generated dir.
// xtask is host tooling, not a service reading APP_SECRETS_JSON, so reading the
// process environment directly is correct here.
#[allow(clippy::disallowed_methods)]
pub fn root_dir() -> PathBuf {
    std::env::var_os("MACRO_STACK_SNAPSHOT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| repo_root().join("infra/local/generated/.snapshots"))
}

/// What a snapshot directory contains, recorded alongside the archives.
#[derive(Serialize, Deserialize)]
struct Manifest {
    format: u32,
    key: String,
    created_unix: u64,
    archives: Vec<String>,
}

/// A resolved snapshot decision for one instance: the content key and where
/// that key's snapshot would live. `exists()` says which way `up` goes.
pub struct Plan {
    pub key: String,
    pub dir: PathBuf,
}

impl Plan {
    /// Hash the init-defining inputs. Must be called after `prepare` (the
    /// generated kickstart is one of the inputs — it encodes the instance's
    /// ports, so a snapshot can never be restored into an instance whose
    /// FusionAuth config wouldn't match).
    pub fn compute(instance: &Instance) -> Result<Plan> {
        let mut h = Sha256::new();
        h.update(FORMAT.to_le_bytes());

        // The container platform. Volume bytes are written by arch-specific
        // images (an Apple Silicon Postgres data dir is arm64-born), and while
        // Postgres/Lucene data happens to be portable across amd64/arm64 in
        // practice, that's unsupported territory — keying on the platform makes
        // cross-arch restore a structural cache miss instead of a latent bug
        // if snapshots are ever shared between machines (e.g. an S3 cache).
        // Today each snapshot store is machine-local or CI-baked for
        // same-arch Fly machines, so this is insurance, not a behavior change.
        h.update(super::arch::detect()?.docker_platform.as_bytes());

        // Infra image pins + topology.
        for rel in [
            "docker-compose.yml",
            "docker-compose-databases.yml",
            "infra/stacks/fusionauth-instance/docker-compose.yml",
        ] {
            hash_file(&mut h, &repo_root().join(rel))?;
        }
        // The custom local OpenSearch image inputs.
        hash_dir(&mut h, &repo_root().join("infra/local/opensearch"), &[])?;
        // Database schema.
        hash_dir(
            &mut h,
            &workspace_root().join("macro_db_client/migrations"),
            &[],
        )?;
        // Search index mappings (canonical TS helpers; node_modules excluded).
        hash_dir(
            &mut h,
            &repo_root().join("infra/stacks/opensearch/helpers"),
            &["node_modules"],
        )?;
        // The generated FusionAuth kickstart (identity + this instance's ports).
        hash_file(
            &mut h,
            &gen_compose::kickstart_dir(instance).join("kickstart.json"),
        )?;

        let key = hex(&h.finalize());
        let dir = root_dir().join(&key);
        Ok(Plan { key, dir })
    }

    /// Whether a completed snapshot exists for this key (manifest written last,
    /// so its presence implies the archives are whole).
    pub fn exists(&self) -> bool {
        std::fs::read_to_string(self.dir.join("manifest.json"))
            .ok()
            .and_then(|raw| serde_json::from_str::<Manifest>(&raw).ok())
            .is_some_and(|m| m.format == FORMAT && m.key == self.key)
    }

    /// The first 12 hex chars — enough to name it in output.
    pub fn short_key(&self) -> &str {
        &self.key[..12]
    }
}

/// Unpack the snapshot's archives into the instance's (freshly created, empty)
/// volumes. Runs before the infra containers start.
pub fn restore(stage: &Stage, instance: &Instance, plan: &Plan) -> Result<()> {
    let dir = plan.dir.clone();
    let pairs = archives(instance);
    stage.run_step(
        &format!("Restoring init snapshot ({})", plan.short_key()),
        || {
            for (archive, volume) in &pairs {
                if !dir.join(archive).exists() {
                    bail!("snapshot {} is missing {archive}", dir.display());
                }
                helper_tar(
                    &format!("{volume}:/vol"),
                    &format!("{}:/snap:ro", dir.display()),
                    &format!("tar xzf /snap/{archive} -C /vol"),
                )?;
            }
            Ok(())
        },
    )
}

/// Archive the just-initialized volumes under the plan's key. Called after the
/// infra init and BEFORE the app services start (nothing is connected yet, so
/// the stateful containers can be stopped for a consistent copy and started
/// again). Written to a temp dir and renamed in, so a crash never leaves a
/// half-snapshot that `exists()` would trust.
pub fn save(
    stage: &Stage,
    instance: &Instance,
    env: &env_layer::ResolvedEnv,
    plan: &Plan,
) -> Result<()> {
    let mut stop = super::compose_cmd(instance, env);
    stop.args(["stop", "-t", "30"]).args(STATEFUL_SERVICES);
    stage.run("Quiescing infra for snapshot", &mut stop)?;

    let tmp = root_dir().join(format!(".tmp-{}", plan.key));
    let pairs = archives(instance);
    let write = || -> Result<()> {
        if tmp.exists() {
            std::fs::remove_dir_all(&tmp)?;
        }
        std::fs::create_dir_all(&tmp)?;
        for (archive, volume) in &pairs {
            helper_tar(
                &format!("{volume}:/vol:ro"),
                &format!("{}:/snap", tmp.display()),
                &format!("tar czf /snap/{archive} -C /vol ."),
            )?;
        }
        let manifest = Manifest {
            format: FORMAT,
            key: plan.key.clone(),
            created_unix: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            archives: pairs.iter().map(|(a, _)| a.to_string()).collect(),
        };
        std::fs::write(
            tmp.join("manifest.json"),
            serde_json::to_string_pretty(&manifest)?,
        )?;
        if plan.dir.exists() {
            std::fs::remove_dir_all(&plan.dir)?;
        }
        std::fs::rename(&tmp, &plan.dir).context("moving snapshot into place")?;
        Ok(())
    };
    stage.run_step(
        &format!("Saving init snapshot ({})", plan.short_key()),
        write,
    )?;

    // Bring the quiesced infra back to ready before the app services start.
    let mut up = super::compose_cmd(instance, env);
    up.args(["up", "-d", "--wait", "postgres", "search", "kafka"]);
    stage.run("Restarting infra after snapshot", &mut up)?;
    let mut fa = super::compose_cmd(instance, env);
    fa.args(["up", "-d", "fusionauth"]);
    stage.run("Restarting FusionAuth", &mut fa)?;
    fusionauth::wait_ready(stage, instance)
}

/// Run `tar` in the helper container with two mounts. The stack's own stage
/// plumbing is bypassed on purpose — these run inside `run_step` parents.
fn helper_tar(vol_mount: &str, snap_mount: &str, script: &str) -> Result<()> {
    let out = Command::new("docker")
        .args(["run", "--rm", "-v", vol_mount, "-v", snap_mount])
        .arg(HELPER_IMAGE)
        .args(["sh", "-ceu", script])
        .output()
        .context("running snapshot helper container")?;
    if !out.status.success() {
        bail!(
            "snapshot helper failed ({script}):\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    Ok(())
}

fn hash_file(h: &mut Sha256, path: &std::path::Path) -> Result<()> {
    let bytes = std::fs::read(path)
        .with_context(|| format!("reading snapshot input {}", path.display()))?;
    h.update(path.file_name().unwrap_or_default().as_encoded_bytes());
    h.update((bytes.len() as u64).to_le_bytes());
    h.update(&bytes);
    Ok(())
}

/// Hash a directory tree deterministically: sorted relative paths + contents.
fn hash_dir(h: &mut Sha256, dir: &std::path::Path, exclude: &[&str]) -> Result<()> {
    let mut files = Vec::new();
    collect_files(dir, dir, exclude, &mut files)?;
    files.sort();
    for rel in files {
        let path = dir.join(&rel);
        let bytes = std::fs::read(&path)
            .with_context(|| format!("reading snapshot input {}", path.display()))?;
        h.update(rel.as_bytes());
        h.update((bytes.len() as u64).to_le_bytes());
        h.update(&bytes);
    }
    Ok(())
}

fn collect_files(
    root: &std::path::Path,
    dir: &std::path::Path,
    exclude: &[&str],
    out: &mut Vec<String>,
) -> Result<()> {
    let entries = std::fs::read_dir(dir)
        .with_context(|| format!("reading snapshot input dir {}", dir.display()))?;
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if exclude.contains(&name.as_str()) {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, exclude, out)?;
        } else {
            out.push(
                path.strip_prefix(root)
                    .expect("child path is under its root")
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod test;
