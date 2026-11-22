//!
//! Job-related structures and implementations for GitHub workflow jobs.

use derive_setters::Setters;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::concurrency::Concurrency;
use crate::step::Input;
use crate::step::{Step, StepType, StepValue};
use crate::{Container, Defaults, Env, Expression, Permissions, Strategy};

#[cfg(test)]
mod timeout_test;

/// A numeric job budget, either fixed or selected by a typed numeric expression.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(untagged)]
pub enum TimeoutMinutes {
    Minutes(u32),
    Expression(Expression),
}

impl From<u32> for TimeoutMinutes {
    fn from(minutes: u32) -> Self {
        Self::Minutes(minutes)
    }
}

impl From<crate::expr::typed::Expr<crate::expr::typed::Num>> for TimeoutMinutes {
    fn from(expression: crate::expr::typed::Expr<crate::expr::typed::Num>) -> Self {
        Self::Expression(Expression::new(expression))
    }
}

/// Represents the environment in which a job runs.
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
#[serde(transparent)]
pub struct RunsOn(Value);

impl<T> From<T> for RunsOn
where
    T: Into<Value>,
{
    /// Converts a value into a `RunsOn` instance.
    fn from(value: T) -> Self {
        Self(value.into())
    }
}

/// A job's `snapshot:`: the custom image GitHub saves the runner as.
#[derive(Debug, Setters, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[setters(strip_option, into)]
pub struct Snapshot {
    pub image_name: String,
    /// The image version, such as `1.*` (the minor version counts up).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

impl Snapshot {
    pub fn new(image_name: impl Into<String>) -> Self {
        Self {
            image_name: image_name.into(),
            version: None,
        }
    }
}

/// Represents a job in the workflow.
/// Field order matches GitHub Actions YAML structure for better readability.
#[derive(Debug, Setters, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[setters(strip_option, into)]
pub struct Job {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub needs: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "if")]
    pub cond: Option<Expression>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runs_on: Option<RunsOn>,
    /// Save the runner, after the job, as a custom image (GitHub-hosted
    /// larger runners only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<Snapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Permissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<crate::Environment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<Concurrency>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outputs: Option<IndexMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<Env>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub defaults: Option<Defaults>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_minutes: Option<TimeoutMinutes>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continue_on_error: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<Container>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub services: Option<IndexMap<String, Container>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strategy: Option<Strategy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<StepValue>>,
}

impl Default for Job {
    /// Creates a default `Job` with `runs_on` set to "ubuntu-latest".
    fn default() -> Self {
        Self {
            needs: None,
            cond: None,
            name: None,
            runs_on: Some(RunsOn(Value::from("ubuntu-latest"))),
            snapshot: None,
            permissions: None,
            environment: None,
            concurrency: None,
            outputs: None,
            env: None,
            defaults: None,
            timeout_minutes: None,
            continue_on_error: None,
            container: None,
            services: None,
            strategy: None,
            steps: None,
        }
    }
}

impl Job {
    /// Creates a new `Job` with the specified name and default settings.
    pub fn new<T: ToString>(name: T) -> Self {
        Self {
            name: Some(name.to_string()),
            runs_on: Some(RunsOn(Value::from("ubuntu-latest"))),
            ..Default::default()
        }
    }

    /// Adds a step to the job.
    pub fn add_step<S: Into<Step<T>>, T: StepType>(mut self, step: S) -> Self {
        let mut steps = self.steps.take().unwrap_or_default();
        let step: Step<T> = step.into();
        let step: StepValue = T::to_value(step);
        steps.push(step);
        self.steps = Some(steps);
        self
    }

    /// Adds an environment variable to the job.
    pub fn add_env<T: Into<Env>>(mut self, new_env: T) -> Self {
        let mut env = self.env.take().unwrap_or_default();

        env.0.extend(new_env.into().0);
        self.env = Some(env);
        self
    }

    pub fn add_needs<J: ToString>(mut self, job_id: J) -> Self {
        if let Some(needs) = self.needs.as_mut() {
            needs.push(job_id.to_string());
        } else {
            self.needs = Some(vec![job_id.to_string()]);
        }
        self
    }

    /// Adds an output to the job.
    pub fn add_output<K: ToString, V: ToString>(mut self, key: K, value: V) -> Self {
        let mut outputs = self.outputs.take().unwrap_or_default();
        outputs.insert(key.to_string(), value.to_string());
        self.outputs = Some(outputs);
        self
    }

    /// Adds a service to the job.
    pub fn add_service<K: ToString, V: Into<Container>>(mut self, key: K, service: V) -> Self {
        let mut services = self.services.take().unwrap_or_default();
        services.insert(key.to_string(), service.into());
        self.services = Some(services);
        self
    }
}

