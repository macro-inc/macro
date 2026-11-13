use macro_user_id::cowlike::CowLike;

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
use crate::domain::template::{PersonaSeed, RenderedFile, WORKSPACE_TEMPLATE};

/// The agent teammates rollout, on or off for everyone.
struct Rollout(bool);

impl feature_flags::FeatureFlags for Rollout {
    async fn load(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> Result<feature_flags::FlagSnapshot, rootcause::Report> {
        Ok(feature_flags::FlagSnapshot::new([(
            agent_credentials::AGENT_TEAMMATES_FLAG.to_owned(),
            feature_flags::FlagValue::Boolean(self.0),
        )]))
    }
}

#[derive(Clone, Default)]
struct FakeRepos {
    rows: Arc<Mutex<HashMap<String, AgentRepo>>>,
    pushes: Arc<Mutex<Vec<(String, u64)>>>,
    /// One lock per repo, waited on like the advisory lock.
    locks: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
    /// Repos whose lock a guard holds now.
    locked: Arc<Mutex<Vec<String>>>,
    /// Every lock taken, in order.
    lock_log: Arc<Mutex<Vec<String>>>,
}

/// Holds its repo's lock and its entry in [`FakeRepos::locked`] until dropped.
struct FakeLock {
    agent_user_id: String,
    locked: Arc<Mutex<Vec<String>>>,
    _guard: tokio::sync::OwnedMutexGuard<()>,
}

impl Drop for FakeLock {
    fn drop(&mut self) {
        self.locked
            .lock()
            .unwrap()
            .retain(|held| held != &self.agent_user_id);
    }
}

impl RepoRepository for FakeRepos {
    type Err = Infallible;
    type Lock = FakeLock;

    async fn lock_repo(&self, agent_user_id: &MacroUserIdStr<'_>) -> Result<FakeLock, Infallible> {
        let agent_user_id = agent_user_id.as_ref().to_owned();
        let lock = self
            .locks
            .lock()
            .unwrap()
            .entry(agent_user_id.clone())
            .or_default()
            .clone();
        let guard = lock.lock_owned().await;
        self.locked.lock().unwrap().push(agent_user_id.clone());
        self.lock_log.lock().unwrap().push(agent_user_id.clone());
        Ok(FakeLock {
            agent_user_id,
            locked: self.locked.clone(),
            _guard: guard,
        })
    }

    async fn try_lock_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<FakeLock>, Infallible> {
        let agent_user_id = agent_user_id.as_ref().to_owned();
        let lock = self
            .locks
            .lock()
            .unwrap()
            .entry(agent_user_id.clone())
            .or_default()
            .clone();
        let Ok(guard) = lock.try_lock_owned() else {
            return Ok(None);
        };
        self.locked.lock().unwrap().push(agent_user_id.clone());
        self.lock_log.lock().unwrap().push(agent_user_id.clone());
        Ok(Some(FakeLock {
            agent_user_id,
            locked: self.locked.clone(),
            _guard: guard,
        }))
    }

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

    async fn insert_repo_if_missing(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        team_id: Uuid,
        token_hash: &RepoTokenHash,
    ) -> Result<(), Infallible> {
        self.rows
            .lock()
            .unwrap()
            .entry(agent_user_id.as_ref().to_owned())
            .or_insert_with(|| AgentRepo {
                agent_user_id: MacroUserIdStr::try_from(agent_user_id.as_ref().to_owned()).unwrap(),
                team_id,
                token_hash: token_hash.clone(),
                size_bytes: None,
                created_at: Utc::now(),
                last_push_at: None,
            });
        Ok(())
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
    /// `main`'s files by agent and path, with the message that committed them.
    files: Arc<Mutex<HashMap<(String, String), (Vec<u8>, String)>>>,
}

impl RepoStore for FakeStore {
    type Err = Infallible;
    async fn create_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        _files: &[RenderedFile],
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

    async fn read_file(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        path: &str,
    ) -> Result<Option<Vec<u8>>, Infallible> {
        Ok(self
            .files
            .lock()
            .unwrap()
            .get(&(agent_user_id.as_ref().to_owned(), path.to_owned()))
            .map(|(contents, _)| contents.clone()))
    }

