//! `CI Gate Run End` — when a same-repo [`pr_ci`](crate::workflows::pr_ci) run
//! ends, fails a `CI gate` request the run opened and never closed, so the
//! status never says `Running on` with nothing running. Generated into
//! `ci-gate-run-end.yml`.
//!
//! The gate job replaces start's pending request with a result. GitHub can end
//! a run without ever creating that job, and a run cancelled by hand skips it;
//! either leaves the request pending. A run cancelled by a newer request is
//! left alone: the newer run owns the status. `CI Gate for Forks` does the same
//! for fork runs. `workflow_run` runs `main`'s copy of this file.

use gh_workflow::{
    Event, Expression, Job, Level, Permissions, Workflow, WorkflowRun, WorkflowRunType,
};

use crate::workflows::pr_ci;

/// Build the workflow.
pub fn ci_gate_run_end() -> Workflow {
    Workflow::new("CI Gate Run End")
        .on(Event::default().workflow_run(
            WorkflowRun::default()
                .add_type(WorkflowRunType::Completed)
                .add_workflow("PR CI"),
        ))
        .add_job("close", close())
}

/// A run that ended in success had its gate job set the result, and one for
/// another label ends skipped, so only the rest need a look.
fn close() -> Job {
    Job::default()
        .name("Close a request the run left open")
        .cond(Expression::new(
            "github.event.workflow_run.event == 'pull_request' && github.event.workflow_run.head_repository.full_name == github.repository && github.event.workflow_run.conclusion != 'success' && github.event.workflow_run.conclusion != 'skipped'",
        ))
        .runs_on("ubuntu-latest")
        .timeout_minutes(5u32)
        .permissions(Permissions {
            actions: Some(Level::Read),
            statuses: Some(Level::Write),
            ..Default::default()
        })
        .add_step(pr_ci::gate_step("Close the CI gate request", "run-end"))
}
