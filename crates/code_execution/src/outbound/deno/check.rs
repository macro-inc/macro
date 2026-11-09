//! Type-check TypeScript programs with `deno check` against the SDK's
//! generated declarations, without running them.

use crate::domain::*;
use async_trait::async_trait;
use serde::Deserialize;
use std::{collections::BTreeMap, path::PathBuf, process::Stdio, sync::Arc, time::Duration};
use tokio::{process::Command, sync::Semaphore};

/// Longest a check may take, including waiting for a slot.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
/// Modules one check takes.
const MAX_FILES: usize = 40;

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

    /// Write the files into a fresh directory with the import map every Deno
    /// command here runs under.
    async fn workspace(&self, files: &[SourceFile]) -> Result<Workspace, CheckError> {
        let directory = tempfile::Builder::new()
            .prefix("check-")
            .tempdir_in(&self.root)
            .map_err(internal)?;
        let path = directory.path();
        for file in files {
            tokio::fs::write(path.join(&file.name), &file.source)
                .await
                .map_err(internal)?;
        }
        let check_url = directory_url(path)?;
        let types_url = directory_url(&self.types)?;
        // Every file URL outside the check and the declarations resolves to
        // a root that doesn't exist, so the checker can't read (and quote in
        // a diagnostic) any other file, whatever the source imports or
        // references. `macro:programs` and `macro:client` name files of the
        // check itself, for document builds that generate them.
        let imports = serde_json::json!({
            "imports": BTreeMap::from([
                ("@macro-inc/sdk".to_owned(), format!("{types_url}src/macro.d.ts")),
                ("macro:programs".to_owned(), format!("{check_url}programs.ts")),
                ("macro:client".to_owned(), format!("{check_url}macro_client.ts")),
                ("file:///".to_owned(), "file:///unavailable/".to_owned()),
                (check_url.clone(), check_url.clone()),
                (types_url.clone(), types_url.clone()),
            ])
        });
        tokio::fs::write(path.join("imports.json"), imports.to_string())
            .await
            .map_err(internal)?;
        Ok(Workspace {
            directory,
            check_url,
            types_url,
        })
    }

    /// A Deno command confined to `workspace`: no remote modules, no npm, no
    /// lockfile or config, and the workspace's import map.
    fn command(&self, workspace: &Workspace, subcommand: &str) -> Command {
        let path = workspace.directory.path();
        let mut command = Command::new(&self.binary);
        command
            .env_clear()
            .env("DENO_DIR", self.root.join("cache"))
            .env("HOME", path)
            .env("TMPDIR", path)
            .env("DENO_NO_UPDATE_CHECK", "1")
            .env("NO_COLOR", "1")
            .current_dir(path)
            .args([
                subcommand,
                "--quiet",
                "--no-config",
                "--no-lock",
                "--no-remote",
                "--no-npm",
                "--unstable-sloppy-imports",
                "--import-map=imports.json",
            ])
            .stdin(Stdio::null())
            .kill_on_drop(true);
        command
    }

    async fn run(
        &self,
        files: &[SourceFile],
        declarations: &str,
    ) -> Result<Vec<Diagnostic>, CheckError> {
        let workspace = self.workspace(files).await?;
        tokio::fs::write(
            workspace.directory.path().join("context.d.ts"),
            declarations,
        )
        .await
        .map_err(internal)?;
        let output = self
            .command(&workspace, "check")
            .args(files.iter().map(|file| file.name.as_str()))
            .arg("context.d.ts")
            .output()
            .await
            .map_err(internal)?;
        if output.status.success() {
            return Ok(Vec::new());
        }
        let text = String::from_utf8_lossy(&output.stderr);
        let diagnostics = diagnostics(&text, &workspace.check_url, &workspace.types_url);
        if diagnostics.is_empty() {
            tracing::warn!("type checker failed without diagnostics");
            return Err(CheckError::Internal);
        }
        Ok(diagnostics)
    }

    async fn run_bundle(
        &self,
        files: &[SourceFile],
        entry: &str,
        target: BundleTarget,
    ) -> Result<Bundle, CheckError> {
        let workspace = self.workspace(files).await?;
        let mut command = self.command(&workspace, "bundle");
        command.args(["--format=esm", "--output=bundle.js"]);
        match target {
            BundleTarget::Browser => command.args(["--platform=browser", "--minify"]),
            BundleTarget::Deno => command.arg("--platform=deno"),
        };
        let output = command.arg(entry).output().await.map_err(internal)?;
        if !output.status.success() {
            let text = String::from_utf8_lossy(&output.stderr);
            let diagnostics = bundle_diagnostics(&text, &workspace.check_url);
            if diagnostics.is_empty() {
                tracing::warn!("bundler failed without diagnostics");
                return Err(CheckError::Internal);
            }
            return Ok(Bundle::Rejected(diagnostics));
        }
        let code = tokio::fs::read_to_string(workspace.directory.path().join("bundle.js"))
            .await
            .map_err(internal)?;
        Ok(Bundle::Code(code))
    }

    /// Admit a batch of modules: valid names, within the size and count limits.
    fn validate(&self, files: &[SourceFile]) -> Result<(), CheckError> {
        let valid_name = |name: &str| {
            name.strip_suffix(".ts").is_some_and(|stem| {
                !stem.is_empty()
                    && stem
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
            })
        };
        let invalid = files.iter().any(|file| {
            !valid_name(&file.name)
                || file.source.trim().is_empty()
                || file.source.len() > self.max_source_bytes
        });
        if files.is_empty() || files.len() > MAX_FILES || invalid {
            return Err(CheckError::InvalidSource);
        }
        Ok(())
    }

    /// Run `work` in a checker slot, within the time limit.
    async fn in_slot<T>(
        &self,
        work: impl std::future::Future<Output = Result<T, CheckError>>,
    ) -> Result<T, CheckError> {
        tokio::time::timeout(CHECK_TIMEOUT, async {
            let _slot = self
                .slots
                .acquire()
                .await
                .map_err(|_| CheckError::Internal)?;
            work.await
        })
        .await
        .map_err(|_| CheckError::Busy)?
    }
}

