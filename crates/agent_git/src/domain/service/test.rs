use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use chrono::Utc;
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;
use crate::domain::models::{AgentRepo, RepoTokenHash};
use crate::domain::template::WORKSPACE_TEMPLATE;

#[derive(Clone, Default)]
struct FakeRepos {
    rows: Arc<Mutex<HashMap<String, AgentRepo>>>,
    pushes: Arc<Mutex<Vec<(String, u64)>>>,
}

impl RepoRepository for FakeRepos {
    type Err = Infallible;

    async fn find_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<AgentRepo>, Infallible> {
        Ok(self
            .rows
            .lock()
            .unwrap()
            .get(agent_user_id.as_ref())
            .cloned())
    }

    async fn upsert_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        team_id: Uuid,
        token_hash: &RepoTokenHash,
    ) -> Result<bool, Infallible> {
        let mut rows = self.rows.lock().unwrap();

        if let Some(row) = rows.get_mut(agent_user_id.as_ref()) {
            if row.team_id != team_id {
                return Ok(false);
            }
            row.token_hash = token_hash.clone();
            return Ok(true);
        }

        rows.insert(
            agent_user_id.as_ref().to_owned(),
            AgentRepo {
                agent_user_id: MacroUserIdStr::try_from(agent_user_id.as_ref().to_owned()).unwrap(),
                team_id,
                token_hash: token_hash.clone(),
                size_bytes: None,
                created_at: Utc::now(),
                last_push_at: None,
            },
        );
        Ok(true)
    }

    async fn record_push(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        size_bytes: u64,
    ) -> Result<(), Infallible> {
        self.pushes
            .lock()
            .unwrap()
            .push((agent_user_id.as_ref().to_owned(), size_bytes));
        Ok(())
    }

    async fn delete_repo(&self, agent_user_id: &MacroUserIdStr<'_>) -> Result<(), Infallible> {
        self.rows.lock().unwrap().remove(agent_user_id.as_ref());
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeStore {
    repos: Arc<Mutex<HashSet<String>>>,
    size_bytes: u64,
}

impl RepoStore for FakeStore {
    type Err = Infallible;

    async fn create_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        _template: &WorkspaceTemplate,
    ) -> Result<(), Infallible> {
        self.repos
            .lock()
            .unwrap()
            .insert(agent_user_id.as_ref().to_owned());
        Ok(())
    }

    async fn delete_repo(&self, agent_user_id: &MacroUserIdStr<'_>) -> Result<(), Infallible> {
        self.repos.lock().unwrap().remove(agent_user_id.as_ref());
        Ok(())
    }

    async fn repo_size_bytes(
        &self,
        _agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<u64, Infallible> {
        Ok(self.size_bytes)
    }
}

#[derive(Clone, Default)]
struct FakeAdmins {
    admins: HashSet<(Uuid, String)>,
}

impl TeamAdmins for FakeAdmins {
    type Err = Infallible;

    async fn is_team_admin(
        &self,
        team_id: Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<bool, Infallible> {
        Ok(self
            .admins
            .contains(&(team_id, user_id.as_ref().to_owned())))
    }
}

#[derive(Clone)]
struct FakeLimiter {
    remaining: Arc<Mutex<u32>>,
}

impl PushRateLimiter for FakeLimiter {
    fn try_acquire_push(&self, _agent_user_id: &MacroUserIdStr<'_>) -> bool {
        let mut remaining = self.remaining.lock().unwrap();
        if *remaining == 0 {
            return false;
        }
        *remaining -= 1;
        true
    }
}

/// Answers 200 with the bytes it read, so tests can see the body limit.
#[derive(Clone, Default)]
struct EchoBackend {
    served: Arc<Mutex<Vec<(String, GitAccess)>>>,
}

impl GitBackend for EchoBackend {
    type Err = std::io::Error;

    async fn serve(
        &self,
        repo: &AuthorizedRepo,
        request: GitRequest,
    ) -> Result<GitResponse, std::io::Error> {
        self.served
            .lock()
            .unwrap()
            .push((repo.agent_user_id().as_ref().to_owned(), repo.access()));

        let mut received = Vec::new();
        let mut body = request.body;
        while let Some(chunk) = body.next().await {
            received.extend_from_slice(&chunk?);
        }

        Ok(GitResponse {
            status: 200,
            headers: Vec::new(),
            body: Box::pin(futures::stream::iter([Ok(Bytes::from(received))])),
        })
    }
}

fn request(endpoint: GitEndpoint, body: &'static [u8]) -> GitRequest {
    GitRequest {
        endpoint,
        content_type: None,
        content_encoding: None,
        git_protocol: None,
        body: Box::pin(futures::stream::iter([Ok(Bytes::from_static(body))])),
    }
}

const AGENT: &str = "macro|agent@example.com";
const ADMIN: &str = "macro|admin@example.com";
const MEMBER: &str = "macro|member@example.com";
const TEAM: Uuid = Uuid::from_u128(0x0190_0000_0000_7000_8000_0000_0000_0001);

#[tokio::test]
async fn the_agent_token_pushes_and_an_admin_session_only_reads() {
    let repos = FakeRepos::default();
    let backend = EchoBackend::default();
    let service = AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: repos.clone(),
            store: FakeStore {
                repos: Arc::default(),
                size_bytes: 1_000,
            },
            admins: FakeAdmins {
                admins: HashSet::from([(TEAM, ADMIN.to_owned())]),
            },
            limiter: FakeLimiter {
                remaining: Arc::new(Mutex::new(30)),
            },
            backend: backend.clone(),
        },
        RepoLimits {
            max_repo_size_bytes: 500_000_000,
        },
        WORKSPACE_TEMPLATE,
    );
    let agent = MacroUserIdStr::try_from(AGENT.to_owned()).unwrap();

    let created = service.create_repo(agent.clone(), TEAM).await.unwrap();
    assert!(created.token.expose().starts_with("mrt_"));

    service
        .serve_git(
            GitCredential::RepoToken(RepoToken::presented(created.token.expose())),
            &agent,
            request(GitEndpoint::Rpc(GitService::ReceivePack), b"pack"),
        )
        .await
        .unwrap();
    assert_eq!(
        *repos.pushes.lock().unwrap(),
        vec![(AGENT.to_owned(), 1_000)]
    );

    service
        .serve_git(
            GitCredential::User(MacroUserIdStr::try_from(ADMIN.to_owned()).unwrap()),
            &agent,
            request(GitEndpoint::InfoRefs(GitService::UploadPack), b""),
        )
        .await
        .unwrap();

    let admin_push = service
        .serve_git(
            GitCredential::User(MacroUserIdStr::try_from(ADMIN.to_owned()).unwrap()),
            &agent,
            request(GitEndpoint::InfoRefs(GitService::ReceivePack), b""),
        )
        .await;
    assert!(matches!(
        admin_push,
        Err(AgentGitError::Forbidden(GitAccess::Push))
    ));

    let member_read = service
        .serve_git(
            GitCredential::User(MacroUserIdStr::try_from(MEMBER.to_owned()).unwrap()),
            &agent,
            request(GitEndpoint::InfoRefs(GitService::UploadPack), b""),
        )
        .await;
    assert!(matches!(
        member_read,
        Err(AgentGitError::Forbidden(GitAccess::Read))
    ));

    assert_eq!(
        *backend.served.lock().unwrap(),
        vec![
            (AGENT.to_owned(), GitAccess::Push),
            (AGENT.to_owned(), GitAccess::Read),
        ]
    );
}

