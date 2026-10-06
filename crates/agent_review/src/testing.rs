//! In-memory capabilities for review domain and Internal MCP contract tests.
#![allow(missing_docs)]

use crate::domain::{model::*, ports::*, service::ReviewService};
use agent_session::{
    domain::model::AgentSessionId,
    testing::{InMemoryAgentSessionRepo, test_agent_session},
};
use async_trait::async_trait;
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[derive(Default)]
pub struct MemoryReviewRepo {
    pub state: Mutex<Option<Review>>,
    claim: Mutex<Option<Uuid>>,
    delivered: Mutex<HashSet<Uuid>>,
}

#[async_trait]
impl ReviewRepo for MemoryReviewRepo {
    async fn cleanup_sessions(&self) -> Result<Vec<AgentSessionId>> {
        Ok(vec![])
    }
    async fn finish_cleanup(&self, _: AgentSessionId) -> Result<()> {
        Ok(())
    }
    async fn load(&self, id: AgentSessionId) -> Result<Option<Review>> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .clone()
            .filter(|r| r.session_id == id.as_uuid()))
    }
    async fn load_view(&self, id: AgentSessionId, revision: Option<u32>) -> Result<Option<Review>> {
        let mut review = self.load(id).await?;
        if let Some(review) = &mut review {
            let selected = revision.or_else(|| review.revisions.last().map(|r| r.number));
            for other in &mut review.revisions {
                if Some(other.number) != selected {
                    other.files.clear();
                    other.symbols.clear();
                    other.tour.clear();
                    other.annotations.clear();
                    other.file_groups.clear();
                    other.graph = None;
                }
            }
        }
        Ok(review)
    }
    async fn file_content(
        &self,
        id: AgentSessionId,
        revision: u32,
        path: &str,
    ) -> Result<Option<String>> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .as_ref()
            .filter(|r| r.session_id == id.as_uuid())
            .and_then(|r| r.revisions.iter().find(|r| r.number == revision))
            .and_then(|r| r.files.iter().find(|f| f.path == path))
            .map(|f| f.content.clone()))
    }
    async fn save(
        &self,
        review: &Review,
        previous: Option<i64>,
        claim: Option<Uuid>,
    ) -> Result<bool> {
        if claim.is_some() && claim != *self.claim.lock().unwrap() {
            return Err(ReviewError::Conflict);
        }
        let mut state = self.state.lock().unwrap();
        if state.as_ref().map(|r| r.version) != previous {
            return Ok(false);
        }
        *state = Some(review.clone());
        Ok(true)
    }
    async fn claim_capture(&self, _: AgentSessionId, id: Uuid) -> Result<bool> {
        let mut claim = self.claim.lock().unwrap();
        if claim.is_some() {
            return Ok(false);
        }
        *claim = Some(id);
        Ok(true)
    }
    async fn release_capture(&self, _: AgentSessionId, id: Uuid) -> Result<()> {
        let mut claim = self.claim.lock().unwrap();
        if *claim == Some(id) {
            *claim = None;
        }
        Ok(())
    }
    async fn pending_feedback(&self) -> Result<Vec<AgentSessionId>> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .as_ref()
            .map(|r| vec![AgentSessionId::new_from_uuid(r.session_id)])
            .unwrap_or_default())
    }
    async fn claim_feedback(&self, _: AgentSessionId, message: Uuid) -> Result<bool> {
        Ok(!self.delivered.lock().unwrap().contains(&message))
    }
    async fn finish_feedback(
        &self,
        _: AgentSessionId,
        message: Uuid,
        delivered: bool,
    ) -> Result<()> {
        if delivered {
            self.delivered.lock().unwrap().insert(message);
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct MemoryBodies(pub Mutex<HashMap<(AgentSessionId, String), ReviewFile>>);
#[async_trait]
impl ReviewBodies for MemoryBodies {
    async fn delete_session(&self, session: AgentSessionId) -> Result<()> {
        self.0.lock().unwrap().retain(|(id, _), _| *id != session);
        Ok(())
    }
    async fn put(&self, session: AgentSessionId, content: &str, file: &ReviewFile) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .insert((session, content.into()), file.clone());
        Ok(())
    }
    async fn get(&self, session: AgentSessionId, content: &str) -> Result<ReviewFile> {
        self.0
            .lock()
            .unwrap()
            .get(&(session, content.into()))
            .cloned()
            .ok_or(ReviewError::NotFound)
    }
}

pub struct MutableSource(pub Mutex<Capture>);
#[async_trait]
impl ReviewSource for MutableSource {
    async fn capture(
        &self,
        _: &agent_session::domain::model::AgentSession,
        comparison: &Comparison,
    ) -> Result<Capture> {
        let mut capture = self.0.lock().unwrap().clone();
        capture.comparison = Comparison {
            base: comparison.base.clone().or(Some("base-sha".into())),
            head: comparison.head.clone(),
            worktree: false,
        };
        Ok(capture)
    }
}

#[derive(Default)]
pub struct RecordingFeedback(pub Mutex<Vec<(Uuid, String)>>);
#[async_trait]
impl ReviewFeedback for RecordingFeedback {
    async fn send(&self, _: AgentSessionId, _: &str, message: Uuid, prompt: String) -> Result<()> {
        self.0.lock().unwrap().push((message, prompt));
        Ok(())
    }
}
pub struct NoEvents;
#[async_trait]
impl ReviewEvents for NoEvents {
    async fn changed(&self, _: AgentSessionId, _: ReviewId) -> Result<()> {
        Ok(())
    }
}

pub fn capture(text: &str) -> Capture {
    let file: ReviewFile = serde_json::from_value(serde_json::json!({
        "path":"src/main.rs", "status":"added", "language":"rust", "added":text.lines().count(), "removed":0, "collapsed":null, "labels":[],
        "old":null, "new":{"lines":text.lines().collect::<Vec<_>>(),"syntax":[],"novel":[]},
        "rows":text.lines().enumerate().map(|(i,_)| (None::<usize>,Some(i))).collect::<Vec<_>>(), "details":[], "since":[]
    })).unwrap();
    Capture {
        comparison: Comparison::default(),
        repository: "test/repo".into(),
        source: SourceKind::Workspace,
        snapshot: serde_json::from_value(
            serde_json::json!({"revision":1,"files":[file],"symbols":[]}),
        )
        .unwrap(),
    }
}

pub struct Fixture {
    pub sessions: InMemoryAgentSessionRepo,
    pub repo: Arc<MemoryReviewRepo>,
    pub bodies: Arc<MemoryBodies>,
    pub source: Arc<MutableSource>,
    pub feedback: Arc<RecordingFeedback>,
    pub service: Arc<ReviewService<InMemoryAgentSessionRepo>>,
}
impl Fixture {
    pub fn new() -> Self {
        let sessions = InMemoryAgentSessionRepo::new();
        sessions.insert_session(test_agent_session(AgentSessionId::TEST_A));
        let repo = Arc::new(MemoryReviewRepo::default());
        let bodies = Arc::new(MemoryBodies::default());
        let source = Arc::new(MutableSource(Mutex::new(capture(
            "fn main() {\n    hello();\n}",
        ))));
        let feedback = Arc::new(RecordingFeedback::default());
        let service = Arc::new(ReviewService::new(
            sessions.clone(),
            repo.clone(),
            bodies.clone(),
            source.clone(),
            feedback.clone(),
            Arc::new(NoEvents),
            "http://localhost:3004".parse().unwrap(),
        ));
        Self {
            sessions,
            repo,
            bodies,
            source,
            feedback,
            service,
        }
    }
}
impl Default for Fixture {
    fn default() -> Self {
        Self::new()
    }
}
pub fn agent() -> ReviewAccess {
    ReviewAccess::Agent {
        session: AgentSessionId::TEST_A,
        owner: user(),
    }
}
pub fn user() -> macro_user_id::user_id::MacroUserIdStr<'static> {
    macro_user_id::user_id::MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}
pub fn editor() -> ReviewAccess {
    ReviewAccess::Edit(
        entity_access::domain::models::EntityAccessReceipt::dangerously_assert_authenticated_user(
            user(),
            &AgentSessionId::TEST_A.to_string(),
            entity_access::domain::models::EntityType::AgentSession,
        ),
    )
}