    async fn commit_file(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        path: &str,
        contents: &[u8],
        message: &str,
    ) -> Result<(), Infallible> {
        self.files.lock().unwrap().insert(
            (agent_user_id.as_ref().to_owned(), path.to_owned()),
            (contents.to_vec(), message.to_owned()),
        );
        Ok(())
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
    type Err = Infallible;

    async fn try_acquire_push(
        &self,
        _agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<bool, Infallible> {
        let mut remaining = self.remaining.lock().unwrap();
        if *remaining == 0 {
            return Ok(false);
        }
        *remaining -= 1;
        Ok(true)
    }
}

/// Answers 200 with the bytes it read, so tests can see the body limit.
#[derive(Clone, Default)]
struct EchoBackend {
    served: Arc<Mutex<Vec<(String, GitAccess)>>>,
    input_limits: Arc<Mutex<Vec<Option<u64>>>>,
}

impl GitBackend for EchoBackend {
    type Err = std::io::Error;

    async fn serve(
        &self,
        repo: &AuthorizedRepo,
        request: GitRequest,
    ) -> Result<GitResponse, std::io::Error> {
        self.input_limits
            .lock()
            .unwrap()
            .push(repo.max_input_size());
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
                files: Arc::default(),
            },
            admins: FakeAdmins {
                admins: HashSet::from([(TEAM, ADMIN.to_owned())]),
            },
            limiter: FakeLimiter {
                remaining: Arc::new(Mutex::new(30)),
            },
            backend: backend.clone(),
            flags: Some(Rollout(true)),
        },
        RepoLimits {
            max_repo_size_bytes: 500_000_000,
        },
        WORKSPACE_TEMPLATE,
    );
    let agent = MacroUserIdStr::try_from(AGENT.to_owned()).unwrap();

    let created = service
        .create_repo(agent.clone(), TEAM, &seed())
        .await
        .unwrap();
    assert!(created.token.expose().starts_with("mrt_"));

    service
        .serve_git(
            GitCredential::RepoToken(
                RepoToken::parse(created.token.expose().to_owned()).expect("minted token"),
            ),
            &agent,
            request(GitEndpoint::Rpc(GitService::ReceivePack), b"pack"),
        )
        .await
        .unwrap();
    assert_eq!(
        *backend.input_limits.lock().unwrap(),
        vec![Some(500_000_000 - 1_000)]
    );
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
            flags: Some(Rollout(true)),
        },
        RepoLimits {
            max_repo_size_bytes: 500_000_000,
        },
        WORKSPACE_TEMPLATE,
    );
    let agent = MacroUserIdStr::try_from(AGENT.to_owned()).unwrap();

    let first = service
        .create_repo(agent.clone(), TEAM, &seed())
        .await
        .unwrap();
    let second = service
        .create_repo(agent.clone(), TEAM, &seed())
        .await
        .unwrap();

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
            &seed(),
        )
        .await;
    assert!(matches!(other_team, Err(AgentGitError::TeamMismatch)));
}

#[tokio::test]
async fn pushes_stop_at_the_size_cap_and_the_rate_limit() {
    let full_store = FakeStore {
        repos: Arc::default(),
        size_bytes: 500,
        files: Arc::default(),
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
            flags: Some(Rollout(true)),
        },
        RepoLimits {
            max_repo_size_bytes: 504,
        },
        WORKSPACE_TEMPLATE,
    );
    let agent = MacroUserIdStr::try_from(AGENT.to_owned()).unwrap();
    let created = service
        .create_repo(agent.clone(), TEAM, &seed())
        .await
        .unwrap();

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
                files: Arc::default(),
            },
            admins: FakeAdmins::default(),
            limiter: FakeLimiter {
                remaining: Arc::new(Mutex::new(30)),
            },
            backend: EchoBackend::default(),
            flags: Some(Rollout(true)),
        },
        RepoLimits {
            max_repo_size_bytes: 500,
        },
        WORKSPACE_TEMPLATE,
    );
    let agent = MacroUserIdStr::try_from(AGENT.to_owned()).unwrap();
    let created = service
        .create_repo(agent.clone(), TEAM, &seed())
        .await
        .unwrap();

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
            flags: Some(Rollout(true)),
        },
        RepoLimits {
            max_repo_size_bytes: 500,
        },
        WORKSPACE_TEMPLATE,
    );
    let agent = MacroUserIdStr::try_from(AGENT.to_owned()).unwrap();
    service
        .create_repo(agent.clone(), TEAM, &seed())
        .await
        .unwrap();

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
    assert!(matches!(missing, Err(AgentGitError::InvalidToken)));
}

