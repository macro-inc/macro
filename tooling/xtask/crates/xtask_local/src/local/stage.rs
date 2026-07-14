//! Staged-progress UI, mirroring `tooling/scripts/lib/stage-ui.sh`.
//!
//! A bold `[+]` section header, then per-stage lines: an `indicatif` spinner
//! that *resolves in place* into `✓ Done <elapsed>` / `✗ Failed <elapsed>` via
//! the bar's own finish state (no clear-and-reprint), a captured-output dump on
//! failure, and respect for `MACRO_LOCAL_VERBOSE`, `MACRO_LOCAL_DRY_RUN`, and
//! `NO_COLOR`.
//!
//! Only the subprocess capture is hand-rolled, on purpose: stdout and stderr
//! are drained on dedicated threads so a chatty child (e.g. `cargo zigbuild`)
//! cannot deadlock by filling a pipe buffer while we wait. `indicatif` only
//! animates — it never reads the child's pipes.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{Result, bail};
use console::Style;
use indicatif::{ProgressBar, ProgressDrawTarget, ProgressStyle};

const WIDTH: usize = 48;
/// Braille spinner frames + a trailing space (indicatif's "final" tick, which
/// we never show — stages resolve via `finish_with_message`).
const TICK_CHARS: &str = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ ";

/// Drives staged output. Construct once with [`Stage::from_env`] and reuse.
pub struct Stage {
    is_tty: bool,
    verbose: bool,
    dry_run: bool,
    /// When set, this stage's own ✓/✗ lines, spinners, section headers, and
    /// notes are suppressed (commands still run + capture). Used to fold a
    /// multi-step action under a single parent spinner.
    quiet: bool,
}

impl Stage {
    pub fn from_env() -> Self {
        let is_tty = console::Term::stdout().is_term();
        // Disable coloring globally when not a TTY or NO_COLOR is set; every
        // `console::Style` and indicatif template color then becomes a no-op.
        let no_color = std::env::var_os("NO_COLOR").is_some() || !is_tty;
        console::set_colors_enabled(!no_color);
        Stage {
            is_tty,
            verbose: env_flag("MACRO_LOCAL_VERBOSE"),
            dry_run: env_flag("MACRO_LOCAL_DRY_RUN"),
            quiet: false,
        }
    }

    /// Like [`Stage::from_env`], plus an explicit `--verbose` flag OR-ed with the
    /// `MACRO_LOCAL_VERBOSE` env var.
    pub fn from_env_cli(verbose: bool) -> Self {
        let mut s = Self::from_env();
        s.verbose = s.verbose || verbose;
        s
    }

    pub fn is_dry_run(&self) -> bool {
        self.dry_run
    }

    /// Whether verbose mode is on: stream subprocess output, and show every
    /// sub-step's own timing instead of folding it under a parent spinner.
    pub fn is_verbose(&self) -> bool {
        self.verbose
    }

    /// Whether stdout is an interactive terminal (drives the hotkey loop).
    pub fn is_tty(&self) -> bool {
        self.is_tty
    }

    /// A child stage that suppresses its own output, so a multi-step action can
    /// be folded under a single parent spinner. Commands still run and capture;
    /// a failure surfaces via the returned error (with the captured output) so
    /// the parent can show it after its spinner clears.
    pub fn quiet(&self) -> Stage {
        Stage {
            is_tty: self.is_tty,
            verbose: self.verbose,
            dry_run: self.dry_run,
            quiet: true,
        }
    }

    /// A `[+] <label>` section header.
    pub fn section(&self, label: &str) {
        if self.quiet {
            return;
        }
        println!(
            "\n{}",
            Style::new().green().bold().apply_to(format!("[+] {label}"))
        );
    }

    /// A dim hint line.
    pub fn note(&self, text: &str) {
        if self.quiet {
            return;
        }
        println!("{}", Style::new().dim().apply_to(text));
    }

