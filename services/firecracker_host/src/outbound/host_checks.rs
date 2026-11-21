//! The host's own readiness checks: the agent's nftables tables, a durable
//! disk that takes writes, and the storage pool's health and space.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::domain::health::{CheckOutcome, HealthCheck};
use crate::domain::metrics::StorageUsage;

#[cfg(test)]
mod test;

/// How long one external check (`nft`, `zpool`) may take.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
/// The file the write check replaces; nothing else uses the name.
const PROBE_FILE: &str = ".health-probe";

/// What to check.
#[derive(Debug, Clone)]
pub struct HostChecks {
    /// The durable directory records and disks live under.
    pub durable_dir: PathBuf,
    /// nftables tables the agent loads, as `(family, name)`.
    pub nft_tables: Vec<(String, String)>,
    /// The parent dataset computers' datasets live under, when storage is
    /// ZFS (`tank/firecracker`).
    pub zfs_dataset: Option<String>,
}

/// The checks' results and the storage's space.
#[derive(Debug, Clone)]
pub struct HostCheckResults {
    /// One per check.
    pub checks: Vec<CheckOutcome>,
    /// Space on the storage; `None` when it cannot be read.
    pub storage: Option<StorageUsage>,
}

impl HostChecks {
    /// The tables `network::Network` loads for `prefix`.
    pub fn nft_tables_for(prefix: &str) -> Vec<(String, String)> {
        vec![
            ("inet".to_owned(), prefix.to_owned()),
            ("ip".to_owned(), format!("{prefix}-nat")),
        ]
    }

    /// Run every check.
    #[tracing::instrument(name = "firecracker_host.host_checks", skip(self))]
    pub async fn run(&self) -> HostCheckResults {
        let mut checks = vec![
            self.nftables().await,
            self.store_writable().await,
            self.storage_pool().await,
        ];
        checks.sort_by_key(|check| check.check.as_str());
        let storage = match &self.zfs_dataset {
            Some(dataset) => command(
                "zfs",
                &["list", "-Hp", "-o", "used,avail", dataset.as_str()],
            )
            .await
            .ok()
            .and_then(|output| dataset_usage(&output)),
            None => {
                let durable = self.durable_dir.clone();
                tokio::task::spawn_blocking(move || storage_usage(&durable))
                    .await
                    .ok()
                    .flatten()
            }
        };
        HostCheckResults { checks, storage }
    }

    async fn nftables(&self) -> CheckOutcome {
        for (family, name) in &self.nft_tables {
            if let Err(problem) =
                command("nft", &["list", "table", family.as_str(), name.as_str()]).await
            {
                return CheckOutcome::failed(
                    HealthCheck::Nftables,
                    format!("table {family} {name}: {problem}"),
                );
            }
        }
        CheckOutcome::passed(HealthCheck::Nftables)
    }

    async fn store_writable(&self) -> CheckOutcome {
        let path = self.durable_dir.join(PROBE_FILE);
        let written = tokio::task::spawn_blocking(move || write_and_sync(&path)).await;
        match written {
            Ok(Ok(())) => CheckOutcome::passed(HealthCheck::StoreWritable),
            Ok(Err(error)) => CheckOutcome::failed(HealthCheck::StoreWritable, error.to_string()),
            Err(error) => CheckOutcome::failed(HealthCheck::StoreWritable, error.to_string()),
        }
    }

    async fn storage_pool(&self) -> CheckOutcome {
        let Some(dataset) = &self.zfs_dataset else {
            // Files on one filesystem: the write check covers it.
            return CheckOutcome::passed(HealthCheck::StoragePool);
        };
        let pool = dataset.split('/').next().unwrap_or(dataset);
        match command("zpool", &["list", "-H", "-o", "health", pool]).await {
            Ok(output) => pool_health(pool, &output),
            Err(problem) => {
                CheckOutcome::failed(HealthCheck::StoragePool, format!("zpool {pool}: {problem}"))
            }
        }
    }
}

/// `zpool list -H -o health` output to a check: only `ONLINE` is healthy
/// (a `DEGRADED` pool still serves, but lost its redundancy).
pub fn pool_health(pool: &str, output: &str) -> CheckOutcome {
    match output.trim() {
        "ONLINE" => CheckOutcome::passed(HealthCheck::StoragePool),
        health => {
            CheckOutcome::failed(HealthCheck::StoragePool, format!("pool {pool} is {health}"))
        }
    }
}

/// `zfs list -Hp -o used,avail` output: the dataset tree's used bytes
/// (children included) and what it may still take.
pub fn dataset_usage(output: &str) -> Option<StorageUsage> {
    let mut fields = output.split_whitespace();
    let used_bytes = fields.next()?.parse().ok()?;
    let available_bytes = fields.next()?.parse().ok()?;
    Some(StorageUsage {
        used_bytes,
        available_bytes,
    })
}

/// Run a command; its stdout, or why it failed.
async fn command(program: &str, arguments: &[&str]) -> Result<String, String> {
    let output = tokio::time::timeout(
        COMMAND_TIMEOUT,
        tokio::process::Command::new(program)
            .args(arguments)
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| format!("{program} did not answer in {COMMAND_TIMEOUT:?}"))?
    .map_err(|error| format!("{program}: {error}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(format!(
            "{}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn write_and_sync(path: &Path) -> std::io::Result<()> {
    use std::io::Write;

    let mut file = std::fs::File::create(path)?;
    file.write_all(b"ok")?;
    file.sync_all()?;
    std::fs::remove_file(path)
}

/// Space on the filesystem holding `directory`.
pub fn storage_usage(directory: &Path) -> Option<StorageUsage> {
    let stat = rustix::fs::statvfs(directory).ok()?;
    let block = stat.f_frsize;
    Some(StorageUsage {
        used_bytes: stat
            .f_blocks
            .saturating_sub(stat.f_bfree)
            .saturating_mul(block),
        available_bytes: stat.f_bavail.saturating_mul(block),
    })
}
