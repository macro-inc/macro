//! Type-check TypeScript programs with `deno check` against the SDK's
//! generated declarations, without running them.

use crate::domain::*;
use async_trait::async_trait;
use serde::Deserialize;
use std::{collections::BTreeMap, path::PathBuf, process::Stdio, sync::Arc, time::Duration};
use tokio::{process::Command, sync::Semaphore};

/// Longest a check may take, including waiting for a slot.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
/// Where Handlebars' declarations go under the declarations root: its own
/// (a global script) and a module importing `handlebars` resolves to.
const HANDLEBARS_TYPES: &str = "handlebars/types.d.ts";
const HANDLEBARS_MODULE: &str = "handlebars/index.d.ts";
const HANDLEBARS_MODULE_SOURCE: &str =
    "/// <reference path=\"./types.d.ts\" />\nexport default Handlebars;\n";
/// Modules one check takes.
const MAX_FILES: usize = 40;

/// Checks with the pinned Deno against declarations written once at startup.
pub struct DenoChecker {
    binary: PathBuf,
    root: PathBuf,
    types: PathBuf,
    fingerprint: String,
    /// Checks running or waiting for a slot; one more is refused as busy.
    admitted: Arc<Semaphore>,
    slots: Arc<Semaphore>,
    max_source_bytes: usize,
}

#[derive(Deserialize)]
struct SdkTypes {
    fingerprint: String,
    files: BTreeMap<String, String>,
    /// Handlebars' declarations, outside the fingerprint: routines can't
    /// import it.
    handlebars: String,
}

impl DenoChecker {
    /// Validate the runtime and write the SDK declarations under `scratch`.
    /// `concurrency` checks run at once; each is a type checker in its own
    /// process. Up to `max_queued` more wait for a slot; past that a check
    /// fails as busy at once.
    #[tracing::instrument(skip_all, err)]
    pub async fn new(
        binary: PathBuf,
        scratch: PathBuf,
        concurrency: usize,
        max_queued: usize,
        max_source_bytes: usize,
    ) -> Result<Self, rootcause::Report> {
        let binary = super::pinned_deno(binary).await?;
        tokio::fs::create_dir_all(&scratch).await?;
        let root = tokio::fs::canonicalize(scratch).await?;
        let sdk: SdkTypes = serde_json::from_str(SDK_TYPES)?;
        let types = root.join("types");
        if sdk
            .files
            .keys()
            .any(|path| path == HANDLEBARS_TYPES || path == HANDLEBARS_MODULE)
        {
            return Err(rootcause::report!("SDK declarations overlap Handlebars'"));
        }
        let files = sdk
            .files
            .iter()
            .map(|(path, text)| (path.as_str(), text.as_str()))
            .chain([
                (HANDLEBARS_TYPES, sdk.handlebars.as_str()),
                (HANDLEBARS_MODULE, HANDLEBARS_MODULE_SOURCE),
            ]);
        for (path, text) in files {
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
            admitted: Arc::new(Semaphore::new(concurrency.max(1) + max_queued)),
            slots: Arc::new(Semaphore::new(concurrency.max(1))),
            max_source_bytes,
        })
    }

    async fn run(
        &self,
        files: &[SourceFile],
        declarations: &str,
        imports: ProgramImports,
    ) -> Result<Vec<Diagnostic>, CheckError> {
        let directory = tempfile::Builder::new()
            .prefix("check-")
            .tempdir_in(&self.root)
            .map_err(internal)?;
        let check = directory.path();
        for file in files {
            tokio::fs::write(check.join(&file.name), &file.source)
                .await
                .map_err(internal)?;
        }
        tokio::fs::write(check.join("context.d.ts"), declarations)
            .await
            .map_err(internal)?;
        let check_url = directory_url(check)?;
        let types_url = directory_url(&self.types)?;
        // Every file URL outside the check and the declarations resolves to
        // a root that doesn't exist, so the checker can't read (and quote in
        // a diagnostic) any other file, whatever the source imports or
        // references.
        let mut map = BTreeMap::from([
            (
                "@macro-inc/sdk".to_owned(),
                format!("{types_url}src/macro.d.ts"),
            ),
            ("file:///".to_owned(), "file:///unavailable/".to_owned()),
            (check_url.clone(), check_url.clone()),
            (types_url.clone(), types_url.clone()),
        ]);
        match imports {
            ProgramImports::Sdk => {}
            ProgramImports::SdkAndHandlebars => {
                map.insert(
                    "handlebars".to_owned(),
                    format!("{types_url}{HANDLEBARS_MODULE}"),
                );
            }
        }
        let map = serde_json::json!({ "imports": map });
        tokio::fs::write(check.join("imports.json"), map.to_string())
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
            ])
            .args(files.iter().map(|file| file.name.as_str()))
            .arg("context.d.ts")
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
        fields(
            files = files.len() as i64,
            source_bytes = files.iter().map(|file| file.source.len()).sum::<usize>() as i64,
            imports = ?imports,
            waited_ms = tracing::field::Empty,
            diagnostics = tracing::field::Empty,
            outcome = tracing::field::Empty,
        ),
        err
    )]
    async fn check_files(
        &self,
        files: &[SourceFile],
        declarations: &str,
        imports: ProgramImports,
    ) -> Result<Vec<Diagnostic>, CheckError> {
        let span = tracing::Span::current();
        let valid_name = |name: &str| {
            name.strip_suffix(".ts").is_some_and(|stem| {
                !stem.is_empty()
                    && stem
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
            })
        };
        if files.is_empty()
            || files.len() > MAX_FILES
            || files.iter().any(|file| {
                !valid_name(&file.name)
                    || file.source.trim().is_empty()
                    || file.source.len() > self.max_source_bytes
            })
        {
            span.record("outcome", "invalid");
            return Err(CheckError::InvalidSource);
        }
        let Ok(_admitted) = self.admitted.try_acquire() else {
            span.record("outcome", "busy");
            return Err(CheckError::Busy);
        };
        let queued = tokio::time::Instant::now();
        let checked = tokio::time::timeout(CHECK_TIMEOUT, async {
            let _slot = self
                .slots
                .acquire()
                .await
                .map_err(|_| CheckError::Internal)?;
            span.record("waited_ms", queued.elapsed().as_millis() as i64);
            self.run(files, declarations, imports).await
        })
        .await;
        let checked = match checked {
            Ok(Ok(diagnostics)) => diagnostics,
            Ok(Err(error)) => {
                span.record("outcome", "failed");
                return Err(error);
            }
            Err(_) => {
                span.record("outcome", "timed_out");
                return Err(CheckError::Busy);
            }
        };
        span.record("diagnostics", checked.len() as i64);
        span.record(
            "outcome",
            if checked.is_empty() {
                "passed"
            } else {
                "rejected"
            },
        );
        Ok(checked)
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