    /// Print a labeled, shell-quoted command (dry-run preview / failure dump).
    pub fn print_command(&self, label: &str, program: &str, args: &[String]) {
        let mut line = Style::new().bold().apply_to(label).to_string();
        line.push(' ');
        line.push_str(&shell_quote(program));
        for a in args {
            line.push(' ');
            line.push_str(&shell_quote(a));
        }
        println!("{line}");
    }

    /// Format a `  <marker> <label> <status>` stage line with one color.
    fn line(&self, marker: &str, label: &str, status: &str, style: &Style) -> String {
        format!(
            "  {} {label:<WIDTH$} {}",
            style.apply_to(marker),
            style.apply_to(status)
        )
    }

    /// A steady-ticking spinner for `label`, or `None` when not a TTY (then
    /// stages just print their resolved line, no animation).
    fn spinner(&self, label: &str) -> Option<ProgressBar> {
        if !self.is_tty {
            return None;
        }
        let pb = ProgressBar::with_draw_target(None, ProgressDrawTarget::stdout());
        pb.set_style(
            ProgressStyle::with_template("  {spinner:.cyan} {prefix} {msg:.cyan}")
                .expect("valid spinner template")
                .tick_chars(TICK_CHARS),
        );
        pb.set_prefix(format!("{label:<WIDTH$}"));
        pb.set_message("Running");
        pb.enable_steady_tick(Duration::from_millis(80));
        Some(pb)
    }

    /// Settle a stage to its final line: resolved in place if a spinner is live
    /// (TTY), else printed plainly (non-TTY).
    fn resolve(&self, spinner: Option<ProgressBar>, line: String) {
        match spinner {
            Some(pb) => {
                pb.set_style(ProgressStyle::with_template("{msg}").expect("valid template"));
                pb.finish_with_message(line);
            }
            None => println!("{line}"),
        }
    }

    /// Run `cmd` as a single stage. In dry-run mode the command is printed, not
    /// executed. In verbose mode output streams live. Otherwise output is
    /// captured and a spinner animates until completion; on failure the
    /// captured output is dumped and the error propagated (fail-fast).
    pub fn run(&self, label: &str, cmd: &mut Command) -> Result<()> {
        let program = cmd.get_program().to_string_lossy().to_string();
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();

        if self.dry_run {
            println!("{}", self.line("•", label, "Dry run", &Style::new().dim()));
            self.print_command("    ", &program, &args);
            return Ok(());
        }

        let start = Instant::now();

        if self.verbose {
            println!("{}", self.line("-", label, "Running", &Style::new().cyan()));
            let status = cmd.status();
            return self.finish(
                None,
                label,
                start,
                status.map(|s| (s, Vec::new())),
                &program,
                &args,
            );
        }

        // Default mode: capture output, animate a spinner. stdout/stderr are
        // drained on their own threads so the child can't deadlock on a full
        // pipe while the spinner ticks and we wait. The spinner only animates;
        // it never touches the child's pipes.
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(anyhow::Error::from)?;
        let mut stdout = child.stdout.take();
        let mut stderr = child.stderr.take();
        let out_handle = std::thread::spawn(move || drain(stdout.as_mut()));
        let err_handle = std::thread::spawn(move || drain(stderr.as_mut()));

        let spinner = if self.quiet {
            None
        } else {
            self.spinner(label)
        };
        let status = child.wait();
        let mut captured = out_handle.join().unwrap_or_default();
        captured.extend(err_handle.join().unwrap_or_default());
        if self.quiet {
            // Silent on success; on failure bubble the captured output up in the
            // error so the parent stage can show it after its spinner clears.
            return match status {
                Ok(s) if s.success() => Ok(()),
                Ok(s) => {
                    let out = String::from_utf8_lossy(&captured);
                    bail!("`{program}` exited with {s}\n{}", out.trim_end());
                }
                Err(e) => Err(anyhow::Error::from(e)),
            };
        }
        self.finish(
            spinner,
            label,
            start,
            status.map(|s| (s, captured)),
            &program,
            &args,
        )
    }

