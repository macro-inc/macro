//!
//! Job-related structures and implementations for GitHub workflow jobs.

use derive_setters::Setters;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::concurrency::Concurrency;
use crate::step::{Step, StepType, StepValue};
use crate::{
    Artifacts, Container, Defaults, Env, Expression, Permissions, RetryStrategy, Secret, Strategy,
};

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
    pub timeout_minutes: Option<u32>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uses: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secrets: Option<IndexMap<String, Secret>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry: Option<RetryStrategy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifacts: Option<Artifacts>,
}

impl Default for Job {
    /// Creates a default `Job` with `runs_on` set to "ubuntu-latest".
    fn default() -> Self {
        Self {
            needs: None,
            cond: None,
            name: None,
            runs_on: Some(RunsOn(Value::from("ubuntu-latest"))),
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
            uses: None,
            secrets: None,
            retry: None,
            artifacts: None,
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

    /// Adds a secret to the job.
    pub fn add_secret<K: ToString, V: Into<Secret>>(mut self, key: K, secret: V) -> Self {
        let mut secrets = self.secrets.take().unwrap_or_default();
        secrets.insert(key.to_string(), secret.into());
        self.secrets = Some(secrets);
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
}
