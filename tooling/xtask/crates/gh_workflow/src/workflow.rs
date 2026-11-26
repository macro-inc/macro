//!
//! The serde representation of Github Actions Workflow.

use derive_setters::Setters;
use indexmap::IndexMap;
use merge::Merge;
use serde::{Deserialize, Serialize};

use crate::concurrency::Concurrency;
use crate::defaults::Defaults;
// Import the moved types
use crate::env::Env;
use crate::error::Result;
use crate::job::JobKind;
use crate::permissions::Permissions;
use crate::Event;

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(transparent)]
pub struct Jobs(pub(crate) IndexMap<String, JobKind>);
impl Jobs {
    pub fn add(mut self, key: String, value: JobKind) -> Self {
        self.0.insert(key, value);
        self
    }

    /// Gets a reference to a job by its key.
    ///
    /// # Arguments
    ///
    /// * `key` - The key of the job to retrieve
    ///
    /// # Returns
    ///
    /// Returns `Some(&JobKind)` if the job exists, `None` otherwise.
    pub fn get(&self, key: &str) -> Option<&JobKind> {
        self.0.get(key)
    }
}

/// Represents the configuration for a GitHub workflow.
///
/// A workflow is a configurable automated process made up of one or more jobs.
/// This struct defines the properties that can be set in a workflow YAML file
/// for GitHub Actions, including the name, environment variables, permissions,
/// jobs, concurrency settings, and more.
#[derive(Debug, Default, Setters, Serialize, Deserialize, Clone)]
#[serde(rename_all = "kebab-case")]
#[setters(strip_option, into)]
pub struct Workflow {
    /// The name of the workflow. GitHub displays the names of your workflows
    /// under your repository's "Actions" tab.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// Environment variables that can be used in the workflow.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<Env>,

    /// The name for workflow runs generated from the workflow.
    /// GitHub displays the workflow run name in the list of workflow runs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_name: Option<String>,

    /// The event that triggers the workflow. This can include events like
    /// `push`, `pull_request`, etc.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on: Option<Event>,

    /// Permissions granted to the `GITHUB_TOKEN` for the workflow.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Permissions>,

    /// The jobs that are defined in the workflow.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<Jobs>,

    /// Concurrency settings for the workflow, allowing control over
    /// how jobs are executed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<Concurrency>,

    /// Default settings for jobs in the workflow.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub defaults: Option<Defaults>,
}

impl Workflow {
    /// Creates a new `Workflow` with the specified name.
    pub fn new<T: ToString>(name: T) -> Self {
        Self {
            name: Some(name.to_string()),
            ..Default::default()
        }
    }

    /// Converts the `Workflow` to a YAML string representation.
    pub fn to_string(&self) -> Result<String> {
        crate::yaml::workflow_to_string(self)
    }

    /// Adds a job to the workflow with the specified ID and job configuration.
    pub fn add_job<T: ToString, J: Into<JobKind>>(mut self, id: T, job: J) -> Self {
        let key = id.to_string();
        let jobs = self.jobs.take().unwrap_or_default().add(key, job.into());

        self.jobs = Some(jobs);
        self
    }

    /// Adds an event to the workflow.
    pub fn add_event<T: Into<Event>>(mut self, that: T) -> Self {
        if let Some(mut this) = self.on.take() {
            this.merge(that.into());
            self.on = Some(this);
        } else {
            self.on = Some(that.into());
        }
        self
    }

    /// Adds an environment variable to the workflow.
    pub fn add_env<T: Into<Env>>(mut self, new_env: T) -> Self {
        let mut env = self.env.take().unwrap_or_default();

        env.0.extend(new_env.into().0);
        self.env = Some(env);
        self
    }
}