#[tokio::test]
async fn voices_are_read_and_committed_only_for_the_repos_team() {
    let store = FakeStore::default();
    let service = AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: FakeRepos::default(),
            store: store.clone(),
            admins: FakeAdmins::default(),
            limiter: FakeLimiter {
                remaining: Arc::new(Mutex::new(30)),
            },
            backend: EchoBackend::default(),
            flags: Some(Rollout(true)),
        },
        RepoLimits {
            max_repo_size_bytes: 500,
        },
        WORKSPACE_TEMPLATE,
    );
    let agent = MacroUserIdStr::try_from(AGENT.to_owned()).unwrap();
    let other_team = Uuid::from_u128(2);
    let voice = VoiceConfig {
        model: crate::domain::voice::VoiceModel::parse("aura-2-thalia-en").unwrap(),
    };

    assert!(matches!(
        service.set_voice(&agent, TEAM, &voice).await,
        Err(AgentGitError::NotFound)
    ));
    service
        .create_repo(agent.clone(), TEAM, &seed())
        .await
        .unwrap();
    assert!(matches!(
        service.voice(&agent, TEAM).await,
        Err(AgentGitError::NoVoice)
    ));
    assert!(matches!(
        service.set_voice(&agent, other_team, &voice).await,
        Err(AgentGitError::TeamMismatch)
    ));
    assert!(matches!(
        service.voice(&agent, other_team).await,
        Err(AgentGitError::TeamMismatch)
    ));

    service.set_voice(&agent, TEAM, &voice).await.unwrap();
    assert_eq!(service.voice(&agent, TEAM).await.unwrap(), voice);
    assert_eq!(
        store.files.lock().unwrap()[&(AGENT.to_owned(), "config/voice.json".to_owned())],
        (
            b"{\n  \"model\": \"aura-2-thalia-en\"\n}\n".to_vec(),
            "Set call voice".to_owned()
        )
    );

    // The agent may commit anything to its own repo.
    store.files.lock().unwrap().insert(
        (AGENT.to_owned(), "config/voice.json".to_owned()),
        (br#"{"model":"not-a-voice"}"#.to_vec(), "agent".to_owned()),
    );
    assert!(matches!(
        service.voice(&agent, TEAM).await,
        Err(AgentGitError::NoVoice)
    ));
}

#[test]
fn an_invite_voice_replaces_the_template_default() {
    let mut chosen = seed();
    chosen.voice = Some(crate::domain::voice::VoiceModel::parse("aura-2-thalia-en").unwrap());
    let files = WORKSPACE_TEMPLATE.render(&agent(), &chosen).unwrap();
    let voices: Vec<_> = files
        .iter()
        .filter(|file| file.path == "config/voice.json")
        .collect();

    assert_eq!(voices.len(), 1);
    assert_eq!(
        voices[0].contents,
        "{\n  \"model\": \"aura-2-thalia-en\"\n}\n"
    );
}

fn seed() -> PersonaSeed {
    PersonaSeed {
        name: "Sam".to_owned(),
        job_description: "Books venues.".to_owned(),
        personality: "Warm and direct.".to_owned(),
        voice: None,
        creator_id: Some(
            MacroUserIdStr::parse_from_str("macro|admin@example.com")
                .expect("creator id")
                .into_owned(),
        ),
    }
}

fn agent() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|sam@agents.example.com")
        .expect("agent id")
        .into_owned()
}

