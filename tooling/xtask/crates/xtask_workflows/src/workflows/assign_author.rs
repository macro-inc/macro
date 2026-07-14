//! `Pull Request` — assigns a newly opened/reopened PR to its author.

use gh_workflow::{Event, Job, Level, Permissions, PullRequest, PullRequestType, Step, Workflow};

use crate::workflows::runners;

/// Build the workflow.
pub fn assign_author() -> Workflow {
    Workflow::new("Pull Request")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_type(PullRequestType::Opened)
                .add_type(PullRequestType::Reopened),
        ))
        .add_job("assign_author", assign_author_job())
}

fn assign_author_job() -> Job {
    Job::default()
        .name("Assign author to PR")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .permissions(Permissions {
            issues: Some(Level::Write),
            pull_requests: Some(Level::Write),
            ..Default::default()
        })
        .add_step(Step::new("Assign author to PR").uses(
            "technote-space",
            "assign-author",
            "9558557c5c4816f38bd06176fbc324ba14bb3160",
        ))
}