    /// Run an in-process closure as a stage (for work that isn't a subprocess,
    /// e.g. async LocalStack provisioning). The spinner ticks on its own thread
    /// while the closure blocks this one, with the same ✓/✗ contract and
    /// dry-run handling.
    pub fn run_step<F: FnOnce() -> Result<()>>(&self, label: &str, f: F) -> Result<()> {
        if self.dry_run {
            println!("{}", self.line("•", label, "Dry run", &Style::new().dim()));
            return Ok(());
        }
        if self.quiet {
            return f();
        }
        let start = Instant::now();
        let spinner = self.spinner(label);
        let result = f();
        let elapsed = format_elapsed(start.elapsed());
        match result {
            Ok(()) => {
                self.resolve(
                    spinner,
                    self.line(
                        "✓",
                        label,
                        &format!("Done {elapsed}"),
                        &Style::new().green(),
                    ),
                );
                Ok(())
            }
            Err(e) => {
                self.resolve(
                    spinner,
                    self.line(
                        "✗",
                        label,
                        &format!("Failed {elapsed}"),
                        &Style::new().red(),
                    ),
                );
                eprintln!("  {e:?}");
                Err(e)
            }
        }
    }

    fn finish(
        &self,
        spinner: Option<ProgressBar>,
        label: &str,
        start: Instant,
        outcome: std::io::Result<(std::process::ExitStatus, Vec<u8>)>,
        program: &str,
        args: &[String],
    ) -> Result<()> {
        let elapsed = format_elapsed(start.elapsed());
        match outcome {
            Ok((status, _captured)) if status.success() => {
                self.resolve(
                    spinner,
                    self.line(
                        "✓",
                        label,
                        &format!("Done {elapsed}"),
                        &Style::new().green(),
                    ),
                );
                Ok(())
            }
            Ok((status, captured)) => {
                self.resolve(
                    spinner,
                    self.line(
                        "✗",
                        label,
                        &format!("Failed {elapsed}"),
                        &Style::new().red(),
                    ),
                );
                self.print_command("Command failed:", program, args);
                if !captured.is_empty() {
                    println!("{}", Style::new().bold().apply_to("Output:"));
                    for line in String::from_utf8_lossy(&captured).lines() {
                        println!("  {line}");
                    }
                }
                bail!("`{program}` exited with {status}");
            }
            Err(e) => {
                self.resolve(
                    spinner,
                    self.line(
                        "✗",
                        label,
                        &format!("Failed {elapsed}"),
                        &Style::new().red(),
                    ),
                );
                self.print_command("Command failed:", program, args);
                Err(anyhow::Error::from(e))
            }
        }
    }
}

fn drain(reader: Option<&mut impl Read>) -> Vec<u8> {
    let mut buf = Vec::new();
    if let Some(r) = reader {
        let _ = r.read_to_end(&mut buf);
    }
    buf
}

// xtask is host tooling, not a service reading APP_SECRETS_JSON, so reading the
// process environment directly is correct here.
#[allow(clippy::disallowed_methods)]
fn env_flag(name: &str) -> bool {
    std::env::var(name).map(|v| v == "1").unwrap_or(false)
}

fn format_elapsed(d: Duration) -> String {
    let secs = d.as_secs();
    if secs >= 60 {
        format!("{}m{}s", secs / 60, secs % 60)
    } else {
        format!("{secs}s")
    }
}

/// Minimal POSIX shell quoting for the command-echo lines (stand-in for bash's
/// `printf %q`). Bare tokens pass through; anything with shell-special
/// characters is single-quoted.
fn shell_quote(s: &str) -> String {
    if !s.is_empty()
        && s.bytes().all(|b| {
            b.is_ascii_alphanumeric()
                || matches!(
                    b,
                    b'_' | b'-' | b'.' | b'/' | b':' | b'=' | b',' | b'@' | b'+'
                )
        })
    {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}
