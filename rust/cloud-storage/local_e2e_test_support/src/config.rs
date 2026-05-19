use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use anyhow::Context;

const SEED_DIR_MARKER: &str = "rust/cloud-storage/seed_cli/seed";

/// Local E2E runtime configuration loaded from the repository `.env` plus the
/// process environment.
#[derive(Clone, Debug)]
pub struct LocalE2eConfig {
    repo_root: PathBuf,
    values: HashMap<String, String>,
}

impl LocalE2eConfig {
    /// Load configuration from the repository root derived from this crate path.
    ///
    /// Values from the process environment override values from `.env`.
    pub fn load() -> anyhow::Result<Self> {
        let repo_root = find_repo_root()?;
        Self::from_repo_root(repo_root)
    }

    /// Load configuration using an explicit repository root.
    pub fn from_repo_root(repo_root: PathBuf) -> anyhow::Result<Self> {
        let mut values = HashMap::new();
        let dotenv_path = repo_root.join(".env");

        if dotenv_path.exists() {
            for item in dotenvy::from_path_iter(&dotenv_path)
                .with_context(|| format!("failed to read {}", dotenv_path.display()))?
            {
                let (key, value) = item.with_context(|| {
                    format!("failed to parse dotenv entry in {}", dotenv_path.display())
                })?;
                values.insert(key, value);
            }
        }

        values.extend(std::env::vars());

        Ok(Self { repo_root, values })
    }

    /// Repository root containing `rust/cloud-storage/seed_cli/seed`.
    pub fn repo_root(&self) -> &Path {
        &self.repo_root
    }

    /// Path to the shared seed directory.
    pub fn seed_dir(&self) -> PathBuf {
        self.repo_root.join(SEED_DIR_MARKER)
    }

    /// Get a configuration value.
    pub fn get(&self, key: &str) -> Option<&str> {
        self.values.get(key).map(String::as_str)
    }

    /// Get a required configuration value.
    pub fn required(&self, key: &str) -> anyhow::Result<&str> {
        self.get(key)
            .with_context(|| format!("{key} is required in environment or .env"))
    }
}

fn find_repo_root() -> anyhow::Result<PathBuf> {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .context("CARGO_MANIFEST_DIR must be under rust/cloud-storage/<crate>")
}