/// A job in a workflow: one that runs steps on a runner, or one that calls a
/// reusable workflow. GitHub accepts a disjoint set of keys for each.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(untagged)]
pub enum JobKind {
    /// Listed first so deserializing tries it first: only a call has `uses`.
    Call(Box<CallJob>),
    Run(Box<Job>),
}

impl From<Job> for JobKind {
    fn from(job: Job) -> Self {
        Self::Run(Box::new(job))
    }
}

impl From<CallJob> for JobKind {
    fn from(job: CallJob) -> Self {
        Self::Call(Box::new(job))
    }
}

/// A job that calls a reusable workflow (`jobs.<id>.uses`). It has no runner
/// or steps; the called workflow's jobs run instead.
#[derive(Debug, Setters, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[setters(strip_option, into)]
pub struct CallJob {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub needs: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "if")]
    pub cond: Option<Expression>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Permissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<Concurrency>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strategy: Option<Strategy>,
    /// The called workflow, e.g. `./.github/workflows/deploy_web_app.yml`.
    #[setters(skip)]
    pub uses: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[setters(skip)]
    pub with: Option<Input>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[setters(skip)]
    pub secrets: Option<CallSecrets>,
}

/// The secrets a call passes to the called workflow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CallSecrets {
    /// `secrets: inherit`: every secret the caller can read.
    Inherit(Inherit),
    /// Named secrets, each set to an expression.
    Pass(IndexMap<String, String>),
}

/// The literal `inherit`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Inherit {
    Inherit,
}

impl CallJob {
    /// A call of the reusable workflow at `uses`.
    pub fn new(uses: impl Into<String>) -> Self {
        Self {
            needs: None,
            cond: None,
            name: None,
            permissions: None,
            concurrency: None,
            strategy: None,
            uses: uses.into(),
            with: None,
            secrets: None,
        }
    }

    pub fn add_needs(mut self, job_id: impl ToString) -> Self {
        self.needs
            .get_or_insert_with(Vec::new)
            .push(job_id.to_string());
        self
    }

    /// Passes the input `name` to the called workflow.
    pub fn add_with(mut self, name: impl ToString, value: impl Into<Value>) -> Self {
        let with = self.with.take().unwrap_or_default();
        self.with = Some(with.add(name, value));
        self
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(mut self) -> Self {
        self.secrets = Some(CallSecrets::Inherit(Inherit::Inherit));
        self
    }

    /// Passes the secret `name` to the called workflow, set to `value`.
    /// Replaces `inherit` if it was set.
    pub fn add_secret(mut self, name: impl ToString, value: impl ToString) -> Self {
        let mut secrets = match self.secrets.take() {
            Some(CallSecrets::Pass(secrets)) => secrets,
            _ => IndexMap::new(),
        };
        secrets.insert(name.to_string(), value.to_string());
        self.secrets = Some(CallSecrets::Pass(secrets));
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_job_default_sets_runs_on() {
        let job = Job::default();
        assert!(job.runs_on.is_some());

        // Verify it's set to "ubuntu-latest"
        if let Some(runs_on) = job.runs_on {
            assert_eq!(
                runs_on.0,
                serde_json::Value::String("ubuntu-latest".to_string())
            );
        }
    }

    #[test]
    fn a_call_job_has_no_runner_and_passes_with_and_secrets() {
        let workflow = crate::Workflow::new("Release").add_job(
            "deploy",
            CallJob::new("./.github/workflows/deploy.yml")
                .name("Deploy")
                .add_with("environment", "prod")
                .add_with("notify", false)
                .inherit_secrets(),
        );

        assert_eq!(
            serde_json::to_value(&workflow).unwrap()["jobs"]["deploy"],
            serde_json::json!({
                "name": "Deploy",
                "uses": "./.github/workflows/deploy.yml",
                "with": { "environment": "prod", "notify": false },
                "secrets": "inherit",
            })
        );
    }

    #[test]
    fn dispatch_inputs_keep_their_order_and_typed_defaults() {
        let dispatch = crate::WorkflowDispatch::default()
            .add_input(
                "suite",
                crate::WorkflowInput::choice(["smoke", "full"]).default("smoke"),
            )
            .add_input("dry-run", crate::WorkflowInput::boolean().default(false));

        assert_eq!(
            serde_json::to_string(&dispatch).unwrap(),
            r#"{"inputs":{"suite":{"type":"choice","options":["smoke","full"],"default":"smoke"},"dry-run":{"type":"boolean","default":false}}}"#
        );
    }
}
