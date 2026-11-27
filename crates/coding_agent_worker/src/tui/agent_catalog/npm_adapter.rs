//! Agents reached through an ACP adapter distributed on npm.
//!
//! The adapter is installed once, into a directory named after its pinned
//! version under macrod's own adapter root, and launched from there directly.
//! `npx -y <package>@<version>` would install the same thing, but it does so
//! on every launch: an npm start-up plus a registry round trip before the
//! adapter even runs, on every bridge start and every model probe.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use super::{AgentPreset, Availability, CommandLookup, DetectedAgent, LaunchSpec, is_launch};
use crate::config::Harness;

/// An npm-distributed ACP adapter pinned to one version.
pub(super) struct NpmAdapter {
    /// The exact package to install, `@scope/name@version`.
    pub(super) package: &'static str,
    /// The executable the package installs under `node_modules/.bin`.
    pub(super) bin: &'static str,
    /// The CLI the adapter wraps.
    pub(super) cli: &'static str,
    /// The variable the adapter reads for the CLI to run. The adapter bundles
    /// its own copy of `cli` and runs that one by default; the copy can be
    /// older than the one installed here, advertising a different model
    /// catalogue. The value must be absolute: a bare name is looked up on the
    /// adapter's `PATH`, where its own `node_modules/.bin` comes first.
    pub(super) cli_path_env: &'static str,
    /// Whether the adapter starts the CLI with Node's `child_process.spawn`,
    /// which refuses Windows `.cmd` files without a shell. The variable then
    /// names the program an npm `.cmd` shim runs instead of the shim.
    pub(super) cli_spawned_by_node: bool,
}

impl NpmAdapter {
    pub(super) fn detect(
        &self,
        preset: &dyn AgentPreset,
        commands: &dyn CommandLookup,
    ) -> Availability {
        let missing = [self.cli, "npm"]
            .into_iter()
            .filter(|command| commands.resolve(command).is_none())
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Availability::Unavailable { missing };
        }
        let (Some(cli_path), Some(root)) = (commands.resolve(self.cli), commands.adapter_root())
        else {
            return Availability::Unavailable {
                missing: vec!["HOME"],
            };
        };
        let cli_path = if self.cli_spawned_by_node {
            crate::executable::npm_shim_target_or_self(cli_path)
        } else {
            cli_path.to_owned()
        };
        let install = AdapterInstall {
            package: self.package,
            prefix: root.join(self.package),
            bin: root.join(self.bin_path()),
        };
        Availability::Available(DetectedAgent {
            kind: preset.kind(),
            name: preset.name(),
            launch: LaunchSpec::new(&install.bin.to_string_lossy(), [])
                .with_env(self.cli_path_env, &cli_path),
            note: Some("via npm ACP adapter"),
            install: Some(install),
        })
    }

    /// Whether `harness` launches this adapter at this version, installed by
    /// macrod or through `npx` as earlier releases wrote it.
    pub(super) fn recognizes(&self, harness: &Harness) -> bool {
        is_launch(harness, "npx", &["-y", self.package])
            || (harness.args.is_empty() && Path::new(&harness.command).ends_with(self.bin_path()))
    }

    /// The executable relative to the adapter root. Carrying the package
    /// version in the path is what makes an existing installation trustworthy
    /// without inspecting it.
    fn bin_path(&self) -> PathBuf {
        // npm writes a `.cmd` shim on Windows; the extensionless file beside
        // it is a shell script Windows cannot launch.
        #[cfg(windows)]
        let bin = format!("{}.cmd", self.bin);
        #[cfg(not(windows))]
        let bin = self.bin;
        Path::new(self.package)
            .join("node_modules")
            .join(".bin")
            .join(bin)
    }
}

/// A pinned npm package to install before its executable can be launched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterInstall {
    /// The exact package, `@scope/name@version`.
    pub package: &'static str,
    /// The `npm --prefix` directory holding this one version.
    pub prefix: PathBuf,
    /// The executable the installation produces.
    pub bin: PathBuf,
}

impl AdapterInstall {
    /// Whether the executable is already in place.
    pub fn is_installed(&self) -> bool {
        self.bin.exists()
    }

    /// Install the package unless its executable is already in place.
    pub async fn run(&self) -> Result<(), String> {
        if self.is_installed() {
            return Ok(());
        }
        let output = tokio::process::Command::new(crate::executable::launchable(Path::new("npm")))
            .args(["install", "--no-audit", "--no-fund", "--loglevel=error"])
            .arg("--prefix")
            .arg(&self.prefix)
            .arg(self.package)
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output()
            .await
            .map_err(|error| format!("could not run npm to install {}: {error}", self.package))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::warn!(
                package = self.package,
                status = %output.status,
                stderr = %stderr.trim(),
                "adapter install failed"
            );
            return Err(format!(
                "npm install {} failed: {}",
                self.package,
                failure_summary(&stderr, output.status)
            ));
        }
        if !self.bin.exists() {
            return Err(format!(
                "npm install {} produced no {}",
                self.package,
                self.bin.display()
            ));
        }
        Ok(())
    }
}

/// Paragraphs of npm's error output a user needs to act on, at most this many.
const SUMMARY_PARAGRAPHS: usize = 3;

/// The longest a paragraph of the summary gets, in characters. A failing
/// install script prints its whole output as one paragraph; the full text is
/// in the warning log.
const PARAGRAPH_CHARS: usize = 300;

