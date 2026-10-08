//! A user's coding preferences append their workflows to new coding sessions'
//! instructions, after the persona's and any task assignment's.

use super::*;
use crate::domain::model::{
    CREATE_TASKS_INSTRUCTIONS, OPEN_PULL_REQUESTS_INSTRUCTIONS, TaskAssignmentOrigin,
};
use agent_session::domain::coding_preferences::CodingPreferences;

const TASKS: CodingPreferences = CodingPreferences {
    create_tasks: true,
    open_pull_requests: false,
};
const PULL_REQUESTS: CodingPreferences = CodingPreferences {
    create_tasks: false,
    open_pull_requests: true,
};
const BOTH: CodingPreferences = CodingPreferences {
    create_tasks: true,
    open_pull_requests: true,
};

fn tasks() -> &'static str {
    CREATE_TASKS_INSTRUCTIONS.trim()
}

fn pull_requests() -> &'static str {
    OPEN_PULL_REQUESTS_INSTRUCTIONS.trim()
}

fn assignment_command(kind: AgentKind, harness: &str) -> OpenSession {
    let mut command = open_command();
    command.runtime.kind = kind;
    command.runtime.harness = harness.to_owned();
    command.runtime.instructions = "Persona.".to_owned();
    command.origin = SessionOrigin::TaskAssignment(TaskAssignmentOrigin {
        parent: MessageParent::parse("document", "task-1").unwrap(),
        discussion_id: macro_uuid::generate_uuid_v7(),
        actor: sender(),
        prompt: "Private assignment instructions".to_owned(),
    });
    command
}

fn assignment() -> String {
    agent_trigger::domain::task_assignment::assignment_instructions(
        &MessageParent::parse("document", "task-1").unwrap(),
    )
}

/// Opens until the row exists; the sandbox then fails so nothing waits on a
/// runtime handshake.
async fn opened_instructions(
    (service, repo, containers, _, _): &TestBench,
    command: OpenSession,
) -> Option<String> {
    let id = AgentSessionId::new();
    containers.fail_next_spawn("no sandbox in this test");
    service
        .execute(id, HarnessCommand::Open(command))
        .await
        .expect_err("the sandbox never comes up");
    repo.get(id).await.expect("the row exists").instructions
}

#[tokio::test]
async fn a_coding_assignment_with_tasks_ends_with_the_tasks_workflow() {
    let bench = harness();
    bench
        .1
        .set_user_coding_preferences(&sender(), TASKS)
        .await
        .unwrap();

    let instructions = opened_instructions(
        &bench,
        assignment_command(AgentKind::SandboxedCoder, "opencode"),
    )
    .await;

    assert_eq!(
        instructions,
        Some(format!("Persona.\n\n{}\n\n{}", assignment(), tasks()))
    );
}

#[tokio::test]
async fn a_coding_mention_with_pull_requests_and_no_instructions_gets_only_that_workflow() {
    let bench = harness();
    bench
        .1
        .set_user_coding_preferences(&sender(), PULL_REQUESTS)
        .await
        .unwrap();

    let instructions = opened_instructions(&bench, open_command()).await;

    assert_eq!(instructions.as_deref(), Some(pull_requests()));
}

#[tokio::test]
async fn a_coding_assignment_with_both_puts_tasks_before_pull_requests() {
    let bench = harness();
    bench
        .1
        .set_user_coding_preferences(&sender(), BOTH)
        .await
        .unwrap();

    let instructions = opened_instructions(
        &bench,
        assignment_command(AgentKind::SandboxedCoder, "opencode"),
    )
    .await;

    assert_eq!(
        instructions,
        Some(format!(
            "Persona.\n\n{}\n\n{}\n\n{}",
            assignment(),
            tasks(),
            pull_requests()
        ))
    );
}

#[tokio::test]
async fn coding_sessions_of_users_without_preferences_are_unchanged() {
    let bench = harness();

    let instructions = opened_instructions(
        &bench,
        assignment_command(AgentKind::SandboxedCoder, "opencode"),
    )
    .await;

    assert_eq!(instructions, Some(format!("Persona.\n\n{}", assignment())));
}

#[tokio::test]
async fn chat_sessions_never_get_the_workflows() {
    let bench = harness();
    bench
        .1
        .set_user_coding_preferences(&sender(), BOTH)
        .await
        .unwrap();

    let instructions = opened_instructions(
        &bench,
        assignment_command(AgentKind::InMemory, "macro-inmem"),
    )
    .await;

    assert_eq!(instructions, Some(format!("Persona.\n\n{}", assignment())));
}

#[tokio::test]
async fn a_persona_that_chose_chat_never_gets_the_workflows() {
    let (bench, _signals) = harness_with_coding_choice(false);
    bench
        .1
        .set_user_coding_preferences(&sender(), BOTH)
        .await
        .unwrap();

    let instructions = opened_instructions(
        &bench,
        assignment_command(AgentKind::SandboxedCoder, "opencode"),
    )
    .await;

    assert_eq!(instructions, Some(format!("Persona.\n\n{}", assignment())));
}

#[tokio::test]
async fn a_managed_open_ends_with_both_workflows() {
    let (service, repo, containers, _, _) = harness();
    repo.set_user_coding_preferences(&sender(), BOTH)
        .await
        .unwrap();
    containers.fail_next_spawn("no sandbox in this test");
    let id = AgentSessionId::new();

    service
        .open_managed_session(OpenManagedSession {
            id: Some(id),
            repo_url: None,
            repo_branch: None,
            instructions: Some("Ad hoc.".to_owned()),
            model: None,
            owner: model_owner::Owner::User(sender()),
            prompt: None,
            profile: None,
        })
        .await
        .expect_err("the sandbox never comes up");

    assert_eq!(
        repo.get(id).await.unwrap().instructions,
        Some(format!("Ad hoc.\n\n{}\n\n{}", tasks(), pull_requests()))
    );
}

#[tokio::test]
async fn an_external_open_ends_with_the_tasks_workflow() {
    let (service, repo, _, _, _) = harness();
    repo.set_user_coding_preferences(&sender(), TASKS)
        .await
        .unwrap();

    let session = service
        .open_external_session(OpenExternalAgentSession {
            instructions: Some("Ad hoc.".to_owned()),
            ..open_external_request("/srv/agent")
        })
        .await
        .expect("open external");

    assert_eq!(
        session.instructions,
        Some(format!("Ad hoc.\n\n{}", tasks()))
    );
}
