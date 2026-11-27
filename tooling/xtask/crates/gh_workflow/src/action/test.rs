use super::{ActionInput, CompositeAction};
use crate::expr::typed::{input, StepHandle, StepOutput, Str};
use crate::Step;

#[test]
fn a_composite_action_renders_inputs_outputs_and_shell_steps() {
    struct NameOutputs {
        name: StepOutput<Str>,
    }
    const NAME: StepHandle<NameOutputs> = StepHandle::new(
        "name",
        NameOutputs {
            name: StepOutput::new("name", "name"),
        },
    );

    let action = CompositeAction::new("Get project name", "Read a project's name")
        .add_input("path", ActionInput::required("The project directory"))
        .add_output("name", "The project's name", NAME.outputs.name.read())
        .add_step(
            Step::new("Read name")
                .run("jq -r .name \"$PROJECT/package.json\"")
                .shell("bash")
                .id(NAME.id())
                .add_env(("PROJECT", input::<Str>("path"))),
        );

    assert_eq!(
        action.to_string().unwrap(),
        "name: Get project name\n\
         description: Read a project's name\n\
         inputs:\n  \
           path:\n    \
             description: The project directory\n    \
             required: true\n\
         outputs:\n  \
           name:\n    \
             description: The project's name\n    \
             value: ${{ steps.name.outputs.name }}\n\
         runs:\n  \
           using: composite\n  \
           steps:\n    \
             - id: name\n      \
               name: Read name\n      \
               run: jq -r .name \"$PROJECT/package.json\"\n      \
               shell: bash\n      \
               env:\n        \
                 PROJECT: ${{ inputs.path }}\n"
    );
}

#[test]
fn a_run_step_without_a_shell_or_an_expression_in_its_script_fails() {
    let no_shell = CompositeAction::new("A", "A").add_step(Step::new("Run").run("true"));
    assert_eq!(
        no_shell.to_string().unwrap_err().to_string(),
        "reference at `runs.steps[0]`: a composite action's `run` step must set `shell`"
    );

    let pasted = CompositeAction::new("A", "A")
        .add_step(Step::new("Run").run("echo ${{ inputs.x }}").shell("bash"));
    assert!(pasted
        .to_string()
        .unwrap_err()
        .to_string()
        .starts_with("expression at `runs.steps.[].run`: GitHub pastes"));

    let secrets = CompositeAction::new("A", "A").add_step(
        Step::new("Run")
            .run("true")
            .shell("bash")
            .add_env(("TOKEN", "${{ secrets.TOKEN }}")),
    );
    assert!(secrets
        .to_string()
        .unwrap_err()
        .to_string()
        .contains("context `secrets` is not available here"));
}
