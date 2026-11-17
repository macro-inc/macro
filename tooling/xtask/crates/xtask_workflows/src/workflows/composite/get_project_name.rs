//! `Get Project Name`: a service's Pulumi project directory, from
//! `.github/services-config.json`.

use gh_workflow::expr::typed::{StepHandle, StepOutput, Str, input};
use gh_workflow::{ActionInput, CompositeAction, Step};

struct ProjectOutputs {
    project_name: StepOutput<Str>,
}

const PROJECT: StepHandle<ProjectOutputs> = StepHandle::new(
    "get-project",
    ProjectOutputs {
        project_name: StepOutput::new("get-project", "project_name"),
    },
);

pub fn get_project_name() -> CompositeAction {
    CompositeAction::new(
        "Get Project Name",
        "Get the Pulumi project name for a service from services-config.json",
    )
    .add_input(
        "service-name",
        ActionInput::required("The service name to look up"),
    )
    .add_output(
        "project-name",
        "The Pulumi project directory name",
        PROJECT.outputs.project_name.read(),
    )
    .add_step(
        Step::new(format!(
            "Get project path for {}",
            input::<Str>("service-name")
        ))
        .run(
            "PROJECT_NAME=$(.github/actions/get-project-name/get-project-name.sh \"$SERVICE_NAME\")\n\
             echo \"project_name=$PROJECT_NAME\" >> $GITHUB_OUTPUT\n\
             echo \"Using project: $PROJECT_NAME for service: $SERVICE_NAME\"\n",
        )
        .id(PROJECT.id())
        .shell("bash")
        .add_env(("SERVICE_NAME", input::<Str>("service-name"))),
    )
}
