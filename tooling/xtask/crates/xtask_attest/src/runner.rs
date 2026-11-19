//! Runs a workflow job's steps on this machine, as the runner would.
//!
//! The job comes from the generated workflow in the checkout, so what runs is
//! what `PR CI` would run: each `run` step's own script, shell, directory,
//! environment and condition. Three things differ from a runner, all of them
//! named by the check manifest:
//!
//! - actions that set a runner up are skipped, since the steps run in the
//!   repository's Nix dev shell (the one `setup-nix-dev-shell` enters), which
//!   pins the same tools;
//! - `run` steps that keep a runner's caches are skipped;
//! - the path-filter action is emulated from the pull request's files.
//!
//! The repository's own composite actions are run step by step. Anything
//! else a job asks for (service containers, secrets, another shell, an
//! unknown action) is an error, never a silent skip.

use std::{collections::BTreeMap, path::PathBuf, process::Command};

use rootcause::{option_ext::OptionExt, prelude::*};
use serde_yaml::Value as Yaml;

use crate::{
    expression::{self, Contexts, Value},
    file_commands,
    manifest::Manifest,
    paths_filter,
};

#[cfg(test)]
mod test;

/// Named values: step outputs, job outputs, environment.
pub type Outputs = BTreeMap<String, String>;

/// The action that enters a dev shell; its `shell` input names which.
const DEV_SHELL_ACTION: &str = "./.github/actions/setup-nix-dev-shell";
const DEFAULT_DEV_SHELL: &str = "default";

/// The action that checks the repository out; its `fetch-depth` says how
/// much history the job reads.
const CHECKOUT_ACTION: &str = "actions/checkout@";

/// Where runner images keep the user's files; step environments name it.
const RUNNER_HOME: &str = "/home/runner";

/// What a step inherits from the caller's environment. Everything a check
/// depends on comes from the dev shell and the job instead.
const INHERITED: &[&str] = &[
    "HOME",
    "USER",
    "LOGNAME",
    "PATH",
    "TERM",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "SSL_CERT_FILE",
    "NIX_SSL_CERT_FILE",
    "NIX_REMOTE",
    "NIX_PATH",
    "XDG_RUNTIME_DIR",
    "DOCKER_HOST",
    "SSH_AUTH_SOCK",
];

/// Which of a job's `run` steps to run.
pub enum Plan<'a> {
    /// None: only decide the path filters. For a job whose steps act on GitHub.
    FiltersOnly,
    /// Every step that is not runner upkeep.
    EveryStep,
    /// These, and it is an error for the job to hold any other.
    Steps(&'a [String]),
}

pub enum JobResult {
    Passed(Outputs),
    Failed {
        step: String,
    },
    /// This machine can't run the job as a runner would; why.
    Unavailable(String),
}

/// This machine, standing in for a runner.
pub struct Machine<'a> {
    pub manifest: &'a Manifest,
    /// The checkout the job runs in.
    pub workspace: PathBuf,
    /// `RUNNER_TEMP`: scripts and the files steps hand values through.
    pub scratch: PathBuf,
    /// Stands in for [`RUNNER_HOME`] wherever a step's environment names it.
    pub runner_home: PathBuf,
    /// The `github` context, by dotted name, and the matching `GITHUB_*` variables.
    pub github: BTreeMap<&'static str, String>,
    pub changed_files: Vec<String>,
    /// Whether the checkout's history is cut short.
    pub shallow: bool,
    /// Puts the workspace back to the commit. Every job on a runner, and
    /// every row of a matrix job, starts from a checkout of its own.
    pub fresh_checkout: &'a dyn Fn() -> Result<(), Report>,
}

/// What steps share across a job, composite actions included.
struct Shared {
    /// The workflow's and job's environment, plus what steps add (`GITHUB_ENV`).
    env: Outputs,
    /// Directories steps add to `PATH` (`GITHUB_PATH`), oldest first.
    path: Vec<String>,
    /// The dev shell's environment, sourced by every step's bash.
    dev_env: Option<PathBuf>,
    scripts_written: usize,
}

