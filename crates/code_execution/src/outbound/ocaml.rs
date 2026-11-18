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
/// Address space each compile step may map. A program's source drives the
/// compiler's memory (types of exponential size), so each step is capped
/// well below what would endanger the shared container. Ordinary programs
/// compile in under 384 MiB, most of it the OCaml runtime's reservation for
/// its minor heaps; 1 GiB leaves room for large ones.
const MAX_STEP_ADDRESS_SPACE: u64 = 1024 * 1024 * 1024;
/// What a program sees when a compile step runs out of memory.
const OUT_OF_MEMORY: &str = "Error: compiling the program needs more memory than code mode allows (1 GiB); it may build very large types";

/// Code mode's prebuilt OCaml bundle, checked when it is opened.
#[derive(Debug)]
pub struct OcamlBundle {
    root: PathBuf,
    fingerprint: String,
    link: Vec<PathBuf>,
    shapes: Vec<PathBuf>,
    /// Tests only: skip the policy step, to show what Deno does with a
    /// program the policy would refuse.
    #[cfg(test)]
    skip_policy: bool,
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
        for tool in [
            "ocamlc",
            "wasm_of_ocaml",
            "wasm-opt",
            "code_mode_policy",
            "macro_sdk_calls",
        ] {
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
            #[cfg(test)]
            skip_policy: false,
        })
    }

    /// Tests only: this bundle without its policy step.
    #[cfg(test)]
    pub(crate) fn without_policy(&self) -> Self {
        Self {
            root: self.root.clone(),
            fingerprint: self.fingerprint.clone(),
            link: self.link.clone(),
            shapes: self.shapes.clone(),
            skip_policy: true,
        }
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
    // A program's compile errors are its author's, not the service's: they
    // are recorded at info level.
    #[tracing::instrument(
        name = "code_execution.compile",
        skip_all,
        fields(typing_only, sdk_fingerprint = %self.fingerprint, outcome = tracing::field::Empty),
        err(level = "info")
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

    /// List the SDK operations the program in `directory` may call, from the
    /// `main.cmt` a typing-only [`Self::compile`] left there. Exit 0 is the
    /// operations, exit 1 a program the analysis cannot see through; any
    /// other exit or output is the service's failure, not the program's.
    pub(crate) async fn analyze(
        &self,
        directory: &Path,
        limits: &Limits,
        deadline: Instant,
    ) -> Result<Analysis, CompileError> {
        let cancellation = CancellationToken::new();
        let step = Step {
            bundle: self,
            directory,
            limits,
            deadline,
            cancellation: &cancellation,
        };
        let output = step
            .run(
                "analyze",
                self.root.join("bin").join("macro_sdk_calls"),
                vec![
                    "--json".into(),
                    "--root".into(),
                    directory.into(),
                    "-I".into(),
                    self.root.join("stdlib").into(),
                    "-I".into(),
                    self.root.join("cmi").into(),
                    "main.cmt".into(),
                ],
            )
            .await?;
        match output.status.code() {
            Some(0 | 1) => analysis(&output.stdout).ok_or_else(|| {
                tracing::error!("the SDK call analysis printed an unexpected answer");
                CompileError::Internal
            }),
            _ => {
                tracing::error!("the SDK call analysis failed");
                Err(CompileError::Internal)
            }
        }
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
            return Err(compiler_diagnostics(&output.stderr, &self.root));
        }

        // 2. The policy check on the typed tree.
        #[cfg(test)]
        let skip_policy = self.skip_policy;
        #[cfg(not(test))]
        let skip_policy = false;
        let output = if skip_policy {
            None
        } else {
            Some(
                step.run(
                    "policy",
                    bin.join("code_mode_policy"),
                    vec!["main.cmt".into()],
                )
                .await?,
            )
        };
        match output.map(|output| (output.status.code(), output.stdout)) {
            None | Some((Some(0), _)) => {}
            Some((Some(1), stdout)) => return Err(policy_diagnostics(&stdout)),
            Some(_) => return Err(internal("the policy check failed")),
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
#[derive(Debug, thiserror::Error)]
pub(crate) enum CompileError {
    /// The compiler or the policy check refused it.
    #[error("the program has {} compile errors", .0.len())]
    Diagnostics(Vec<Diagnostic>),
    /// Cancelled while compiling.
    #[error("cancelled while compiling")]
    Cancelled,
    /// The deadline passed while compiling.
    #[error("timed out while compiling")]
    TimedOut,
    /// A compile step failed for a reason other than the program.
    #[error("a compile step failed to run")]
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
        fields(step = name, exit_code = tracing::field::Empty),
        // Cancelling and timing out are the run's, not the service's;
        // a step that fails to run is logged at error level below.
        err(level = "info")
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
        let mut child = Command::new(program);
        child
            .args(args)
            .env_clear()
            .env("PATH", bundle.join("bin"))
            .env("TMPDIR", self.directory.join("tmp"))
            .env("HOME", self.directory.join("home"))
            .env(
                "OCAMLFIND_CONF",
                bundle.join("findlib").join("findlib.conf"),
            )
            // One binaryen thread: each thread's stack and allocator arena
            // count against the address-space cap, so a thread per core
            // would exhaust it on a large host, and a small program gains
            // nothing from more.
            .env("BINARYEN_CORES", "1")
            .current_dir(self.directory)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            // Its own process group, so stopping it also stops the binaryen
            // tools wasm_of_ocaml runs through /bin/sh.
            .process_group(0);
        // SAFETY: the hook runs in the forked child before exec and only
        // makes setrlimit system calls, which are async-signal-safe; it
        // allocates nothing and touches no lock.
        unsafe {
            child.pre_exec(cap_memory);
        }
        let mut child = child.spawn().map_err(internal)?;
        let group = child
            .id()
            .and_then(|id| i32::try_from(id).ok())
            .and_then(rustix::process::Pid::from_raw);
        if super::deno::limit(&child, self.limits).is_err() {
            stop(&mut child, group).await;
            tracing::error!("could not limit a compile step");
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
        stop(&mut child, group).await;
        if let Ok(output) = &result
            && let Some(code) = output.status.code()
        {
            tracing::Span::current().record("exit_code", code);
        }
        match result {
            Ok(output) if !output.status.success() && out_of_memory(&output.stderr) => {
                Err(CompileError::Diagnostics(vec![Diagnostic {
                    file: None,
                    message: OUT_OF_MEMORY.to_owned(),
                }]))
            }
            Err(CompileError::Internal) => {
                tracing::error!("a compile step failed to run");
                Err(CompileError::Internal)
            }
            result => result,
        }
    }
}

/// Cap a step's address space and turn off core dumps (a compiler that
/// runs out of memory aborts, and its core would land in scratch). Set in
/// the child before exec, so nothing it maps escapes the cap; its children
/// (binaryen) inherit both.
fn cap_memory() -> std::io::Result<()> {
    rustix::process::setrlimit(
        rustix::process::Resource::As,
        rustix::process::Rlimit {
            current: Some(MAX_STEP_ADDRESS_SPACE),
            maximum: Some(MAX_STEP_ADDRESS_SPACE),
        },
    )?;
    rustix::process::setrlimit(
        rustix::process::Resource::Core,
        rustix::process::Rlimit {
            current: Some(0),
            maximum: Some(0),
        },
    )?;
    Ok(())
}

/// Whether a failed step said it ran out of memory: a line of its own
/// that is the OCaml runtime's fatal error (`Fatal error: exception
/// Out_of_memory`, `Fatal error: allocation failure …`) or binaryen's C++
/// abort (`terminate called after throwing … std::bad_alloc`). Only a
/// line's start counts: a compiler diagnostic echoes the program's source
/// (as `<line> | …`), which may hold the same words, and keeps its own
/// error.
fn out_of_memory(stderr: &[u8]) -> bool {
    const RUNTIME_MARKERS: [&str; 4] = [
        "Out_of_memory",
        "Out of memory",
        "out of memory",
        "allocation failure",
    ];
    String::from_utf8_lossy(stderr).lines().any(|line| {
        (line.starts_with("Fatal error:")
            && (RUNTIME_MARKERS.iter().any(|marker| line.contains(marker))
                || line.contains("Not enough heap memory")))
            || (line.starts_with("terminate called") && line.contains("std::bad_alloc"))
    })
}

/// Kill a step's whole process group and reap its leader. The group's other
/// members die with it; init reaps them.
async fn stop(child: &mut tokio::process::Child, group: Option<rustix::process::Pid>) {
    if let Some(group) = group {
        // Nothing left to kill is fine.
        let _ = rustix::process::kill_process_group(group, rustix::process::Signal::KILL);
    }
    super::deno::reap(child).await;
}

/// `ocamlc` prints each problem as a block: `File "main.ml", line L,
/// characters C1-C2:` (or `lines L1-L2`), the source lines with a marker,
/// then `Error: …` or `Warning …`. Errors become diagnostics shaped like
/// `DenoChecker`'s: the block's text ending in `at main.ml:<line>:<column>`.
pub(crate) fn compiler_diagnostics(output: &[u8], bundle: &Path) -> CompileError {
    // Messages about the bundle's own files name them without its path.
    let text = String::from_utf8_lossy(output).replace(&format!("{}/", bundle.display()), "");
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

/// `macro_sdk_calls --json`'s answer: `{"status":"ok","operations":[{"service",
/// "operation",..}]}` or `{"status":"cannot_analyze","reasons":[{"message",
/// "location":{"line","column"}}]}` (0-based columns). `None` for anything else.
pub(crate) fn analysis(stdout: &[u8]) -> Option<Analysis> {
    #[derive(serde::Deserialize)]
    #[serde(tag = "status", rename_all = "snake_case")]
    enum Answer {
        Ok { operations: Vec<Found> },
        CannotAnalyze { reasons: Vec<Reason> },
    }
    #[derive(serde::Deserialize)]
    struct Found {
        service: String,
        operation: String,
        method: String,
        route: String,
    }
    #[derive(serde::Deserialize)]
    struct Reason {
        message: String,
        location: At,
    }
    #[derive(serde::Deserialize)]
    struct At {
        line: u32,
        column: u32,
    }
    Some(match serde_json::from_slice(stdout).ok()? {
        Answer::Ok { operations } => Analysis::Calls(
            operations
                .into_iter()
                .map(|found| SdkCall {
                    operation: SdkOperation {
                        service: found.service,
                        operation_id: found.operation,
                    },
                    method: found.method,
                    route: found.route,
                })
                .collect(),
        ),
        Answer::CannotAnalyze { reasons } if !reasons.is_empty() => Analysis::CannotAnalyze(
            reasons
                .into_iter()
                .map(|reason| AnalysisReason {
                    message: reason.message,
                    line: reason.location.line,
                    column: reason.location.column + 1,
                })
                .collect(),
        ),
        Answer::CannotAnalyze { .. } => return None,
    })
}

fn internal(_error: impl std::fmt::Display) -> CompileError {
    // Host paths and source stay out of infrastructure diagnostics.
    CompileError::Internal
}

pub mod analyze;
pub mod check;

#[cfg(test)]
mod test;
