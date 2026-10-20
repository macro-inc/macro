//! Pinned personal-session protocol build and concurrency regressions.
use crate::workflows::runners;
use gh_workflow::{Event, Job, PullRequest, PullRequestType, Step, Workflow};
pub fn whatsapp_session() -> Workflow {
    Workflow::new("WhatsApp session safety")
  .on(Event::default().pull_request(PullRequest::default().add_type(PullRequestType::Opened).add_type(PullRequestType::Synchronize).add_type(PullRequestType::Reopened).add_type(PullRequestType::ReadyForReview).add_path(xtask_paths::repo_glob!("services/whatsapp_session/**")).add_path(xtask_paths::repo_glob!(".github/workflows/**")).add_path(xtask_paths::repo_glob!("tooling/xtask/crates/xtask_workflows/src/workflows/whatsapp_session.rs"))))
  .add_job("protocol-safety",Job::default().runs_on(runners::Runner::Small.to_string())
   .add_step(Step::new("Checkout").uses("actions","checkout","df4cb1c069e1874edd31b4311f1884172cec0e10"))
   .add_step(Step::new("Pinned Go").uses("actions","setup-go","924ae3a1cded613372ab5595356fb5720e22ba16").add_with(("go-version","1.27.2")).add_with(("cache-dependency-path","services/whatsapp_session/go.sum")))
   .add_step(Step::new("Race and physical writer regressions").run("./go.sh test -race ./... && ./go.sh test -race go.mau.fi/whatsmeow go.mau.fi/whatsmeow/socket && ./go.sh vet ./...").working_directory(xtask_paths::repo_dir!("services/whatsapp_session"))))
}
