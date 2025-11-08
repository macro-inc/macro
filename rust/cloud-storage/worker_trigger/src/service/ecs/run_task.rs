use anyhow::Context;
use aws_sdk_ecs::types::{AssignPublicIp, AwsVpcConfiguration, NetworkConfiguration};
use lambda_runtime::tracing;

#[tracing::instrument(skip(ecs_client))]
pub(in crate::service::ecs) async fn run_task(
    ecs_client: &aws_sdk_ecs::Client,
    task_definition: &str,
    cluster: &str,
    subnets: Vec<String>,
) -> Result<(), anyhow::Error> {
    #[cfg(feature = "local")]
    {
        tracing::trace!("task");
        return Ok(());
    }

    let aws_vpc_configuration: AwsVpcConfiguration = AwsVpcConfiguration::builder()
        .set_subnets(Some(subnets))
        .assign_public_ip(AssignPublicIp::Disabled)
        .build()
        .context("can build aws vpc configuration")?;

    let network_configuration: NetworkConfiguration = NetworkConfiguration::builder()
        .awsvpc_configuration(aws_vpc_configuration)
        .build();

    match ecs_client
        .run_task()
        .task_definition(task_definition)
        .cluster(cluster)
        .network_configuration(network_configuration)
        .launch_type(aws_sdk_ecs::types::LaunchType::Fargate)
        .send()
        .await
    {
        Ok(_) => (),
        Err(e) => {
            tracing::error!(error=?e, "unable to run task");
            return Err(anyhow::Error::from(e));
        }
    }
    Ok(())
}
