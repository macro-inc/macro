//! Compile an OCaml program to WebAssembly against code mode's prebuilt
//! bundle (`packages/sdk-ocaml`, "Code mode bundle"), so the Deno runner can
//! load it beside the bundle's library modules.
//!
//! Every step is a child process with a cleared environment, the run's
//! scratch directory and fixed command lines: `ocamlc` against the bundle's
//! interfaces only, the bundle's policy check on the typed tree, then
//! `wasm_of_ocaml` compile and link. Nothing from the program reaches a
//! command line, and there is no dune, ocamlfind, `-pp` or `-ppx`.

use crate::domain::*;
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
};
use tokio::{io::AsyncReadExt, process::Command, time::Instant};
use tokio_util::sync::CancellationToken;

/// The file an OCaml program is compiled from.
pub(crate) const PROGRAM: &str = "main.ml";
/// Compiler output kept per step; diagnostics for a 64 KiB program fit.
const MAX_TOOL_OUTPUT: u64 = 64 * 1024;

/// Code mode's prebuilt OCaml bundle, checked when it is opened.
#[derive(Debug)]
pub struct OcamlBundle {
    root: PathBuf,
    fingerprint: String,
    link: Vec<PathBuf>,
    shapes: Vec<PathBuf>,
}

impl OcamlBundle {
    /// The bundle this build was compiled with (`CODE_MODE_OCAML_DIR`), or
    /// `None` in a build without one. A bundle that is named but missing or
    /// incomplete is an error, so a misbuilt image fails at startup.
    pub async fn built_in() -> Result<Option<Self>, rootcause::Report> {
        match code_mode_assets::OCAML_BUNDLE {
            Some(path) => Ok(Some(Self::open(Path::new(path)).await?)),
            None => Ok(None),
        }
    }

    /// Open the bundle at `path`.
    pub async fn open(path: &Path) -> Result<Self, rootcause::Report> {
        let root = tokio::fs::canonicalize(path).await?;
        let fingerprint = tokio::fs::read_to_string(root.join("fingerprint"))
            .await?
            .trim()
            .to_owned();
        let list = async |name: &str| -> Result<Vec<PathBuf>, rootcause::Report> {
            let text = tokio::fs::read_to_string(root.join("lib").join(name)).await?;
            Ok(text
                .lines()
                .filter(|line| !line.is_empty())
                .map(|line| root.join("lib").join(line))
                .collect())
        };
        let link = list("link.txt").await?;
        let shapes = list("shapes.txt").await?;
        for tool in ["ocamlc", "wasm_of_ocaml", "wasm-opt", "code_mode_policy"] {
            if !tokio::fs::try_exists(root.join("bin").join(tool)).await? {
                return Err(rootcause::report!("the OCaml bundle has no bin/{tool}"));
            }
        }
        if fingerprint.is_empty() || link.is_empty() {
            return Err(rootcause::report!("the OCaml bundle is incomplete"));
        }
        Ok(Self {
            root,
            fingerprint,
            link,
            shapes,
        })
    }