struct Record {
    outputs: Outputs,
    outcome: &'static str,
}

/// What a job, or one composite action inside it, sees.
struct Local<'a> {
    steps: BTreeMap<String, Record>,
    needs: &'a BTreeMap<String, Outputs>,
    matrix: Outputs,
    inputs: Outputs,
}

struct Lookup<'a> {
    machine: &'a Machine<'a>,
    shared: &'a Shared,
    local: &'a Local<'a>,
    step_env: &'a Outputs,
}

impl Contexts for Lookup<'_> {
    fn lookup(&self, path: &[String]) -> Result<Value, Report> {
        let parts: Vec<&str> = path.iter().map(String::as_str).collect();
        let text = |value: Option<&String>| value.map_or(Value::Null, |v| Value::String(v.clone()));

        Ok(match parts.as_slice() {
            ["needs", job, "outputs", name] => text(
                self.local
                    .needs
                    .get(*job)
                    .and_then(|outputs| outputs.get(*name)),
            ),
            ["steps", id, "outputs", name] => text(
                self.local
                    .steps
                    .get(*id)
                    .and_then(|step| step.outputs.get(*name)),
            ),
            ["steps", id, "outcome" | "conclusion"] => self
                .local
                .steps
                .get(*id)
                .map_or(Value::Null, |step| Value::String(step.outcome.to_owned())),
            ["env", name] => text(
                self.step_env
                    .get(*name)
                    .or_else(|| self.shared.env.get(*name)),
            ),
            ["matrix", name] => text(self.local.matrix.get(*name)),
            ["inputs", name] => text(self.local.inputs.get(*name)),
            ["runner", "os"] => Value::String("Linux".to_owned()),
            ["runner", "temp"] => Value::String(self.machine.scratch.display().to_string()),
            ["github", rest @ ..] => match self.machine.github.get(rest.join(".").as_str()) {
                Some(value) => Value::String(value.clone()),
                None => bail!("cargo x attest has no value for `{}`", parts.join(".")),
            },
            _ => bail!(
                "`{}` is not available on a developer's machine",
                parts.join(".")
            ),
        })
    }
}

fn name_of(step: &Yaml) -> &str {
    step["name"]
        .as_str()
        .or_else(|| step["id"].as_str())
        .unwrap_or("unnamed step")
}