/// One Deno command's private directory; removed when dropped.
struct Workspace {
    directory: tempfile::TempDir,
    check_url: String,
    types_url: String,
}

#[async_trait]
impl ProgramChecker for DenoChecker {
    fn sdk_fingerprint(&self) -> &str {
        &self.fingerprint
    }

    #[tracing::instrument(
        name = "code_execution.check",
        skip_all,
        fields(
            files = files.len(),
            source_bytes = files.iter().map(|file| file.source.len()).sum::<usize>(),
            diagnostics = tracing::field::Empty,
        ),
        err
    )]
    async fn check_files(
        &self,
        files: &[SourceFile],
        declarations: &str,
    ) -> Result<Vec<Diagnostic>, CheckError> {
        self.validate(files)?;
        let checked = self.in_slot(self.run(files, declarations)).await?;
        tracing::Span::current().record("diagnostics", checked.len());
        Ok(checked)
    }
}

#[async_trait]
impl ProgramBundler for DenoChecker {
    #[tracing::instrument(
        name = "code_execution.bundle",
        skip_all,
        fields(
            files = files.len(),
            source_bytes = files.iter().map(|file| file.source.len()).sum::<usize>(),
            ?target,
            bundle_bytes = tracing::field::Empty,
        ),
        err
    )]
    async fn bundle(
        &self,
        files: &[SourceFile],
        entry: &str,
        target: BundleTarget,
    ) -> Result<Bundle, CheckError> {
        self.validate(files)?;
        if !files.iter().any(|file| file.name == entry) {
            return Err(CheckError::InvalidSource);
        }
        let bundle = self.in_slot(self.run_bundle(files, entry, target)).await?;
        if let Bundle::Code(code) = &bundle {
            tracing::Span::current().record("bundle_bytes", code.len());
        }
        Ok(bundle)
    }
}

/// `deno check` prints each problem as a block: `TS<code> [ERROR]: …`, the
/// offending line, a marker and `at <file>:<line>:<column>`. Resolution
/// problems are single `error: …` lines. Paths become the checked files'
/// names and `@macro-inc/sdk/…` so diagnostics name no host directory.
fn diagnostics(output: &str, check_url: &str, types_url: &str) -> Vec<Diagnostic> {
    output
        .split("\n\n")
        .map(str::trim)
        .filter(|block| {
            (block.starts_with("TS") && block.contains("[ERROR]"))
                || (block.starts_with("error: ")
                    && !block.starts_with("error: Type checking failed"))
        })
        .map(|block| {
            let message = block
                .replace(check_url, "")
                .replace(types_url, "@macro-inc/sdk/");
            Diagnostic {
                file: located_in(&message),
                message,
            }
        })
        .collect()
}

/// `deno bundle` reports esbuild's `error: …` blocks; paths become the
/// bundled files' names.
fn bundle_diagnostics(output: &str, check_url: &str) -> Vec<Diagnostic> {
    let check_path = check_url.trim_start_matches("file://");
    output
        .split("\n\n")
        .map(str::trim)
        .filter(|block| block.starts_with("error"))
        .map(|block| {
            let message = block.replace(check_url, "").replace(check_path, "");
            Diagnostic {
                file: located_in(&message),
                message,
            }
        })
        .collect()
}

/// The checked file a diagnostic's `at <file>:<line>:<column>` names.
fn located_in(message: &str) -> Option<String> {
    let at = message
        .lines()
        .rev()
        .find_map(|line| line.trim().strip_prefix("at "))?;
    let file = at.split(':').next()?;
    (file.ends_with(".ts") && !file.contains('/')).then(|| file.to_owned())
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