#[tokio::test]
async fn creating_again_replaces_the_token_and_another_team_is_refused() {
    let service = AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: FakeRepos::default(),
            store: FakeStore::default(),
            admins: FakeAdmins::default(),
            limiter: FakeLimiter {
                remaining: Arc::new(Mutex::new(30)),
            },
            backend: EchoBackend::default(),
        },
        RepoLimits {
            max_repo_size_bytes: 500_000_000,
        },
        WORKSPACE_TEMPLATE,
    );
    let agent = MacroUserIdStr::try_from(AGENT.to_owned()).unwrap();

    let first = service.create_repo(agent.clone(), TEAM).await.unwrap();
    let second = service.create_repo(agent.clone(), TEAM).await.unwrap();

    let with_first = service
        .serve_git(
            GitCredential::RepoToken(first.token),
            &agent,
            request(GitEndpoint::InfoRefs(GitService::UploadPack), b""),
        )
        .await;
    assert!(matches!(with_first, Err(AgentGitError::InvalidToken)));

    service
        .serve_git(
            GitCredential::RepoToken(second.token),
            &agent,
            request(GitEndpoint::InfoRefs(GitService::UploadPack), b""),
        )
        .await
        .unwrap();

    let other_team = service
        .create_repo(
            agent,
            Uuid::from_u128(0x0190_0000_0000_7000_8000_0000_0000_0002),
        )
        .await;
    assert!(matches!(other_team, Err(AgentGitError::TeamMismatch)));
}