#[test]
fn the_settings_name_the_agent_and_its_owner() {
    let files = WORKSPACE_TEMPLATE.render(&agent(), &seed()).unwrap();
    let settings = files
        .iter()
        .find(|file| file.path == "agent.json")
        .expect("agent.json is rendered");
    let settings: serde_json::Value = serde_json::from_str(&settings.contents).unwrap();

    assert_eq!(settings["owner"], "macro|admin@example.com");
    assert_eq!(settings["me"], "macro|sam@agents.example.com");
    assert_eq!(settings["name"], "Sam");
    assert_eq!(settings["email"], "sam@agents.example.com");
    assert_eq!(settings["timeZone"], "UTC");
    assert!(
        settings["model"]
            .as_str()
            .is_some_and(|model| !model.is_empty())
    );
    assert!(!files.iter().any(|file| file.path == "agent.example.json"));
}

#[test]
fn the_identity_is_seeded_from_the_invite() {
    let files = WORKSPACE_TEMPLATE.render(&agent(), &seed()).unwrap();
    let identity = files
        .iter()
        .find(|file| file.path == "state/memory/identity/identity.md")
        .expect("identity is seeded");

    assert_eq!(
        identity.contents,
        "# Sam\n\nMy owner described me when they invited me.\n\n## What I do\n\nBooks venues.\n\n## How I work and talk\n\nWarm and direct.\n"
    );
}

#[test]
fn an_invite_without_a_description_leaves_the_identity_to_the_owner() {
    let mut persona = seed();
    persona.job_description = " ".to_owned();
    persona.personality = String::new();
    let files = WORKSPACE_TEMPLATE.render(&agent(), &persona).unwrap();

    assert!(
        !files
            .iter()
            .any(|file| file.path == "state/memory/identity/identity.md")
    );
}

#[test]
fn a_seed_without_an_owner_is_refused() {
    let mut persona = seed();
    persona.creator_id = None;

    assert!(matches!(
        WORKSPACE_TEMPLATE.render(&agent(), &persona),
        Err(crate::domain::template::RenderError::MissingCreator)
    ));
}

#[tokio::test]
async fn creating_a_repo_without_a_creator_is_refused() {
    let service = AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: FakeRepos::default(),
            store: FakeStore::default(),
            admins: FakeAdmins::default(),
            limiter: FakeLimiter {
                remaining: Arc::new(Mutex::new(30)),
            },
            backend: EchoBackend::default(),
            flags: Some(Rollout(true)),
        },
        RepoLimits {
            max_repo_size_bytes: 500_000_000,
        },
        WORKSPACE_TEMPLATE,
    );
    let mut persona = seed();
    persona.creator_id = None;

    let created = service
        .create_repo(
            MacroUserIdStr::try_from(AGENT.to_owned()).unwrap(),
            TEAM,
            &persona,
        )
        .await;

    assert!(matches!(created, Err(AgentGitError::MissingCreator)));
}

#[tokio::test]
async fn recovery_preserves_live_tokens_and_recreates_missing_resources() {
    let service = AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: FakeRepos::default(),
            store: FakeStore::default(),
            admins: FakeAdmins::default(),
            limiter: FakeLimiter {
                remaining: Arc::new(Mutex::new(30)),
            },
            backend: EchoBackend::default(),
            flags: Some(Rollout(true)),
        },
        RepoLimits {
            max_repo_size_bytes: 500_000_000,
        },
        WORKSPACE_TEMPLATE,
    );
    let agent = MacroUserIdStr::try_from(AGENT.to_owned()).unwrap();
    let original = service
        .create_repo(agent.clone(), TEAM, &seed())
        .await
        .unwrap();
    let recovered = service
        .ensure_repo(agent.clone(), TEAM, &seed(), original.token.clone())
        .await
        .unwrap();
    assert_eq!(recovered.token.hash(), original.token.hash());
    assert!(matches!(
        service
            .ensure_repo(agent.clone(), TEAM, &seed(), RepoToken::generate())
            .await,
        Err(AgentGitError::InvalidToken)
    ));
    assert!(matches!(
        service
            .ensure_repo(
                agent.clone(),
                Uuid::now_v7(),
                &seed(),
                original.token.clone()
            )
            .await,
        Err(AgentGitError::TeamMismatch)
    ));
    service.adapters.store.delete_repo(&agent).await.unwrap();
    service
        .ensure_repo(agent.clone(), TEAM, &seed(), original.token.clone())
        .await
        .unwrap();
    assert!(
        service
            .adapters
            .store
            .repos
            .lock()
            .unwrap()
            .contains(agent.as_ref())
    );
    service.adapters.repos.delete_repo(&agent).await.unwrap();
    service
        .ensure_repo(agent.clone(), TEAM, &seed(), original.token.clone())
        .await
        .unwrap();
    let row = service
        .adapters
        .repos
        .find_repo(&agent)
        .await
        .unwrap()
        .unwrap();
    assert!(row.token_hash.matches(&original.token.hash()));
}