    /// The SDK version plus a hash of the interfaces programs compile against.
    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }

    /// The prebuilt library modules every program's loader reads.
    pub(crate) fn assets(&self) -> PathBuf {
        self.root.join("assets")
    }

    /// Compile `main.ml` in `directory` (the run's scratch) into `main.js`
    /// and `main.assets/`, keeping only the program's own modules there.
    /// With `typing_only`, stop after type checking and the policy check.
    /// `directory/tmp` and `directory/home` must exist.
    #[tracing::instrument(
        name = "code_execution.compile",
        skip_all,
        fields(typing_only, outcome = tracing::field::Empty)
    )]
    pub(crate) async fn compile(
        &self,
        directory: &Path,
        typing_only: bool,
        limits: &Limits,
        deadline: Instant,
        cancellation: &CancellationToken,
    ) -> Result<(), CompileError> {
        let step = Step {
            bundle: self,
            directory,
            limits,
            deadline,
            cancellation,
        };
        let compiled = self.steps(&step, typing_only).await;
        let outcome = match &compiled {
            Ok(()) => "compiled",
            Err(CompileError::Diagnostics(_)) => "diagnostics",
            Err(CompileError::Cancelled) => "cancelled",
            Err(CompileError::TimedOut) => "timed_out",
            Err(CompileError::Internal) => "internal",
        };
        tracing::Span::current().record("outcome", outcome);
        compiled
    }

    async fn steps(&self, step: &Step<'_>, typing_only: bool) -> Result<(), CompileError> {
        let bin = self.root.join("bin");
        // 1. Type-check and compile against the bundle's interfaces only,
        //    keeping the typed tree (-bin-annot) for the policy check.
        let mut ocamlc: Vec<OsString> = vec![
            "-nostdlib".into(),
            "-I".into(),
            self.root.join("stdlib").into(),
            "-I".into(),
            self.root.join("cmi").into(),
            "-bin-annot".into(),
            "-color".into(),
            "never".into(),
        ];
        if typing_only {
            ocamlc.extend(["-stop-after".into(), "typing".into()]);
        }
        ocamlc.extend(["-c".into(), PROGRAM.into()]);
        let output = step.run("ocamlc", bin.join("ocamlc"), ocamlc).await?;
        if !output.status.success() {
            return Err(compiler_diagnostics(&output.stderr));
        }

        // 2. The policy check on the typed tree.
        let output = step
            .run(
                "policy",
                bin.join("code_mode_policy"),
                vec!["main.cmt".into()],
            )
            .await?;
        match output.status.code() {
            Some(0) => {}
            Some(1) => return Err(policy_diagnostics(&output.stdout)),
            _ => return Err(internal("the policy check failed")),
        }
        if typing_only {
            return Ok(());
        }

        // 3. The program's one unit to Wasm, with the libraries' shapes.
        let mut compile: Vec<OsString> = [
            "compile",
            "--effects=jspi",
            "--no-sourcemap",
            "-o",
            "main.wasmo",
            "main.cmo",
        ]
        .map(OsString::from)
        .into();
        for shape in &self.shapes {
            compile.push("--load-shape".into());
            compile.push(shape.into());
        }
        let wasm_of_ocaml = bin.join("wasm_of_ocaml");
        let output = step
            .run("wasm_compile", wasm_of_ocaml.clone(), compile)
            .await?;
        if !output.status.success() {
            return Err(internal("wasm_of_ocaml compile failed"));
        }

        // 4. Link against the prebuilt archives.
        let mut link: Vec<OsString> = ["link", "--no-sourcemap", "-o", "main.js"]
            .map(OsString::from)
            .into();
        link.extend(self.link.iter().map(OsString::from));
        link.push("main.wasmo".into());
        link.push(self.root.join("lib").join("std_exit.wasmo").into());
        let output = step.run("wasm_link", wasm_of_ocaml, link).await?;
        if !output.status.success() {
            return Err(internal("wasm_of_ocaml link failed"));
        }

        // 5. Keep only the program's own modules; the loader reads the
        //    libraries' from the bundle, where they have the same names.
        let modules = step.directory.join("main.assets");
        let mut entries = tokio::fs::read_dir(&modules).await.map_err(internal)?;
        while let Some(entry) = entries.next_entry().await.map_err(internal)? {
            if tokio::fs::try_exists(self.assets().join(entry.file_name()))
                .await
                .map_err(internal)?
            {
                tokio::fs::remove_file(entry.path())
                    .await
                    .map_err(internal)?;
            }
        }
        for intermediate in ["main.cmi", "main.cmo", "main.cmt", "main.wasmo"] {
            tokio::fs::remove_file(step.directory.join(intermediate))
                .await
                .map_err(internal)?;
        }
        Ok(())
    }
}

/// Why a program didn't compile.
#[derive(Debug)]
pub(crate) enum CompileError {
    /// The compiler or the policy check refused it.
    Diagnostics(Vec<Diagnostic>),
    /// Cancelled while compiling.
    Cancelled,
    /// The deadline passed while compiling.
    TimedOut,
    /// A compile step failed for a reason other than the program.
    Internal,
}

impl CompileError {
    /// The run's outcome when it stops at compiling.
    pub(crate) fn outcome(self) -> Outcome {
        match self {
            Self::Diagnostics(diagnostics) => ExecutionFailure::new(
                FailureCode::Compile,
                diagnostics
                    .into_iter()
                    .map(|diagnostic| diagnostic.message)
                    .collect::<Vec<_>>()
                    .join("\n\n"),
            )
            .into(),
            Self::Cancelled => Outcome::Cancelled,
            Self::TimedOut => Outcome::TimedOut,
            Self::Internal => {
                ExecutionFailure::new(FailureCode::Internal, "OCaml compilation failed to run")
                    .into()
            }
        }
    }
}

/// One compile's settings, shared by its steps.
struct Step<'a> {
    bundle: &'a OcamlBundle,
    directory: &'a Path,
    limits: &'a Limits,
    deadline: Instant,
    cancellation: &'a CancellationToken,
}

