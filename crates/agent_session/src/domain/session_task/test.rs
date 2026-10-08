use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::*;
use crate::domain::pull_request::{SessionPullRequestService, SessionPullRequests};
use crate::testing::{InMemoryAgentSessionRepo, RecordingRealtime, test_agent_session};

const TASK: &str = "0199c0a8-7d3e-7c1a-9b5e-3f2a1c4d5e6f";
const OTHER_TASK: &str = "0199c0a8-7d3e-7c1a-9b5e-3f2a1c4d5e70";
const NOTE: &str = "0199c0a8-7d3e-7c1a-9b5e-3f2a1c4d5e71";
const HIDDEN: &str = "0199c0a8-7d3e-7c1a-9b5e-3f2a1c4d5e72";
const PULL_REQUEST: &str = "https://github.com/org/repo/pull/7";

/// Task documents keyed by id; `NOTE` is a document but not a task, `HIDDEN` a task the
/// owner cannot view.
#[derive(Clone, Default)]
struct FakeDirectory {
    pull_requests: Vec<TaskPullRequest>,
}

impl TaskDirectory for FakeDirectory {
    async fn task(
        &self,
        _viewer: &MacroUserIdStr<'static>,
        task: &TaskDocumentId,
    ) -> Result<TaskFacts> {
        match task.as_str() {
            NOTE => Err(SessionTaskError::NotATask),
            TASK | OTHER_TASK => Ok(TaskFacts {
                id: task.clone(),
                title: format!("Task {}", &task.as_str()[34..]),
                short_id: format!("short-{}", &task.as_str()[34..]),
                reference: format!("ENG-{}", &task.as_str()[34..]),
            }),
            _ => Err(SessionTaskError::TaskNotFound),
        }
    }

    async fn pull_requests(
        &self,
        viewer: &MacroUserIdStr<'static>,
        task: &TaskDocumentId,
    ) -> Result<Vec<TaskPullRequest>> {
        self.task(viewer, task).await?;
        Ok(self.pull_requests.clone())
    }
}

/// Records `(github_key, task short id)` links; can be told to fail.
#[derive(Clone, Default)]
struct RecordingLinker {
    links: Arc<Mutex<Vec<(String, String)>>>,
    down: bool,
}

impl RecordingLinker {
    fn links(&self) -> Vec<(String, String)> {
        self.links.lock().unwrap().clone()
    }
}

impl TaskPullRequestLinker for RecordingLinker {
    async fn link(&self, github_key: &str, task: &TaskFacts) -> Result<()> {
        if self.down {
            return Err(SessionTaskError::Unavailable(rootcause::report!(
                "github links unavailable"
            )));
        }
        self.links
            .lock()
            .unwrap()
            .push((github_key.to_owned(), task.short_id.clone()));
        Ok(())
    }
}

/// Session tasks beside the in-memory session store, reading its pull request URL.
#[derive(Clone, Default)]
struct InMemorySessionTasks {
    sessions: InMemoryAgentSessionRepo,
    tasks: Arc<Mutex<HashMap<AgentSessionId, TaskDocumentId>>>,
}

impl SessionTaskRepo for InMemorySessionTasks {
    async fn set_task(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        task: &TaskDocumentId,
    ) -> Result<Option<String>, AgentSessionError> {
        let stored = self.sessions.get(session).await?;
        if !stored.owner_id.is_user(owner) {
            return Err(AgentSessionError::Forbidden);
        }
        self.tasks.lock().unwrap().insert(session, task.clone());
        Ok(stored.pull_request_url)
    }

    async fn task(
        &self,
        session: AgentSessionId,
    ) -> Result<Option<TaskDocumentId>, AgentSessionError> {
        Ok(self.tasks.lock().unwrap().get(&session).cloned())
    }
}

struct Harness {
    sessions: InMemoryAgentSessionRepo,
    links: InMemorySessionTasks,
    linker: RecordingLinker,
    tasks: Arc<dyn SessionTasks>,
    pull_requests: SessionPullRequestService<InMemoryAgentSessionRepo, RecordingRealtime>,
}

fn harness(linker: RecordingLinker, directory: FakeDirectory) -> Harness {
    let sessions = InMemoryAgentSessionRepo::new();
    let links = InMemorySessionTasks {
        sessions: sessions.clone(),
        tasks: Arc::default(),
    };
    let tasks: Arc<dyn SessionTasks> = Arc::new(SessionTaskService::new(
        sessions.clone(),
        links.clone(),
        directory,
        linker.clone(),
        "https://macro.com/",
    ));
    let pull_requests =
        SessionPullRequestService::new(sessions.clone(), RecordingRealtime::new(), tasks.clone());
    Harness {
        sessions,
        links,
        linker,
        tasks,
        pull_requests,
    }
}

fn seeded(harness: &Harness) -> crate::domain::model::AgentSession {
    let session = test_agent_session(AgentSessionId::new());
    harness.sessions.insert_session(session.clone());
    session
}

