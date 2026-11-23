//! Runs a check's scripts on this machine.
//!
//! The scripts are the job's own `run` steps, copied into the manifest by the
//! generator that writes the workflow, so this runs the text a runner runs.
//! Nothing of GitHub Actions is imitated: the generator refuses a check whose
//! steps need a condition, an expression or an action. What a step gets here
//! is what a shell needs: its directory, its environment, the repository's
//! Nix dev shell, and the files through which steps hand each other values.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::Command,
};

use rootcause::prelude::*;

use crate::{
    file_commands,
    git::in_repository,
    manifest::{Check, Step},
};

#[cfg(test)]
mod test;

/// What a step inherits from the caller's environment. Everything a check
/// depends on comes from the dev shell and the check instead.
const INHERITED: &[&str] = &[
    "HOME",
    "USER",
    "LOGNAME",
    "PATH",
    "TERM",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "NIX_SSL_CERT_FILE",
    "NIX_REMOTE",
    "NIX_PATH",
    "XDG_RUNTIME_DIR",
    "DOCKER_HOST",
    "SSH_AUTH_SOCK",
    "CARGO_HOME",
    "CARGO_TARGET_DIR",
    "RUSTUP_HOME",
];

pub enum Outcome {
    Passed,
    Failed {
        /// The step that failed.
        step: String,
    },
}

/// This machine, running checks in one working tree.
pub struct Machine {
    /// The repository's root.
    pub workspace: PathBuf,
    /// `RUNNER_TEMP`: emptied before every check.
    pub scratch: PathBuf,
    /// `TMPDIR` for the steps: the caller's own, which the tool never
    /// removes. A step may start a server that outlives the run and keeps
    /// its `TMPDIR`, as sccache does for every build on the machine.
    pub tmp: PathBuf,
}

/// Appended to a dev shell's environment. The environment makes a temporary
/// directory for every shell that sources it, names it `TMPDIR` and never
/// removes it; a runner is thrown away, a machine's `/tmp` is not. So the
/// directory just made goes, and every shell uses [`Machine::tmp`].
fn one_temporary_directory(tmp: &Path) -> String {
    let tmp = format!("'{}'", tmp.to_string_lossy().replace('\'', r"'\''"));
    format!(
        "\nrmdir \"$NIX_BUILD_TOP\" 2>/dev/null || true\n\
         export NIX_BUILD_TOP={tmp} TMP={tmp} TMPDIR={tmp} TEMP={tmp} TEMPDIR={tmp}\n"
    )
}

/// What steps have handed to the ones after them.
#[derive(Default)]
struct Handed {
    env: BTreeMap<String, String>,
    /// Directories added to `PATH`, oldest first.
    path: Vec<String>,
}

impl Machine {
    /// The environment of a dev shell, as `setup-nix-dev-shell` writes it.
    fn dev_env(&self, shell: &str) -> Result<PathBuf, Report> {
        let path = self.scratch.join(format!("nix-dev-env-{shell}"));

        eprintln!("▶ entering the `{shell}` dev shell");
        let output = in_repository("nix", &self.workspace)
            .args(["print-dev-env", "--accept-flake-config"])
            .arg(format!(".#{shell}"))
            .stderr(std::process::Stdio::inherit())
            .output()
            .context(
                "could not run nix; cargo x attest runs checks in the repository's dev shell",
            )?;
        if !output.status.success() {
            bail!("nix print-dev-env .#{shell} failed");
        }

        let mut environment = output.stdout;
        environment.extend(one_temporary_directory(&self.tmp).into_bytes());
        std::fs::write(&path, environment).context("could not save the dev shell environment")?;
        Ok(path)
    }

    /// Run a check's steps in order, in its dev shell.
    pub fn run(&self, check: &Check) -> Result<Outcome, Report> {
        self.fresh_scratch()?;
        let dev_env = self.dev_env(&check.dev_shell)?;
        self.run_steps(check, Some(&dev_env))
    }

