use anyhow::Context;

pub use macro_env::Environment;
use macro_env_var::env_vars;

env_vars! {
    pub struct TaskDefinition;
    pub struct Cluster;
    pub struct Subnets;
}

/// The configuration parameters for the application.
///
/// These can either be passed on the command line, or pulled from environment variables.
/// The latter is preferred as environment variables are one of the recommended ways to
/// populate the Docker container
///
/// See `.env.sample` in document-storage-service root for details.
#[derive(Debug)]
pub struct Config {
    /// The task definition to run
    pub task_definition: String,

    /// The cluster to run on
    pub cluster: String,

    /// The subnets to use
    pub subnets: Vec<String>,

    /// The environment we are in
    pub environment: Environment,
}

impl Config {
    pub fn new(
        task_definition: &str,
        cluster: &str,
        subnets: Vec<String>,
        environment: Environment,
    ) -> Self {
        Config {
            task_definition: task_definition.to_string(),
            cluster: cluster.to_string(),
            subnets,
            environment,
        }
    }

    pub fn from_env() -> anyhow::Result<Self> {
        let task_definition = TaskDefinition::new().context("TASK_DEFINITION must be provided")?;
        let cluster = Cluster::new().context("CLUSTER must be provided")?;
        let subnets: Vec<String> = Subnets::new()
            .context("SUBNETS must be provided")?
            .split(",")
            .map(|s| s.to_string())
            .collect::<Vec<String>>();
        let environment = Environment::new_or_prod();

        Ok(Config::new(
            task_definition.as_ref(),
            cluster.as_ref(),
            subnets,
            environment,
        ))
    }
}
