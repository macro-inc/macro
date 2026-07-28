//! `Deploy FusionAuth Instance` — manually deploys the FusionAuth instance
//! configuration Pulumi stack to dev or prod through the shared single-service
//! deployment workflow. Generated into `deploy_fusionauth_instance.yml`.

use anyhow::Result;
use gh_workflow::{Concurrency, Event, Expression, Job, Workflow, WorkflowDispatch};

/// Build the workflow. The dispatch input and reusable-workflow caller fields
/// are filled in by [`patch`].
pub fn deploy_fusionauth_instance() -> Workflow {
    Workflow::new("Deploy FusionAuth Instance")
        .on(Event::default().workflow_dispatch(WorkflowDispatch::default()))
        .concurrency(
            Concurrency::new(Expression::new(
                "deploy-fusionauth-instance-${{ inputs.environment }}",
            ))
            .cancel_in_progress(false),
        )
        .add_job("deploy", deploy())
}

/// Fill in the ordered dispatch input and reusable-workflow caller fields.
pub fn patch(root: &mut serde_yaml::Value) -> Result<()> {
    let on = root
        .get_mut("on")
        .and_then(serde_yaml::Value::as_mapping_mut)
        .ok_or_else(|| anyhow::anyhow!("rendered workflow has no `on` mapping"))?;
    on.insert(
        "workflow_dispatch".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            inputs:
              environment:
                type: choice
                required: true
                default: dev
                options:
                  - dev
                  - prod
                description: The environment to deploy to.
        "#})?,
    );

    let job = crate::workflows::job_mut(root, "deploy")?;
    job.remove("runs-on");
    job.insert(
        "with".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            environment: ${{ inputs.environment }}
            service-name: fusionauth-instance
            pulumi-stack-name: fusionauth-instance
            use-docker: false
        "#})?,
    );
    job.insert("secrets".into(), "inherit".into());
    Ok(())
}

fn deploy() -> Job {
    Job::default()
        .name("Deploy fusionauth-instance")
        .uses("./.github/workflows/reusable_deploy_service.yml")
}