#[test]
fn parses_task_ids_links_and_macro_references() {
    let expected = TaskDocumentId(TASK.to_owned());
    let short =
        macro_uuid::ShortUuidConverter::default().from_uuid(&uuid::Uuid::parse_str(TASK).unwrap());
    for input in [
        TASK.to_owned(),
        format!("  {}  ", TASK.to_uppercase()),
        format!("https://macro.com/app/task/{TASK}"),
        format!("https://dev.macro.com/app/task/{TASK}/?tab=activity#top"),
        format!("http://localhost:3000/app/task/{TASK}"),
        format!("MACRO-{short}"),
        format!("macro-{short}"),
    ] {
        assert_eq!(TaskDocumentId::parse(&input).unwrap(), expected, "{input}");
    }
    for invalid in [
        "",
        "ENG-42",
        "MACRO-0OIl",
        "not-a-task",
        &format!("https://macro.com/app/md/{TASK}"),
        &format!("https://macro.com/app/task/{TASK}/comments"),
        &format!("{TASK}x"),
    ] {
        assert!(
            matches!(
                TaskDocumentId::parse(invalid),
                Err(SessionTaskError::InvalidTaskReference)
            ),
            "{invalid}"
        );
    }
}

#[tokio::test]
async fn links_a_task_and_answers_its_link_and_reference() {
    let harness = harness(RecordingLinker::default(), FakeDirectory::default());
    let session = seeded(&harness);

    let linked = harness
        .tasks
        .link_task(
            session.id,
            session.owner_user().unwrap(),
            &format!("https://macro.com/app/task/{TASK}"),
        )
        .await
        .unwrap();

    assert_eq!(
        linked,
        LinkedTask {
            task_id: TASK.to_owned(),
            title: "Task 6f".to_owned(),
            url: format!("https://macro.com/app/task/{TASK}"),
            reference: "ENG-6f".to_owned(),
            pull_request: None,
        }
    );
    assert_eq!(
        harness.links.task(session.id).await.unwrap(),
        Some(TaskDocumentId(TASK.to_owned()))
    );
    assert!(harness.linker.links().is_empty());
}

#[tokio::test]
async fn relinking_replaces_the_session_task() {
    let harness = harness(RecordingLinker::default(), FakeDirectory::default());
    let session = seeded(&harness);
    let owner = session.owner_user().unwrap();

    harness
        .tasks
        .link_task(session.id, owner, TASK)
        .await
        .unwrap();
    harness
        .tasks
        .link_task(session.id, owner, OTHER_TASK)
        .await
        .unwrap();

    assert_eq!(
        harness.links.task(session.id).await.unwrap(),
        Some(TaskDocumentId(OTHER_TASK.to_owned()))
    );
}

#[tokio::test]
async fn refuses_another_owner_a_document_that_is_not_a_task_and_a_hidden_task() {
    let harness = harness(RecordingLinker::default(), FakeDirectory::default());
    let session = seeded(&harness);
    let owner = session.owner_user().unwrap();
    let other = MacroUserIdStr::try_from_email("other@example.com").unwrap();

    assert!(matches!(
        harness.tasks.link_task(session.id, &other, TASK).await,
        Err(SessionTaskError::Session(AgentSessionError::Forbidden))
    ));
    assert!(matches!(
        harness.tasks.link_task(session.id, owner, NOTE).await,
        Err(SessionTaskError::NotATask)
    ));
    assert!(matches!(
        harness.tasks.link_task(session.id, owner, HIDDEN).await,
        Err(SessionTaskError::TaskNotFound)
    ));
    assert!(matches!(
        harness.tasks.link_task(session.id, owner, "ENG-42").await,
        Err(SessionTaskError::InvalidTaskReference)
    ));
    assert_eq!(harness.links.task(session.id).await.unwrap(), None);
}

#[tokio::test]
async fn links_the_pull_request_when_the_task_comes_second() {
    let harness = harness(RecordingLinker::default(), FakeDirectory::default());
    let session = seeded(&harness);
    let owner = session.owner_user().unwrap();

    harness
        .pull_requests
        .set_pull_request(session.id, owner, PULL_REQUEST, None)
        .await
        .unwrap();
    assert!(harness.linker.links().is_empty());
    let linked = harness
        .tasks
        .link_task(session.id, owner, TASK)
        .await
        .unwrap();

    assert_eq!(linked.pull_request.as_deref(), Some(PULL_REQUEST));
    assert_eq!(
        harness.linker.links(),
        [("org/repo/pull/7".to_owned(), "short-6f".to_owned())]
    );
}