/// Pause recovery immediately before it publishes storage to overlap deletion.
struct PausedStore {
    store: FakeStore,
    creating: Arc<tokio::sync::Notify>,
    resume: Arc<tokio::sync::Notify>,
}

impl RepoStore for PausedStore {
    type Err = Infallible;
    async fn create_repo(
        &self,
        agent: &MacroUserIdStr<'_>,
        files: &[RenderedFile],
    ) -> Result<(), Self::Err> {
        self.creating.notify_one();
        self.resume.notified().await;
        self.store.create_repo(agent, files).await
    }

    async fn delete_repo(&self, agent: &MacroUserIdStr<'_>) -> Result<(), Self::Err> {
        self.store.delete_repo(agent).await
    }

    async fn repo_size_bytes(&self, agent: &MacroUserIdStr<'_>) -> Result<u64, Self::Err> {
        self.store.repo_size_bytes(agent).await
    }

    async fn read_file(
        &self,
        agent: &MacroUserIdStr<'_>,
        path: &str,
    ) -> Result<Option<Vec<u8>>, Self::Err> {
        self.store.read_file(agent, path).await
    }

    async fn commit_file(
        &self,
        agent: &MacroUserIdStr<'_>,
        path: &str,
        contents: &[u8],
        message: &str,
    ) -> Result<(), Self::Err> {
        self.store.commit_file(agent, path, contents, message).await
    }
}

#[tokio::test]
async fn deletion_waits_for_recovery_and_removes_its_published_storage() {
    let creating = Arc::new(tokio::sync::Notify::new());
    let resume = Arc::new(tokio::sync::Notify::new());
    let store = FakeStore::default();
    let repos = FakeRepos::default();
    let service = Arc::new(AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: repos.clone(),
            store: PausedStore {
                store: store.clone(),
                creating: creating.clone(),
                resume: resume.clone(),
            },
            admins: FakeAdmins::default(),
            limiter: FakeLimiter {
                remaining: Arc::new(Mutex::new(30)),
            },
            backend: EchoBackend::default(),
            flags: Some(Rollout(true)),
        },
        RepoLimits {
            max_repo_size_bytes: 500_000_000,
        },
        WORKSPACE_TEMPLATE,
    ));
    let agent = MacroUserIdStr::try_from(AGENT.to_owned()).unwrap();
    let recovery_service = service.clone();
    let recovery_agent = agent.clone();
    let recovery = tokio::spawn(async move {
        recovery_service
            .ensure_repo(recovery_agent, TEAM, &seed(), RepoToken::generate())
            .await
    });
    creating.notified().await;
    let mut deletion = Box::pin(service.delete_repo(&agent));
    // Poll deletion while recovery is paused: it must wait for publication.
    assert!(futures::poll!(deletion.as_mut()).is_pending());
    resume.notify_one();
    recovery.await.unwrap().unwrap();
    deletion.await.unwrap();
    assert!(repos.find_repo(&agent).await.unwrap().is_none());
    assert!(!store.repos.lock().unwrap().contains(agent.as_ref()));
}

