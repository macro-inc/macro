use crate::expr::typed::{needs, steps};
use crate::{CallJob, Job, Step, Workflow, WorkflowCall, WorkflowCallOutput};

fn render(workflow: Workflow) -> Result<String, String> {
    workflow.to_string().map_err(|error| error.to_string())
}

fn build() -> Job {
    Job::new("Build")
        .add_output("sha", steps("sha").output("value").to_string())
        .add_step(
            Step::new("Find")
                .run("echo value=1 >> $GITHUB_OUTPUT")
                .id("sha"),
        )
}

#[test]
fn a_well_formed_graph_renders() {
    let workflow = Workflow::new("CI").add_job("build", build()).add_job(
        "deploy",
        Job::new("Deploy")
            .add_needs("build")
            .cond(needs("build").output("sha").ne(""))
            .add_step(
                Step::new("Use")
                    .run("echo \"$SHA\"")
                    .add_env(("SHA", needs("build").output("sha"))),
            ),
    );

    assert!(render(workflow).is_ok());
}

#[test]
fn reading_a_job_that_is_not_needed_fails() {
    let workflow = Workflow::new("CI").add_job("build", build()).add_job(
        "deploy",
        Job::new("Deploy").cond(needs("build").output("sha").ne("")),
    );

    assert_eq!(
        render(workflow),
        Err("reference at `jobs.deploy.if`: reads `needs.build` but the job does not list `build` in `needs`".to_string())
    );
}

#[test]
fn reading_an_output_the_job_does_not_declare_fails() {
    let workflow = Workflow::new("CI").add_job("build", build()).add_job(
        "deploy",
        Job::new("Deploy")
            .add_needs("build")
            .cond(needs("build").output("shaa").ne("")),
    );

    assert_eq!(
        render(workflow),
        Err("reference at `jobs.deploy.if`: job `build` has no output `shaa`".to_string())
    );
}

#[test]
fn needs_must_name_jobs_without_a_cycle() {
    let missing = Workflow::new("CI").add_job("deploy", Job::new("Deploy").add_needs("biuld"));
    assert_eq!(
        render(missing),
        Err(
            "reference at `jobs.deploy.needs`: `biuld` is not another job of this workflow"
                .to_string()
        )
    );

    let cycle = Workflow::new("CI")
        .add_job("a", Job::new("A").add_needs("b"))
        .add_job("b", Job::new("B").add_needs("a"));
    assert_eq!(
        render(cycle),
        Err("reference at `jobs`: needs form a cycle: a -> b -> a".to_string())
    );
}

#[test]
fn a_step_reads_only_earlier_steps_of_its_job() {
    let later = Workflow::new("CI").add_job(
        "build",
        Job::new("Build")
            .add_step(
                Step::new("Use")
                    .run("echo \"$SHA\"")
                    .add_env(("SHA", steps("sha").output("value"))),
            )
            .add_step(Step::new("Find").run("true").id("sha")),
    );
    assert_eq!(
        render(later),
        Err("reference at `jobs.build.steps[0]`: reads `steps.sha`, which is not an earlier step of this job".to_string())
    );

    let duplicate = Workflow::new("CI").add_job(
        "build",
        Job::new("Build")
            .add_step(Step::new("A").run("true").id("x"))
            .add_step(Step::new("B").run("true").id("x")),
    );
    assert_eq!(
        render(duplicate),
        Err("reference at `jobs.build.steps`: two steps have the id `x`".to_string())
    );
}

#[test]
fn reusable_outputs_read_existing_jobs_and_calls_are_not_checked_for_outputs() {
    let workflow = Workflow::new("Reusable")
        .on(
            crate::Event::default().workflow_call(WorkflowCall::default().add_output(
                "sha",
                WorkflowCallOutput::default().value("${{ jobs.build.outputs.sh }}"),
            )),
        )
        .add_job("build", build());
    assert_eq!(
        render(workflow),
        Err(
            "reference at `on.workflow_call.outputs.sha.value`: job `build` has no output `sh`"
                .to_string()
        )
    );

    let caller = Workflow::new("Caller")
        .add_job("call", CallJob::new("./.github/workflows/reusable.yml"))
        .add_job(
            "after",
            Job::new("After")
                .add_needs("call")
                .cond(needs("call").output("anything").ne("")),
        );
    assert!(render(caller).is_ok());
}