    fn fresh_scratch(&self) -> Result<(), Report> {
        self.clear();
        std::fs::create_dir_all(&self.scratch)
            .context(format!("could not create {}", self.scratch.display()))?;
        Ok(())
    }

    /// Remove what the last check left in the scratch directory.
    pub fn clear(&self) {
        let _ = std::fs::remove_dir_all(&self.scratch);
    }

    fn run_steps(&self, check: &Check, dev_env: Option<&Path>) -> Result<Outcome, Report> {
        let mut handed = Handed::default();
        for (number, step) in check.steps.iter().enumerate() {
            if !self.run_step(check, step, number, dev_env, &mut handed)? {
                return Ok(Outcome::Failed {
                    step: step.name.clone(),
                });
            }
        }
        Ok(Outcome::Passed)
    }

    /// Run one script. False when it failed, or wrote a file a runner refuses.
    fn run_step(
        &self,
        check: &Check,
        step: &Step,
        number: usize,
        dev_env: Option<&Path>,
        handed: &mut Handed,
    ) -> Result<bool, Report> {
        let files = self.scratch.join(format!("step-{number}"));
        let file = |suffix: &str| files.with_extension(suffix);
        std::fs::write(file("sh"), &step.run).context("could not write a step's script")?;
        for handoff in ["output", "env", "path", "summary"] {
            std::fs::write(file(handoff), "").context("could not create a step's files")?;
        }

        // GitHub's defaults: plain `bash -e`, and stricter when a step names bash.
        let mut command = Command::new("bash");
        if step.pipefail {
            command.args(["--noprofile", "--norc", "-eo", "pipefail"]);
        } else {
            command.arg("-e");
        }
        let directory = match &step.working_directory {
            Some(directory) => self.workspace.join(directory),
            None => self.workspace.clone(),
        };
        command.arg(file("sh")).current_dir(directory).env_clear();

        for inherited in INHERITED {
            if let Some(value) = std::env::var_os(inherited) {
                command.env(inherited, value);
            }
        }
        let inherited_path = std::env::var_os("PATH").unwrap_or_default();
        let path = std::env::join_paths(
            handed
                .path
                .iter()
                .rev()
                .map(PathBuf::from)
                .chain(std::env::split_paths(&inherited_path)),
        )
        .context("a step added a directory PATH can't hold")?;

        command
            .env("PATH", path)
            .env("CI", "true")
            .env("GITHUB_ACTIONS", "true")
            .env("RUNNER_OS", "Linux")
            .env("RUNNER_TEMP", &self.scratch)
            .env("TMPDIR", &self.tmp)
            .env("GITHUB_WORKSPACE", &self.workspace)
            .env("GITHUB_OUTPUT", file("output"))
            .env("GITHUB_ENV", file("env"))
            .env("GITHUB_PATH", file("path"))
            .env("GITHUB_STEP_SUMMARY", file("summary"))
            .envs(&check.env)
            .envs(&handed.env)
            .envs(&step.env);
        if let Some(dev_env) = dev_env {
            command.env("BASH_ENV", dev_env);
        }

        eprintln!("▶ {}", step.name);
        let status = command
            .status()
            .context(format!("could not run `{}`", step.name))?;

        let read = |suffix: &str| -> Result<String, Report> {
            Ok(std::fs::read_to_string(file(suffix)).context("could not read a step's files")?)
        };
        // A runner fails a step whose files it can't read, so this is the
        // step's failure and not the tool's.
        match file_commands::parse(&read("env")?).and_then(|env| {
            file_commands::parse(&read("output")?)?;
            Ok(env)
        }) {
            Ok(env) => handed.env.extend(env),
            Err(report) => {
                eprintln!(
                    "`{}` wrote a file a runner would refuse: {report}",
                    step.name
                );
                return Ok(false);
            }
        }
        handed.path.extend(read("path")?.lines().map(str::to_owned));

        Ok(status.success())
    }
}
