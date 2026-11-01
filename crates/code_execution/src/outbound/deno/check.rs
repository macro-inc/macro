//! Type-check TypeScript programs with `deno check` against the SDK's
//! generated declarations, without running them.

use crate::domain::*;
use async_trait::async_trait;
use serde::Deserialize;
use std::{collections::BTreeMap, path::PathBuf, process::Stdio, sync::Arc, time::Duration};
use tokio::{process::Command, sync::Semaphore};

/// Longest a check may take, including waiting for a slot.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

/// Checks with the pinned Deno against declarations written once at startup.
pub struct DenoChecker {
    binary: PathBuf,
    root: PathBuf,
    types: PathBuf,
    fingerprint: String,
    slots: Arc<Semaphore>,
    max_source_bytes: usize,
}

#[derive(Deserialize)]
struct SdkTypes {
    fingerprint: String,
    files: BTreeMap<String, String>,
}

impl DenoChecker {
    /// Validate the runtime and write the SDK declarations under `scratch`.
    /// `concurrency` checks run at once; each is a type checker in its own
    /// process.
    #[tracing::instrument(skip_all, err)]
    pub async fn new(
        binary: PathBuf,
        scratch: PathBuf,
        concurrency: usize,
        max_source_bytes: usize,
    ) -> Result<Self, rootcause::Report> {
        let binary = super::pinned_deno(binary).await?;
        tokio::fs::create_dir_all(&scratch).await?;
        let root = tokio::fs::canonicalize(scratch).await?;
        let sdk: SdkTypes = serde_json::from_str(SDK_TYPES)?;
        let types = root.join("types");
        for (path, text) in &sdk.files {
            let relative = std::path::Path::new(path);
            if relative.is_absolute()
                || relative
                    .components()
                    .any(|part| !matches!(part, std::path::Component::Normal(_)))
            {
                return Err(rootcause::report!("invalid SDK declaration path"));
            }
            let file = types.join(relative);
            if let Some(parent) = file.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::write(file, text).await?;
        }
        tokio::fs::create_dir_all(root.join("cache")).await?;
        Ok(Self {
            binary,
            root,
            types,
            fingerprint: sdk.fingerprint,
            slots: Arc::new(Semaphore::new(concurrency.max(1))),
            max_source_bytes,
        })
    }

    async fn run(&self, source: &str, declarations: &str) -> Result<Vec<Diagnostic>, CheckError> {
        let directory = tempfile::Builder::new()
            .prefix("check-")
            .tempdir_in(&self.root)
            .map_err(internal)?;
        let check = directory.path();
        tokio::fs::write(check.join("main.ts"), source)
            .await
            .map_err(internal)?;
        tokio::fs::write(check.join("context.d.ts"), declarations)
            .await
            .map_err(internal)?;
        let check_url = directory_url(check)?;
        let types_url = directory_url(&self.types)?;
        // Every file URL outside the check and the declarations resolves to
        // a root that doesn't exist, so the checker can't read (and quote in
        // a diagnostic) any other file, whatever the source imports or
        // references.
        let imports = serde_json::json!({
            "imports": BTreeMap::from([
                ("@macro-inc/sdk".to_owned(), format!("{types_url}src/macro.d.ts")),
                ("file:///".to_owned(), "file:///unavailable/".to_owned()),
                (check_url.clone(), check_url.clone()),
                (types_url.clone(), types_url.clone()),
            ])
        });
        tokio::fs::write(check.join("imports.json"), imports.to_string())
            .await
            .map_err(internal)?;
        let output = Command::new(&self.binary)
            .env_clear()
            .env("DENO_DIR", self.root.join("cache"))
            .env("HOME", check)
            .env("TMPDIR", check)
            .env("DENO_NO_UPDATE_CHECK", "1")
            .env("NO_COLOR", "1")
            .current_dir(check)
            .args([
                "check",
                "--quiet",
                "--no-config",
                "--no-lock",
                "--no-remote",
                "--no-npm",
                "--unstable-sloppy-imports",
                "--import-map=imports.json",
                "main.ts",
                "context.d.ts",
            ])
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output()
            .await
            .map_err(internal)?;
        if output.status.success() {
            return Ok(Vec::new());
        }
        let text = String::from_utf8_lossy(&output.stderr);
        let diagnostics = diagnostics(&text, &check_url, &types_url);
        if diagnostics.is_empty() {
            tracing::warn!("type checker failed without diagnostics");
            return Err(CheckError::Internal);
        }
        Ok(diagnostics)
    }
}

#[async_trait]
impl ProgramChecker for DenoChecker {
    fn sdk_fingerprint(&self) -> &str {
        &self.fingerprint
    }

    #[tracing::instrument(
        name = "code_execution.check",
        skip_all,
        fields(source_bytes = source.len(), diagnostics = tracing::field::Empty),
        err
    )]
    async fn check(&self, source: &str, declarations: &str) -> Result<Vec<Diagnostic>, CheckError> {
        if source.trim().is_empty() || source.len() > self.max_source_bytes {
            return Err(CheckError::InvalidSource);
        }
        let checked = tokio::time::timeout(CHECK_TIMEOUT, async {
            let _slot = self
                .slots
                .acquire()
                .await
                .map_err(|_| CheckError::Internal)?;
            self.run(source, declarations).await
        })
        .await
        .map_err(|_| CheckError::Busy)??;
        tracing::Span::current().record("diagnostics", checked.len());
        Ok(checked)
    }
}

/// `deno check` prints each problem as a block: `TS<code> [ERROR]: …`, the
/// offending line, a marker and `at <file>:<line>:<column>`. Resolution
/// problems are single `error: …` lines. Paths become `main.ts` and
/// `@macro-inc/sdk/…` so diagnostics name no host directory.
fn diagnostics(output: &str, check_url: &str, types_url: &str) -> Vec<Diagnostic> {
    output
        .split("\n\n")
        .map(str::trim)
        .filter(|block| {
            (block.starts_with("TS") && block.contains("[ERROR]"))
                || (block.starts_with("error: ")
                    && !block.starts_with("error: Type checking failed"))
        })
        .map(|block| Diagnostic {
            message: block
                .replace(check_url, "")
                .replace(types_url, "@macro-inc/sdk/"),
        })
        .collect()
}

fn directory_url(path: &std::path::Path) -> Result<String, CheckError> {
    let url = url::Url::from_directory_path(path).map_err(|()| CheckError::Internal)?;
    Ok(url.to_string())
}

fn internal(_error: impl std::fmt::Display) -> CheckError {
    // Host paths and source stay out of infrastructure diagnostics.
    CheckError::Internal
}

#[cfg(test)]
mod test;
