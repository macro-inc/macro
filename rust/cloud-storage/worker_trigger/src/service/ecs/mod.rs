mod run_task;
use aws_sdk_ecs as ecs;
use lambda_runtime::tracing;
#[allow(unused_imports)]
use mockall::automock;

#[cfg(not(test))]
pub use ECSClient as ECS;
#[cfg(test)]
pub use MockECSClient as ECS;

#[derive(Clone, Debug)]
pub struct ECSClient {
    /// Inner ECS client
    inner: ecs::Client,
}

#[cfg_attr(test, automock)]
impl ECSClient {
    pub fn new(inner: ecs::Client) -> Self {
        Self { inner }
    }

    pub async fn run_task(
        &self,
        task_definition: &str,
        cluster: &str,
        subnets: Vec<String>,
    ) -> Result<(), anyhow::Error> {
        if cfg!(feature = "local") {
            tracing::trace!("task");
            return Ok(());
        }
        run_task::run_task(&self.inner, task_definition, cluster, subnets).await
    }
}