/// npm's closing line, naming its debug log. It is always last, so showing
/// only the last line hid the actual error.
const NPM_LOG_LINE: &str = "A complete log of this run can be found in:";

/// npm's `key value` metadata lines; they come before the message and say
/// less than it does.
const METADATA_KEYS: [&str; 5] = ["code ", "syscall ", "errno ", "path ", "dest "];

/// Prefixes of npm lines that are not about the failure, such as the
/// update notice npm prints between its error paragraphs.
const UNRELATED_PREFIXES: [&str; 3] = ["npm notice", "npm warn", "npm WARN"];

/// One paragraph of npm's error output, joined from its wrapped lines.
struct Paragraph {
    text: String,
    first_word: String,
    lines: usize,
}

/// The reason npm gave for failing, on one line: its first few error
/// paragraphs without the `npm error` prefix (metadata last), then the path of
/// its full log. npm wraps a paragraph over several lines and separates
/// paragraphs with a bare `npm error`, or, in a titled section such as
/// `npm error 404 ...`, with a line holding only the title. Keeping whole
/// paragraphs keeps a fix npm suggests (such as the `sudo chown` for a
/// root-owned cache) whole.
pub(super) fn failure_summary(stderr: &str, status: std::process::ExitStatus) -> String {
    let mut log = None;
    let mut awaiting_log_path = false;
    let mut paragraphs: Vec<String> = Vec::new();
    let mut open: Option<Paragraph> = None;
    // The title npm repeats on every line of a section, e.g. `notarget`.
    let mut title: Option<String> = None;
    let mut metadata = Vec::new();
    for raw in stderr.lines() {
        let raw = raw.trim();
        if UNRELATED_PREFIXES
            .iter()
            .any(|prefix| raw.starts_with(prefix))
        {
            close(&mut open, &mut paragraphs);
            continue;
        }
        let line = raw
            .trim_start_matches("npm error")
            .trim_start_matches("npm ERR!")
            .trim();
        if let Some(path) = line.strip_prefix(NPM_LOG_LINE) {
            // npm 8 puts the path on the next line.
            match path.trim() {
                "" => awaiting_log_path = true,
                path => log = Some(path),
            }
        } else if awaiting_log_path && !line.is_empty() {
            log = Some(line);
            awaiting_log_path = false;
        } else if METADATA_KEYS.iter().any(|key| line.starts_with(key)) {
            close(&mut open, &mut paragraphs);
            metadata.push(line.to_owned());
        } else if line.is_empty() {
            close(&mut open, &mut paragraphs);
            title = None;
        } else if title.as_deref() == Some(line)
            || open
                .as_ref()
                .is_some_and(|paragraph| paragraph.first_word == line && is_section_title(line))
        {
            // A line holding only the title separates the section's paragraphs.
            title = Some(line.to_owned());
            close(&mut open, &mut paragraphs);
        } else if let Some(paragraph) = open.as_mut() {
            let first_word = line.split_whitespace().next().unwrap_or_default();
            if paragraph.lines == 1
                && first_word == paragraph.first_word
                && is_section_title(first_word)
            {
                title = Some(first_word.to_owned());
            }
            paragraph.text.push(' ');
            paragraph
                .text
                .push_str(without_title(title.as_deref(), line));
            paragraph.lines += 1;
        } else {
            let text = without_title(title.as_deref(), line);
            open = Some(Paragraph {
                text: text.to_owned(),
                first_word: line
                    .split_whitespace()
                    .next()
                    .unwrap_or_default()
                    .to_owned(),
                lines: 1,
            });
        }
    }
    close(&mut open, &mut paragraphs);
    paragraphs.extend(metadata);
    paragraphs.truncate(SUMMARY_PARAGRAPHS);
    let summary = if paragraphs.is_empty() {
        format!("npm exited with {status} and no error output")
    } else {
        paragraphs
            .iter()
            .map(|paragraph| clipped(paragraph))
            .collect::<Vec<_>>()
            .join("; ")
    };
    match log {
        Some(log) => format!("{summary} (npm log: {log})"),
        None => summary,
    }
}

fn close(open: &mut Option<Paragraph>, paragraphs: &mut Vec<String>) {
    if let Some(paragraph) = open.take() {
        paragraphs.push(paragraph.text);
    }
}

/// Whether a word can be the title npm repeats on each line of a section:
/// one token such as `notarget`, `404`, `network` or `ERESOLVE`, never a
/// capitalized prose word such as `To`.
fn is_section_title(word: &str) -> bool {
    let token = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'-';
    let bytes = word.as_bytes();
    !bytes.is_empty()
        && bytes.iter().all(|byte| token(*byte))
        && (bytes.iter().all(|byte| !byte.is_ascii_uppercase())
            || bytes.iter().all(|byte| !byte.is_ascii_lowercase()))
}

fn without_title<'line>(title: Option<&str>, line: &'line str) -> &'line str {
    match title.and_then(|title| line.strip_prefix(title)) {
        Some(rest) if rest.starts_with(' ') => rest.trim_start(),
        _ => line,
    }
}

fn clipped(paragraph: &str) -> String {
    if paragraph.chars().count() <= PARAGRAPH_CHARS {
        return paragraph.to_owned();
    }
    let mut kept: String = paragraph.chars().take(PARAGRAPH_CHARS).collect();
    kept.push('…');
    kept
}