#[tokio::test]
async fn a_push_holds_the_repo_lock_until_its_response_ends_and_management_takes_it() {
    let repos = FakeRepos::default();
    let service = AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: repos.clone(),
            store: FakeStore::default(),
            admins: FakeAdmins::default(),
            limiter: FakeLimiter {
                remaining: Arc::new(Mutex::new(30)),
            },
            backend: EchoBackend::default(),
            flags: Some(Rollout(true)),
        },
        RepoLimits {
            max_repo_size_bytes: 500_000_000,
        },
        WORKSPACE_TEMPLATE,
    );
    let agent = MacroUserIdStr::try_from(AGENT.to_owned()).unwrap();
    let created = service
        .create_repo(agent.clone(), TEAM, &seed())
        .await
        .unwrap();
    assert_eq!(*repos.lock_log.lock().unwrap(), vec![AGENT.to_owned()]);
    assert!(repos.locked.lock().unwrap().is_empty());

    let push = service
        .serve_git(
            GitCredential::RepoToken(created.token.clone()),
            &agent,
            request(GitEndpoint::Rpc(GitService::ReceivePack), b"pack"),
        )
        .await
        .unwrap();
    // git is still receiving while the response streams.
    assert_eq!(*repos.locked.lock().unwrap(), vec![AGENT.to_owned()]);
    let body: Vec<_> = push.body.collect().await;
    assert_eq!(body.len(), 1);
    assert!(repos.locked.lock().unwrap().is_empty());

    // Reads never wait for a push.
    service
        .serve_git(
            GitCredential::RepoToken(created.token.clone()),
            &agent,
            request(GitEndpoint::Rpc(GitService::UploadPack), b""),
        )
        .await
        .unwrap();
    service.delete_repo(&agent).await.unwrap();
    assert_eq!(
        *repos.lock_log.lock().unwrap(),
        vec![AGENT.to_owned(), AGENT.to_owned(), AGENT.to_owned()]
    );
    assert!(repos.locked.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_second_push_while_one_holds_the_repo_is_busy_and_a_rate_limited_one_never_locks() {
    let repos = FakeRepos::default();
    let limiter = FakeLimiter {
        remaining: Arc::new(Mutex::new(2)),
    };
    let service = AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: repos.clone(),
            store: FakeStore::default(),
            admins: FakeAdmins::default(),
            limiter: limiter.clone(),
            backend: EchoBackend::default(),
            flags: Some(Rollout(true)),
        },
        RepoLimits {
            max_repo_size_bytes: 500_000_000,
        },
        WORKSPACE_TEMPLATE,
    );
    let agent = MacroUserIdStr::try_from(AGENT.to_owned()).unwrap();
    let created = service
        .create_repo(agent.clone(), TEAM, &seed())
        .await
        .unwrap();
    let push = || {
        service.serve_git(
            GitCredential::RepoToken(created.token.clone()),
            &agent,
            request(GitEndpoint::Rpc(GitService::ReceivePack), b"pack"),
        )
    };

    let first = push().await.unwrap();
    assert!(matches!(push().await, Err(AgentGitError::RepoBusy)));
    drop(first);
    let locks_before = repos.lock_log.lock().unwrap().len();
    // Both window slots are spent; the next push is refused before the lock.
    assert!(matches!(push().await, Err(AgentGitError::PushRateLimited)));
    assert_eq!(repos.lock_log.lock().unwrap().len(), locks_before);
}

#[tokio::test]
async fn with_the_rollout_off_for_the_agent_its_repo_is_closed_to_every_credential() {
    let service = AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: FakeRepos::default(),
            store: FakeStore::default(),
            admins: FakeAdmins::default(),
            limiter: FakeLimiter {
                remaining: Arc::new(Mutex::new(30)),
            },
            backend: EchoBackend::default(),
            flags: Some(Rollout(false)),
        },
        RepoLimits {
            max_repo_size_bytes: 500_000_000,
        },
        WORKSPACE_TEMPLATE,
    );
    let agent = MacroUserIdStr::try_from(AGENT.to_owned()).unwrap();
    let created = service
        .create_repo(agent.clone(), TEAM, &seed())
        .await
        .unwrap();

    for endpoint in [
        GitEndpoint::Rpc(GitService::UploadPack),
        GitEndpoint::Rpc(GitService::ReceivePack),
    ] {
        assert!(matches!(
            service
                .serve_git(
                    GitCredential::RepoToken(created.token.clone()),
                    &agent,
                    request(endpoint, b""),
                )
                .await,
            Err(AgentGitError::NotFound)
        ));
    }
}