pub fn scalar(value: &Yaml) -> Option<String> {
    match value {
        Yaml::String(text) => Some(text.clone()),
        Yaml::Bool(flag) => Some(flag.to_string()),
        Yaml::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

/// A mapping of names to scalars: `env`, `with`, a matrix row.
fn scalars(mapping: &Yaml) -> impl Iterator<Item = (String, String)> + '_ {
    mapping
        .as_mapping()
        .into_iter()
        .flatten()
        .filter_map(|(key, value)| Some((key.as_str()?.to_owned(), scalar(value)?)))
}

/// The rows a job's matrix expands to; one empty row without a matrix.
fn matrix_rows(job: &Yaml) -> Result<Vec<Outputs>, Report> {
    let Some(matrix) = job["strategy"]["matrix"].as_mapping() else {
        return Ok(vec![Outputs::new()]);
    };
    let [(key, values)] = matrix.iter().collect::<Vec<_>>()[..] else {
        bail!("cargo x attest runs matrices of one dimension only");
    };

    let key = key.as_str().context("a matrix key is not a string")?;
    values
        .as_sequence()
        .context("a matrix dimension is not a list")?
        .iter()
        .map(|value| {
            let value = scalar(value).context("a matrix value is not a scalar")?;
            Ok(Outputs::from([(key.to_owned(), value)]))
        })
        .collect()
}

impl Machine<'_> {
    fn is_runner_action(&self, action: &str) -> bool {
        self.manifest
            .runner_actions
            .iter()
            .any(|known| known == action)
    }

    /// The environment of a dev shell, as `setup-nix-dev-shell` writes it.
    fn dev_env(&self, shell: &str) -> Result<PathBuf, Report> {
        let path = self.scratch.join(format!("nix-dev-env-{shell}"));
        if path.exists() {
            return Ok(path);
        }

        eprintln!("▶ entering the `{shell}` dev shell");
        let output = crate::checkout::in_repository("nix", &self.workspace)
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

        std::fs::write(&path, output.stdout).context("could not save the dev shell environment")?;
        Ok(path)
    }

    /// Render a step's or job's `env`, pointing runner paths at this machine.
    fn environment(&self, env: &Yaml, lookup: &Lookup<'_>) -> Result<Outputs, Report> {
        scalars(env)
            .map(|(name, value)| {
                let value = expression::render(&value, lookup)?;
                let home = self.runner_home.display().to_string();
                Ok((name, value.replace(RUNNER_HOME, &home)))
            })
            .collect()
    }

    /// Run one job of a workflow. `needs` holds the outputs of the jobs it
    /// waits for. A matrix job runs every row, one after the other.
    pub fn run_job(
        &self,
        workflow: &Yaml,
        job_id: &str,
        plan: &Plan<'_>,
        needs: &BTreeMap<String, Outputs>,
    ) -> Result<JobResult, Report> {
        let job = &workflow["jobs"][job_id];
        let steps = job["steps"]
            .as_sequence()
            .context(format!("job `{job_id}` has no steps"))?;
        if job.get("services").is_some() && !matches!(plan, Plan::FiltersOnly) {
            bail!("job `{job_id}` needs service containers, which cargo x attest does not start");
        }
        // `defaults.run` changes the shell and directory of every step that
        // names neither.
        if (workflow.get("defaults").is_some() || job.get("defaults").is_some())
            && !matches!(plan, Plan::FiltersOnly)
        {
            bail!("job `{job_id}` runs under `defaults`, which cargo x attest does not apply");
        }

        // `fetch-depth: 0` is a job saying it reads history a shallow clone lacks.
        let reads_all_history = steps.iter().any(|step| {
            step["uses"]
                .as_str()
                .is_some_and(|uses| uses.starts_with(CHECKOUT_ACTION))
                && scalar(&step["with"]["fetch-depth"]).as_deref() == Some("0")
        });
        if reads_all_history && self.shallow && !matches!(plan, Plan::FiltersOnly) {
            return Ok(JobResult::Unavailable(
                "it reads the full history, and this clone is shallow (`git fetch --unshallow` in your repository lets it run)"
                    .to_owned(),
            ));
        }

        let dev_env = match plan {
            Plan::FiltersOnly => None,
            _ => {
                let shell = steps
                    .iter()
                    .find(|step| step["uses"].as_str() == Some(DEV_SHELL_ACTION))
                    .and_then(|step| step["with"]["shell"].as_str())
                    .unwrap_or(DEFAULT_DEV_SHELL);
                Some(self.dev_env(shell)?)
            }
        };

        let mut outputs = Outputs::new();
        for matrix in matrix_rows(job)? {
            if !matches!(plan, Plan::FiltersOnly) {
                (self.fresh_checkout)()?;
            }
            let mut shared = Shared {
                env: Outputs::new(),
                path: Vec::new(),
                dev_env: dev_env.clone(),
                scripts_written: 0,
            };
            let mut local = Local {
                steps: BTreeMap::new(),
                needs,
                matrix,
                inputs: Outputs::new(),
            };

            // The job's environment may read the workflow's, so one at a time.
            for env in [&workflow["env"], &job["env"]] {
                let rendered = self.environment(
                    env,
                    &Lookup {
                        machine: self,
                        shared: &shared,
                        local: &local,
                        step_env: &Outputs::new(),
                    },
                )?;
                shared.env.extend(rendered);
            }

            if let Some(step) = self.run_steps(steps, plan, &mut shared, &mut local)? {
                return Ok(JobResult::Failed { step });
            }

            let lookup = Lookup {
                machine: self,
                shared: &shared,
                local: &local,
                step_env: &Outputs::new(),
            };
            for (name, value) in scalars(&job["outputs"]) {
                outputs.insert(name, expression::render(&value, &lookup)?);
            }
        }
        Ok(JobResult::Passed(outputs))
    }

    /// Run steps in order; the name of the first that fails, if one does.
    fn run_steps(
        &self,
        steps: &[Yaml],
        plan: &Plan<'_>,
        shared: &mut Shared,
        local: &mut Local<'_>,
    ) -> Result<Option<String>, Report> {
        for step in steps {
            let name = name_of(step);
            let no_env = Outputs::new();
            let lookup = Lookup {
                machine: self,
                shared,
                local,
                step_env: &no_env,
            };
            let wanted = |lookup: &Lookup<'_>| -> Result<bool, Report> {
                // `if: false` is a YAML boolean, not a string.
                match scalar(&step["if"]) {
                    Some(condition) => Ok(expression::evaluate(&condition, lookup)?.truthy()),
                    None => Ok(true),
                }
            };

            if let Some(uses) = step["uses"].as_str() {
                let action = uses.split_once('@').map_or(uses, |(action, _)| action);

                if action == self.manifest.filter_action {
                    if !wanted(&lookup)? {
                        continue;
                    }
                    let filters = step["with"]["filters"]
                        .as_str()
                        .context(format!("`{name}` has no filters"))?;
                    let outputs = paths_filter::outputs(filters, &self.changed_files)?;
                    if let Some(id) = step["id"].as_str() {
                        local.steps.insert(
                            id.to_owned(),
                            Record {
                                outputs,
                                outcome: "success",
                            },
                        );
                    }
                } else if self.is_runner_action(action) || matches!(plan, Plan::FiltersOnly) {
                    // A runner's setup, or a step this plan leaves out.
                } else if action.starts_with("./") {
                    if !wanted(&lookup)? {
                        continue;
                    }
                    let with = self.environment(&step["with"], &lookup)?;
                    if let Some(failed) = self.run_composite(action, with, shared, local)? {
                        return Ok(Some(format!("{name} / {failed}")));
                    }
                } else {
                    bail!("`{name}` uses {action}, which cargo x attest can't stand in for");
                }
                continue;
            }

            if self.manifest.runner_steps.iter().any(|known| known == name) {
                continue;
            }
            match plan {
                Plan::FiltersOnly => continue,
                Plan::Steps(listed) if !listed.iter().any(|listed| listed == name) => bail!(
                    "step `{name}` is neither part of the check nor runner upkeep; run `cargo x workflows`"
                ),
                Plan::Steps(_) | Plan::EveryStep => {}
            }

            if !wanted(&lookup)? {
                if let Some(id) = step["id"].as_str() {
                    local.steps.insert(
                        id.to_owned(),
                        Record {
                            outputs: Outputs::new(),
                            outcome: "skipped",
                        },
                    );
                }
                continue;
            }

            let record = self.run_script(step, shared, local)?;
            let failed = record.outcome != "success";
            if let Some(id) = step["id"].as_str() {
                local.steps.insert(id.to_owned(), record);
            }
            if failed {
                return Ok(Some(name.to_owned()));
            }
        }
        Ok(None)
    }

    /// Run one of the repository's composite actions: its steps see its
    /// inputs and their own step ids, and share the job's environment.
    fn run_composite(
        &self,
        action: &str,
        with: Outputs,
        shared: &mut Shared,
        local: &Local<'_>,
    ) -> Result<Option<String>, Report> {
        let path = self.workspace.join(action).join("action.yml");
        let text =
            std::fs::read_to_string(&path).context(format!("could not read {}", path.display()))?;
        let definition: Yaml =
            serde_yaml::from_str(&text).context(format!("{} is not YAML", path.display()))?;
        let steps = definition["runs"]["steps"]
            .as_sequence()
            .context(format!("{action} is not a composite action"))?;

        let mut inputs: Outputs = definition["inputs"]
            .as_mapping()
            .into_iter()
            .flatten()
            .filter_map(|(name, input)| {
                Some((name.as_str()?.to_owned(), scalar(&input["default"])?))
            })
            .collect();
        inputs.extend(with);

        let mut inner = Local {
            steps: BTreeMap::new(),
            needs: local.needs,
            matrix: local.matrix.clone(),
            inputs,
        };
        self.run_steps(steps, &Plan::EveryStep, shared, &mut inner)
    }

    /// Run a `run` step's script and collect what it hands to later steps.
    fn run_script(
        &self,
        step: &Yaml,
        shared: &mut Shared,
        local: &Local<'_>,
    ) -> Result<Record, Report> {
        let name = name_of(step);
        let no_env = Outputs::new();
        let lookup = Lookup {
            machine: self,
            shared,
            local,
            step_env: &no_env,
        };
        let step_env = self.environment(&step["env"], &lookup)?;
        let lookup = Lookup {
            machine: self,
            shared,
            local,
            step_env: &step_env,
        };

        let script = expression::render(
            step["run"].as_str().context("a run step has no script")?,
            &lookup,
        )?;
        let directory = match step["working-directory"].as_str() {
            Some(directory) => self.workspace.join(expression::render(directory, &lookup)?),
            None => self.workspace.clone(),
        };

        let files = self
            .scratch
            .join(format!("step-{}", shared.scripts_written));
        shared.scripts_written += 1;
        let file = |suffix: &str| files.with_extension(suffix);
        std::fs::write(file("sh"), script).context("could not write a step's script")?;
        for handoff in ["output", "env", "path", "summary"] {
            std::fs::write(file(handoff), "").context("could not create a step's files")?;
        }

        // GitHub's defaults: plain `bash -e`, and stricter when a step names bash.
        let mut command = Command::new("bash");
        match step["shell"].as_str() {
            None => command.arg("-e"),
            Some("bash") => command.args(["--noprofile", "--norc", "-eo", "pipefail"]),
            Some(other) => bail!("`{name}` runs in {other}, which cargo x attest does not run"),
        };
        command.arg(file("sh")).current_dir(directory).env_clear();

        for inherited in INHERITED {
            if let Some(value) = std::env::var_os(inherited) {
                command.env(inherited, value);
            }
        }
        let inherited_path = std::env::var_os("PATH").unwrap_or_default();
        let path = std::env::join_paths(
            shared
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
            .env("GITHUB_OUTPUT", file("output"))
            .env("GITHUB_ENV", file("env"))
            .env("GITHUB_PATH", file("path"))
            .env("GITHUB_STEP_SUMMARY", file("summary"))
            .envs(self.github.iter().map(|(name, value)| {
                (
                    format!("GITHUB_{}", name.to_uppercase().replace('.', "_")),
                    value,
                )
            }))
            .envs(&shared.env)
            .envs(&step_env);
        if let Some(dev_env) = &shared.dev_env {
            command.env("BASH_ENV", dev_env);
        }

        eprintln!("▶ {name}");
        let status = command
            .status()
            .context(format!("could not run `{name}`"))?;

        let read = |suffix: &str| -> Result<String, Report> {
            Ok(std::fs::read_to_string(file(suffix)).context("could not read a step's files")?)
        };
        let outputs: Outputs = file_commands::parse(&read("output")?)?
            .into_iter()
            .collect();
        shared.env.extend(file_commands::parse(&read("env")?)?);
        shared.path.extend(read("path")?.lines().map(str::to_owned));

        Ok(Record {
            outputs,
            outcome: if status.success() {
                "success"
            } else {
                "failure"
            },
        })
    }
}

/// The digest an attestation carries for the selector outputs a job reads:
/// sorted `name=value` lines, SHA-256, 16 hex digits. `path-check` computes
/// the same over its own outputs (`accept_attested_checks.ts`).
pub fn inputs_digest(inputs: &[String], outputs: &Outputs) -> String {
    use sha2::{Digest, Sha256};

    let mut names: Vec<&String> = inputs.iter().collect();
    names.sort();
    let lines: String = names
        .iter()
        .map(|name| format!("{name}={}\n", outputs.get(*name).map_or("", String::as_str)))
        .collect();
    hex::encode(&Sha256::digest(lines)[..8])
}