#[tokio::test]
async fn pushes_stop_at_the_size_cap_and_the_rate_limit() {
    let full_store = FakeStore {
        repos: Arc::default(),
        size_bytes: 500,
    };
    let service = AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: FakeRepos::default(),
            store: full_store,
            admins: FakeAdmins::default(),
            limiter: FakeLimiter {
                remaining: Arc::new(Mutex::new(1)),
            },
            backend: EchoBackend::default(),
        },
        RepoLimits {
            max_repo_size_bytes: 504,
        },
        WORKSPACE_TEMPLATE,
    );
    let agent = MacroUserIdStr::try_from(AGENT.to_owned()).unwrap();
    let created = service.create_repo(agent.clone(), TEAM).await.unwrap();

    // 4 bytes of room: a 5-byte pack fails while streaming.
    let response = service
        .serve_git(
            GitCredential::RepoToken(created.token.clone()),
            &agent,
            request(GitEndpoint::Rpc(GitService::ReceivePack), b"12345"),
        )
        .await;
    assert!(matches!(response, Err(AgentGitError::Internal(_))));

    let rate_limited = service
        .serve_git(
            GitCredential::RepoToken(created.token.clone()),
            &agent,
            request(GitEndpoint::Rpc(GitService::ReceivePack), b"1"),
        )
        .await;
    assert!(matches!(rate_limited, Err(AgentGitError::PushRateLimited)));

    // Fetches are never limited.
    service
        .serve_git(
            GitCredential::RepoToken(created.token),
            &agent,
            request(GitEndpoint::Rpc(GitService::UploadPack), b"want"),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn a_full_repo_refuses_the_push_advertisement() {
    let service = AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: FakeRepos::default(),
            store: FakeStore {
                repos: Arc::default(),
                size_bytes: 600,
            },
            admins: FakeAdmins::default(),
            limiter: FakeLimiter {
                remaining: Arc::new(Mutex::new(30)),
            },
            backend: EchoBackend::default(),
        },
        RepoLimits {
            max_repo_size_bytes: 500,
        },
        WORKSPACE_TEMPLATE,
    );
    let agent = MacroUserIdStr::try_from(AGENT.to_owned()).unwrap();
    let created = service.create_repo(agent.clone(), TEAM).await.unwrap();

    let response = service
        .serve_git(
            GitCredential::RepoToken(created.token),
            &agent,
            request(GitEndpoint::InfoRefs(GitService::ReceivePack), b""),
        )
        .await;
    assert!(matches!(
        response,
        Err(AgentGitError::RepoTooLarge {
            size_bytes: 600,
            limit_bytes: 500
        })
    ));
}

#[tokio::test]
async fn deleting_removes_the_repo_and_the_row() {
    let repos = FakeRepos::default();
    let store = FakeStore::default();
    let service = AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: repos.clone(),
            store: store.clone(),
            admins: FakeAdmins::default(),
            limiter: FakeLimiter {
                remaining: Arc::new(Mutex::new(30)),
            },
            backend: EchoBackend::default(),
        },
        RepoLimits {
            max_repo_size_bytes: 500,
        },
        WORKSPACE_TEMPLATE,
    );
    let agent = MacroUserIdStr::try_from(AGENT.to_owned()).unwrap();
    service.create_repo(agent.clone(), TEAM).await.unwrap();

    service.delete_repo(&agent).await.unwrap();
    service.delete_repo(&agent).await.unwrap();

    assert!(repos.rows.lock().unwrap().is_empty());
    assert!(store.repos.lock().unwrap().is_empty());
    let missing = service
        .serve_git(
            GitCredential::User(MacroUserIdStr::try_from(ADMIN.to_owned()).unwrap()),
            &agent,
            request(GitEndpoint::InfoRefs(GitService::UploadPack), b""),
        )
        .await;
    assert!(matches!(missing, Err(AgentGitError::NotFound)));
}