struct ToolOutput {
    status: std::process::ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

impl Step<'_> {
    /// Run one tool to completion, or kill and reap it when the run is
    /// cancelled or out of time.
    #[tracing::instrument(
        name = "code_execution.compile.step",
        skip_all,
        fields(step = name, exit_code = tracing::field::Empty)
    )]
    async fn run(
        &self,
        name: &str,
        program: PathBuf,
        args: Vec<OsString>,
    ) -> Result<ToolOutput, CompileError> {
        let bundle = &self.bundle.root;
        // No inherited variables, as for Deno. wasm_of_ocaml runs binaryen
        // from PATH through /bin/sh, writes temporary files under TMPDIR and
        // reads findlib's stdlib package from the bundle's configuration.
        let mut child = Command::new(program)
            .args(args)
            .env_clear()
            .env("PATH", bundle.join("bin"))
            .env("TMPDIR", self.directory.join("tmp"))
            .env("HOME", self.directory.join("home"))
            .env(
                "OCAMLFIND_CONF",
                bundle.join("findlib").join("findlib.conf"),
            )
            .current_dir(self.directory)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(internal)?;
        if super::deno::limit(&child, self.limits).is_err() {
            super::deno::reap(&mut child).await;
            return Err(CompileError::Internal);
        }
        let stdout = child.stdout.take().expect("piped child stdout");
        let stderr = child.stderr.take().expect("piped child stderr");
        let finished = async {
            let mut out = Vec::new();
            let mut err = Vec::new();
            let mut stdout = stdout.take(MAX_TOOL_OUTPUT);
            let mut stderr = stderr.take(MAX_TOOL_OUTPUT);
            let (read_out, read_err) =
                tokio::join!(stdout.read_to_end(&mut out), stderr.read_to_end(&mut err),);
            read_out.map_err(internal)?;
            read_err.map_err(internal)?;
            // Output past the limit is dropped; closing the pipes ends a
            // tool still writing.
            drop((stdout, stderr));
            let status = child.wait().await.map_err(internal)?;
            Ok::<_, CompileError>(ToolOutput {
                status,
                stdout: out,
                stderr: err,
            })
        };
        let result = tokio::select! {
            biased;
            () = self.cancellation.cancelled() => Err(CompileError::Cancelled),
            () = tokio::time::sleep_until(self.deadline) => Err(CompileError::TimedOut),
            output = finished => output,
        };
        super::deno::reap(&mut child).await;
        if let Ok(output) = &result
            && let Some(code) = output.status.code()
        {
            tracing::Span::current().record("exit_code", code);
        }
        result
    }
}

/// `ocamlc` prints each problem as a block: `File "main.ml", line L,
/// characters C1-C2:` (or `lines L1-L2`), the source lines with a marker,
/// then `Error: …` or `Warning …`. Errors become diagnostics shaped like
/// `DenoChecker`'s: the block's text ending in `at main.ml:<line>:<column>`.
pub(crate) fn compiler_diagnostics(output: &[u8]) -> CompileError {
    let text = String::from_utf8_lossy(output);
    let mut blocks: Vec<Block> = Vec::new();
    for line in text.lines() {
        // A header outside the program (a bundle file) starts a block
        // without a location; its path is never shown.
        if line.starts_with("File \"") {
            blocks.push(Block {
                at: location(line),
                lines: Vec::new(),
            });
        } else if let Some(block) = blocks.last_mut() {
            block.lines.push(line);
        } else {
            blocks.push(Block {
                at: None,
                lines: vec![line],
            });
        }
    }
    let diagnostics: Vec<Diagnostic> = blocks
        .into_iter()
        .filter(|block| block.lines.iter().any(|line| line.starts_with("Error")))
        .map(|block| {
            let body = block.lines.join("\n");
            match block.at {
                Some((line, column)) => Diagnostic {
                    message: format!("{body}\n    at {PROGRAM}:{line}:{column}"),
                    file: Some(PROGRAM.to_owned()),
                },
                None => Diagnostic {
                    file: None,
                    message: body,
                },
            }
        })
        .collect();
    if diagnostics.is_empty() {
        tracing::warn!("ocamlc failed without diagnostics");
        return CompileError::Internal;
    }
    CompileError::Diagnostics(diagnostics)
}

/// One problem `ocamlc` printed: where in the program, if there, and its text.
struct Block<'a> {
    at: Option<(u32, u32)>,
    lines: Vec<&'a str>,
}

/// `File "main.ml", line 3, characters 4-9:` as `(3, 5)`, with a 1-based
/// column. A location in any other file (a bundle path) is `None`.
fn location(line: &str) -> Option<(u32, u32)> {
    let rest = line.strip_prefix("File \"")?;
    let (file, rest) = rest.split_once("\", ")?;
    let rest = rest.strip_suffix(':')?;
    let (lines, characters) = rest.split_once(", characters ")?;
    let line = lines
        .strip_prefix("line ")
        .or_else(|| lines.strip_prefix("lines "))?
        .split('-')
        .next()?
        .parse()
        .ok()?;
    let column: u32 = characters.split('-').next()?.parse().ok()?;
    (file == PROGRAM).then_some((line, column + 1))
}

/// The policy check prints `<file>:<line>:<column>: <message>` per finding.
pub(crate) fn policy_diagnostics(output: &[u8]) -> CompileError {
    let diagnostics: Vec<Diagnostic> = String::from_utf8_lossy(output)
        .lines()
        .filter_map(|line| {
            let (file, rest) = line.split_once(':')?;
            let (row, rest) = rest.split_once(':')?;
            let (column, message) = rest.split_once(": ")?;
            Some(Diagnostic {
                message: format!("Error: {message}\n    at {file}:{row}:{column}"),
                file: Some(file.to_owned()),
            })
        })
        .collect();
    if diagnostics.is_empty() {
        return CompileError::Internal;
    }
    CompileError::Diagnostics(diagnostics)
}

fn internal(_error: impl std::fmt::Display) -> CompileError {
    // Host paths and source stay out of infrastructure diagnostics.
    CompileError::Internal
}

pub mod check;

#[cfg(test)]
mod test;
