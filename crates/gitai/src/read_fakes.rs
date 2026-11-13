//! Fakes for the read API's tests: the read port over the ingest fakes (so
//! tests write through the real ingest path), and a scripted GitHub.

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use crate::domain::models::ClientHeaders;
use crate::domain::read::models::{
    CachedPullRequest, CommitPullRequestLink, CommitSession, GithubBlame, GithubCommit,
    GithubPullRequest, StoredCommit, StoredSession, Tokens, TranscriptChunk,
};
use crate::domain::read::ports::{GithubApi, GithubError, ReadIndex};
use crate::domain::read::service::ReadService;
use crate::fakes::{MemoryIndex, MemoryObjects, SHARED_KEY, TestService, service};

pub(crate) const REPO_URL: &str = "https://github.com/macro-inc/macro";

#[derive(Default)]
pub(crate) struct ReadCache {
    pub(crate) pull_requests: HashMap<u64, CachedPullRequest>,
    pub(crate) links: HashMap<String, CommitPullRequestLink>,
}

/// [`ReadIndex`] over the ingest fake's maps, plus the GitHub cache.
#[derive(Clone, Default)]
pub(crate) struct MemoryReadIndex {
    pub(crate) index: MemoryIndex,
    pub(crate) cache: Arc<Mutex<ReadCache>>,
}

impl ReadIndex for MemoryReadIndex {
    type Err = Infallible;

    async fn commits(&self, shas: &[String]) -> Result<Vec<StoredCommit>, Self::Err> {
        let state = self.index.state.lock().unwrap();
        Ok(shas
            .iter()
            .filter_map(|sha| state.commits.get(sha))
            .map(|commit| StoredCommit {
                sha: commit.sha.clone(),
                ai_lines: commit.ai_lines,
                human_lines: commit.human_lines,
                sessions: commit
                    .sessions
                    .iter()
                    .map(|session| CommitSession {
                        session_id: session.session_id.clone(),
                        tool: session.tool.clone(),
                        model: session.model.clone(),
                    })
                    .collect(),
                note_key: commit.note_key.clone(),
                author: Some(commit.author.as_str().to_owned()),
            })
            .collect())
    }

    async fn sessions(&self, ids: &[String]) -> Result<Vec<StoredSession>, Self::Err> {
        let state = self.index.state.lock().unwrap();
        let unsigned = |value: i64| u64::try_from(value).unwrap();
        Ok(ids
            .iter()
            .filter_map(|id| state.sessions.get(id).map(|session| (id, session)))
            .map(|(id, session)| {
                let mut commit_shas: Vec<String> = session.commit_shas.iter().cloned().collect();
                commit_shas.sort();
                StoredSession {
                    id: id.clone(),
                    tool: session.tool.clone(),
                    model: session.model.clone(),
                    author: session.author.clone(),
                    repository: Some("github.com/macro-inc/macro".to_owned()),
                    first_seen: session.first_seen,
                    last_seen: session.last_seen,
                    event_count: session.event_count,
                    tokens: Tokens {
                        input: unsigned(session.tokens.input),
                        output: unsigned(session.tokens.output),
                        cache_read: unsigned(session.tokens.cache_read),
                        cache_write: unsigned(session.tokens.cache_write),
                    },
                    cost_micro_usd: unsigned(session.tokens.cost_micro_usd),
                    commit_shas,
                }
            })
            .collect())
    }

    async fn transcript_chunks(
        &self,
        session_id: &str,
        from: Option<&str>,
    ) -> Result<Vec<TranscriptChunk>, Self::Err> {
        let state = self.index.state.lock().unwrap();
        Ok(state
            .chunks
            .get(session_id)
            .into_iter()
            .flatten()
            .map(|(sort_key, s3_key)| TranscriptChunk {
                sort_key: format!("CHUNK#{sort_key}"),
                s3_key: s3_key.clone(),
            })
            .filter(|chunk| from.is_none_or(|from| chunk.sort_key.as_str() >= from))
            .collect())
    }

    async fn cached_pull_request(
        &self,
        number: u64,
    ) -> Result<Option<CachedPullRequest>, Self::Err> {
        Ok(self
            .cache
            .lock()
            .unwrap()
            .pull_requests
            .get(&number)
            .cloned())
    }

    async fn cache_pull_request(&self, pull_request: &CachedPullRequest) -> Result<(), Self::Err> {
        self.cache
            .lock()
            .unwrap()
            .pull_requests
            .insert(pull_request.number, pull_request.clone());
        Ok(())
    }

    async fn cached_commit_link(
        &self,
        sha: &str,
    ) -> Result<Option<CommitPullRequestLink>, Self::Err> {
        Ok(self.cache.lock().unwrap().links.get(sha).cloned())
    }

    async fn cache_commit_link(&self, link: &CommitPullRequestLink) -> Result<(), Self::Err> {
        self.cache
            .lock()
            .unwrap()
            .links
            .insert(link.sha.clone(), link.clone());
        Ok(())
    }
}

#[derive(Default)]
pub(crate) struct GithubScript {
    /// Full SHA → subject.
    pub(crate) commits: HashMap<String, String>,
    /// Number → (open, commits).
    pub(crate) pull_requests: HashMap<u64, (bool, Vec<String>)>,
    /// Revision → blame.
    pub(crate) blames: HashMap<String, GithubBlame>,
    /// When set, every call fails with it.
    pub(crate) failure: Option<GithubError>,
    /// Calls made.
    pub(crate) calls: u32,
}