#[tokio::test]
async fn links_the_pull_request_when_the_task_comes_first() {
    let harness = harness(RecordingLinker::default(), FakeDirectory::default());
    let session = seeded(&harness);
    let owner = session.owner_user().unwrap();

    harness
        .tasks
        .link_task(session.id, owner, TASK)
        .await
        .unwrap();
    harness
        .pull_requests
        .set_pull_request(session.id, owner, PULL_REQUEST, None)
        .await
        .unwrap();

    assert_eq!(
        harness.linker.links(),
        [("org/repo/pull/7".to_owned(), "short-6f".to_owned())]
    );
}

#[tokio::test]
async fn a_session_started_from_a_task_thread_links_its_pull_request_to_that_task() {
    let harness = harness(RecordingLinker::default(), FakeDirectory::default());
    let mut session = test_agent_session(AgentSessionId::new());
    session.thread_parent = Some(MessageParent::Document(TASK.to_owned().try_into().unwrap()));
    harness.sessions.insert_session(session.clone());

    harness
        .pull_requests
        .set_pull_request(
            session.id,
            session.owner_user().unwrap(),
            PULL_REQUEST,
            None,
        )
        .await
        .unwrap();

    assert_eq!(
        harness.linker.links(),
        [("org/repo/pull/7".to_owned(), "short-6f".to_owned())]
    );
}

#[tokio::test]
async fn an_explicit_task_outranks_the_thread_task() {
    let harness = harness(RecordingLinker::default(), FakeDirectory::default());
    let mut session = test_agent_session(AgentSessionId::new());
    session.thread_parent = Some(MessageParent::Document(TASK.to_owned().try_into().unwrap()));
    harness.sessions.insert_session(session.clone());
    let owner = session.owner_user().unwrap();

    harness
        .tasks
        .link_task(session.id, owner, OTHER_TASK)
        .await
        .unwrap();
    harness
        .pull_requests
        .set_pull_request(session.id, owner, PULL_REQUEST, None)
        .await
        .unwrap();

    assert_eq!(
        harness.linker.links(),
        [("org/repo/pull/7".to_owned(), "short-70".to_owned())]
    );
}

#[tokio::test]
async fn a_thread_on_a_document_that_is_not_a_task_links_nothing() {
    let harness = harness(RecordingLinker::default(), FakeDirectory::default());
    let mut session = test_agent_session(AgentSessionId::new());
    session.thread_parent = Some(MessageParent::Document(NOTE.to_owned().try_into().unwrap()));
    harness.sessions.insert_session(session.clone());

    harness
        .pull_requests
        .set_pull_request(
            session.id,
            session.owner_user().unwrap(),
            PULL_REQUEST,
            None,
        )
        .await
        .unwrap();

    assert!(harness.linker.links().is_empty());
}

#[tokio::test]
async fn a_failed_task_link_keeps_the_recorded_pull_request() {
    let harness = harness(
        RecordingLinker {
            down: true,
            ..RecordingLinker::default()
        },
        FakeDirectory::default(),
    );
    let session = seeded(&harness);
    let owner = session.owner_user().unwrap();
    harness
        .tasks
        .link_task(session.id, owner, TASK)
        .await
        .unwrap();

    harness
        .pull_requests
        .set_pull_request(session.id, owner, PULL_REQUEST, None)
        .await
        .unwrap();

    assert_eq!(
        harness
            .sessions
            .get(session.id)
            .await
            .unwrap()
            .pull_request_url
            .as_deref(),
        Some(PULL_REQUEST)
    );
    // Linking the task again reports the failure, so the agent can retry.
    assert!(matches!(
        harness.tasks.link_task(session.id, owner, TASK).await,
        Err(SessionTaskError::Unavailable(_))
    ));
}

#[tokio::test]
async fn lists_a_tasks_pull_requests() {
    let pull_requests = vec![
        TaskPullRequest {
            url: PULL_REQUEST.to_owned(),
            title: Some("Fix the thing".to_owned()),
            state: Some(PullRequestState::Merged),
        },
        TaskPullRequest {
            url: "https://github.com/org/repo/pull/8".to_owned(),
            title: None,
            state: None,
        },
    ];
    let harness = harness(
        RecordingLinker::default(),
        FakeDirectory {
            pull_requests: pull_requests.clone(),
        },
    );
    let owner = MacroUserIdStr::try_from_email("owner@example.com").unwrap();

    let listed = harness
        .tasks
        .task_pull_requests(&owner, &format!("https://macro.com/app/task/{TASK}"))
        .await
        .unwrap();

    assert_eq!(
        listed,
        TaskPullRequests {
            task_id: TASK.to_owned(),
            pull_requests,
        }
    );
    assert_eq!(
        serde_json::to_value(&listed.pull_requests[0]).unwrap(),
        serde_json::json!({
            "url": PULL_REQUEST,
            "title": "Fix the thing",
            "state": "merged",
        })
    );
    assert!(matches!(
        harness.tasks.task_pull_requests(&owner, HIDDEN).await,
        Err(SessionTaskError::TaskNotFound)
    ));
}