/// A GitHub that answers from a script and counts calls.
#[derive(Clone, Default)]
pub(crate) struct FakeGithub {
    pub(crate) script: Arc<Mutex<GithubScript>>,
}

impl FakeGithub {
    fn call(&self) -> Result<std::sync::MutexGuard<'_, GithubScript>, GithubError> {
        let mut script = self.script.lock().unwrap();
        script.calls += 1;
        match script.failure {
            Some(failure) => Err(failure),
            None => Ok(script),
        }
    }

    pub(crate) fn calls(&self) -> u32 {
        self.script.lock().unwrap().calls
    }
}

impl GithubApi for FakeGithub {
    async fn commit(&self, sha: &str) -> Result<Option<GithubCommit>, GithubError> {
        let script = self.call()?;
        Ok(script
            .commits
            .iter()
            .find(|(full, _)| full.starts_with(sha))
            .map(|(full, subject)| GithubCommit {
                sha: full.clone(),
                subject: subject.clone(),
            }))
    }

    async fn pull_request(&self, number: u64) -> Result<Option<GithubPullRequest>, GithubError> {
        let script = self.call()?;
        Ok(script
            .pull_requests
            .get(&number)
            .map(|(open, _)| GithubPullRequest {
                number,
                open: *open,
            }))
    }

    async fn pull_request_commits(&self, number: u64) -> Result<Vec<String>, GithubError> {
        let script = self.call()?;
        Ok(script
            .pull_requests
            .get(&number)
            .map(|(_, commits)| commits.clone())
            .unwrap_or_default())
    }

    async fn blame(&self, rev: &str, _path: &str) -> Result<Option<GithubBlame>, GithubError> {
        let script = self.call()?;
        Ok(script.blames.get(rev).cloned())
    }
}

pub(crate) type TestReader = ReadService<TestService, MemoryObjects, MemoryReadIndex, FakeGithub>;

/// A read service over fresh fakes, a device credential, and the handles.
pub(crate) struct ReadHarness {
    pub(crate) gitai: Arc<TestService>,
    pub(crate) reader: Arc<TestReader>,
    pub(crate) github: FakeGithub,
    pub(crate) index: MemoryReadIndex,
    pub(crate) credential: String,
}

impl ReadHarness {
    pub(crate) async fn new() -> Self {
        let (gitai, objects, index, _metrics) = service();
        let gitai = Arc::new(gitai);
        let credential = gitai
            .mint_credential(Some(SHARED_KEY), "dev@example.com", "laptop-1")
            .await
            .unwrap()
            .credential
            .expose()
            .to_owned();
        let index = MemoryReadIndex {
            index,
            cache: Arc::default(),
        };
        let github = FakeGithub::default();
        let reader = Arc::new(ReadService::new(
            gitai.clone(),
            objects,
            index.clone(),
            github.clone(),
        ));
        Self {
            gitai,
            reader,
            github,
            index,
            credential,
        }
    }

    pub(crate) fn key(&self) -> Option<&str> {
        Some(&self.credential)
    }

    /// Uploads events through the ingest use case.
    pub(crate) async fn upload(&self, events: Vec<Value>) {
        let body = serde_json::to_vec(&json!({ "v": 1, "events": events })).unwrap();
        let errors = self
            .gitai
            .ingest_metrics(self.key(), &ClientHeaders::default(), &body)
            .await
            .unwrap();
        assert!(errors.is_empty(), "{errors:?}");
    }
}

/// A Committed event for `sha` whose note attests `lines` per session.
pub(crate) fn committed(sha: &str, ai: u64, human: u64, note: &str) -> Value {
    json!({
        "t": 1_794_543_000,
        "e": 1,
        "a": { "0": "1.7.7", "1": REPO_URL, "3": sha },
        "v": {
            "0": human,
            "2": ai + human,
            "3": ["all", "claude::claude-sonnet-4-5"],
            "5": [ai, ai],
            "11": "synthetic commit",
            "13": note,
        },
    })
}

/// A transcript line of `session`, numbered `n`.
pub(crate) fn session_event(session: &str, t: u64, n: u64) -> Value {
    json!({
        "t": t,
        "e": 5,
        "a": { "0": "1.7.7", "1": REPO_URL, "20": "claude", "23": format!("ext-{session}"), "24": session, "25": format!("t_{n:014}") },
        "v": { "0": { "type": "user", "n": n } },
    })
}

/// A token bucket of `session`.
pub(crate) fn token_usage(session: &str, input: u64, output: u64, cost_micro_usd: u64) -> Value {
    json!({
        "t": 1_794_543_100,
        "e": 9,
        "a": { "0": "1.7.7", "1": REPO_URL, "20": "claude", "21": "claude-sonnet-4-5", "23": format!("ext-{session}"), "24": session },
        "v": { "0": 1_794_543_000, "1": input, "2": output, "3": 0, "4": 0, "7": cost_micro_usd, "10": 1, "11": 0 },
    })
}

/// A note naming `sessions` with the attestation section `attestations`.
pub(crate) fn note(attestations: &str, sessions: &[&str]) -> String {
    let sessions: serde_json::Map<String, Value> = sessions
        .iter()
        .map(|id| {
            (
                (*id).to_owned(),
                json!({ "agent_id": { "tool": "claude", "id": format!("ext-{id}"), "model": "claude-sonnet-4-5" } }),
            )
        })
        .collect();
    let metadata = json!({
        "schema_version": "authorship/3.0.0",
        "base_commit_sha": "0000000000000000000000000000000000000000",
        "prompts": {},
        "sessions": sessions,
    });
    format!("{attestations}---\n{metadata}")
}
