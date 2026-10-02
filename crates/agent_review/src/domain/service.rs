//! Review use cases: authority, immutable publication, anchoring, and feedback.

use std::sync::Arc;

use agent_session::domain::{
    model::{AgentSession, AgentSessionId},
    ports::AgentSessionRepo,
};
use async_trait::async_trait;
use chrono::Utc;
use entity_access::domain::models::{EntityAccessReceipt, EntityType, RequiredPermission};
use uuid::Uuid;

use super::model::*;
use super::ports::*;

mod anchors;
mod capture;
mod presentation;
#[cfg(test)]
mod test;

const WRITE_RETRIES: usize = 8;
const MAX_MESSAGE_BYTES: usize = 32_768;
const MAX_FILES: usize = 10_000;

/// The shared HTTP/Internal MCP use-case boundary.
#[async_trait]
pub trait Reviews: Send + Sync + 'static {
    /// Read metadata; optionally pin the manifest to a historical revision.
    async fn view(&self, access: ReviewAccess, revision: Option<u32>) -> Result<Option<Review>>;
    /// Read one immutable file belonging to this review and revision.
    async fn file(&self, access: ReviewAccess, revision: u32, path: &str) -> Result<ReviewFile>;
    /// Capture the authorized source, pin its base, and publish atomically.
    async fn capture(
        &self,
        access: ReviewAccess,
        comparison: Comparison,
        presentation: Presentation,
    ) -> Result<ReviewLink>;
    /// Replace the agent's tour/explanations against an expected revision.
    async fn annotate(
        &self,
        access: ReviewAccess,
        revision: u32,
        presentation: Presentation,
    ) -> Result<ReviewLink>;
    /// Validate and persist a durable code selection; return its canonical link.
    async fn link(
        &self,
        access: ReviewAccess,
        revision: u32,
        location: Location,
    ) -> Result<ReviewLink>;
    /// Save a human comment atomically with pending delivery.
    async fn comment(&self, access: ReviewAccess, comment: Comment) -> Result<ReviewLink>;
    /// Append an agent reply to the same thread, idempotently.
    async fn reply(
        &self,
        access: ReviewAccess,
        thread: Uuid,
        id: Uuid,
        body: String,
    ) -> Result<ReviewLink>;
    /// Human-controlled thread resolution.
    async fn resolve(&self, access: ReviewAccess, thread: Uuid, resolved: bool) -> Result<()>;
    /// Retry durable feedback; called by a bounded background worker.
    async fn deliver_pending(&self) -> Result<()>;
}

/// Domain service over the session authority and review-owned capabilities.
pub struct ReviewService<S> {
    sessions: S,
    repo: Arc<dyn ReviewRepo>,
    bodies: Arc<dyn ReviewBodies>,
    source: Arc<dyn ReviewSource>,
    feedback: Arc<dyn ReviewFeedback>,
    events: Arc<dyn ReviewEvents>,
    origin: url::Url,
}

impl<S> ReviewService<S> {
    /// Assemble review policy; adapters are constructed by the composition root.
    pub fn new(
        sessions: S,
        repo: Arc<dyn ReviewRepo>,
        bodies: Arc<dyn ReviewBodies>,
        source: Arc<dyn ReviewSource>,
        feedback: Arc<dyn ReviewFeedback>,
        events: Arc<dyn ReviewEvents>,
        origin: url::Url,
    ) -> Self {
        Self {
            sessions,
            repo,
            bodies,
            source,
            feedback,
            events,
            origin,
        }
    }

    fn url(
        &self,
        review: &Review,
        revision: u32,
        target: Option<Uuid>,
        thread: Option<Uuid>,
    ) -> ReviewLink {
        let mut url = self.origin.clone();
        url.set_path(&format!("/app/agent/{}", review.session_id));
        url.set_query(None);
        url.set_fragment(None);
        url.query_pairs_mut()
            .append_pair("s0.review.open", "true")
            .append_pair("s0.review.id", &review.id.0.to_string())
            .append_pair("s0.review.revision", &revision.to_string());
        if let Some(target) = target {
            url.query_pairs_mut()
                .append_pair("s0.review.target", &target.to_string());
        }
        if let Some(thread) = thread {
            url.query_pairs_mut()
                .append_pair("s0.review.thread", &thread.to_string());
        }
        ReviewLink {
            review_id: review.id,
            revision,
            url: url.into(),
        }
    }

    async fn notify(&self, review: &Review) {
        if let Err(error) = self
            .events
            .changed(AgentSessionId::new_from_uuid(review.session_id), review.id)
            .await
        {
            tracing::warn!(?error, "review saved but realtime invalidation failed");
        }
    }

    async fn store(&self, review: &mut Review, previous: Option<i64>) -> Result<bool> {
        review.version = previous.unwrap_or(0) + 1;
        self.repo.save(review, previous, None).await
    }

    async fn body_at(
        &self,
        review: &Review,
        revision: u32,
        location: &Location,
    ) -> Result<ReviewFile> {
        let entry = review
            .revisions
            .iter()
            .find(|r| r.number == revision)
            .and_then(|r| r.files.iter().find(|f| f.path == location.path))
            .ok_or(ReviewError::NotFound)?;
        self.bodies
            .get(
                AgentSessionId::new_from_uuid(review.session_id),
                &entry.content,
            )
            .await
    }

    async fn anchor(&self, review: &Review, revision: u32, location: Location) -> Result<Anchor> {
        let body = self.body_at(review, revision, &location).await?;
        let mut anchor = anchors::create(revision, location, &body)?;
        if let Some(latest) = review.revisions.last().filter(|r| r.number != revision) {
            if let Some(entry) = latest.files.iter().find(|f| {
                f.path == anchor.current.path || f.old_path.as_ref() == Some(&anchor.current.path)
            }) {
                let body = self
                    .bodies
                    .get(
                        AgentSessionId::new_from_uuid(review.session_id),
                        &entry.content,
                    )
                    .await?;
                anchors::follow(&mut anchor, &[body]);
            } else {
                anchor.status = AnchorStatus::Outdated;
            }
        }
        Ok(anchor)
    }

    async fn validate_presentation(
        &self,
        review: &Review,
        presentation: &Presentation,
    ) -> Result<()> {
        let revision = review.revisions.last().ok_or(ReviewError::NotFound)?;
        if let Some(title) = &presentation.title {
            validate_text(title, 300)?;
        }
        if presentation
            .summary
            .as_ref()
            .is_some_and(|s| s.len() > MAX_MESSAGE_BYTES)
            || presentation.tour.as_ref().is_some_and(|t| t.len() > 100)
            || presentation
                .annotations
                .as_ref()
                .is_some_and(|a| a.len() > 500)
        {
            return Err(ReviewError::Invalid(
                "Review explanation exceeds its size budget".into(),
            ));
        }
        presentation::validate_groups(revision, presentation.file_groups.as_deref())?;
        self.validate_graph(review, presentation.graph.as_ref())
            .await?;
        let mut keys = std::collections::HashSet::new();
        for chapter in presentation.tour.iter().flatten() {
            validate_text(&chapter.key, 100)?;
            validate_text(&chapter.title, 300)?;
            validate_text(&chapter.description, MAX_MESSAGE_BYTES)?;
            if !keys.insert(&chapter.key)
                || chapter
                    .paths
                    .iter()
                    .any(|p| !revision.files.iter().any(|f| &f.path == p))
            {
                return Err(ReviewError::Invalid(
                    "Tour keys must be unique and files must exist in this revision".into(),
                ));
            }
            self.anchor(review, revision.number, chapter.focus.clone())
                .await?;
        }
        keys.clear();
        for annotation in presentation.annotations.iter().flatten() {
            validate_text(&annotation.key, 100)?;
            validate_text(&annotation.body, MAX_MESSAGE_BYTES)?;
            if !keys.insert(&annotation.key) {
                return Err(ReviewError::Invalid(
                    "Annotation keys must be unique".into(),
                ));
            }
            self.anchor(review, revision.number, annotation.location.clone())
                .await?;
        }
        Ok(())
    }
}

fn apply_presentation(review: &mut Review, presentation: &Presentation) {
    if let Some(title) = &presentation.title {
        review.title.clone_from(title);
    }
    if let Some(summary) = &presentation.summary {
        review.summary.clone_from(summary);
    }
    if let Some(tour) = &presentation.tour {
        review.tour.clone_from(tour);
    }
    if let Some(notes) = &presentation.annotations {
        review.annotations.clone_from(notes);
    }
    if let Some(groups) = &presentation.file_groups {
        review.file_groups.clone_from(groups);
    }
    if let Some(graph) = &presentation.graph {
        review.graph = (!graph.nodes.is_empty()).then(|| graph.clone());
    }
    if let Some(revision) = review.revisions.last_mut() {
        revision.file_groups.clone_from(&review.file_groups);
        revision.graph.clone_from(&review.graph);
        revision.tour.clone_from(&review.tour);
        revision.annotations.clone_from(&review.annotations);
    }
}

fn receipt_session<P: RequiredPermission>(
    access: &EntityAccessReceipt<P>,
) -> Result<AgentSessionId> {
    if access.entity().entity_type != EntityType::AgentSession {
        return Err(ReviewError::Forbidden);
    }
    let id = access
        .entity()
        .entity_id
        .parse()
        .map_err(|_| ReviewError::Forbidden)?;
    Ok(AgentSessionId::new_from_uuid(id))
}

fn validate_text(value: &str, max: usize) -> Result<()> {
    if value.trim().is_empty() || value.len() > max {
        return Err(ReviewError::Invalid(format!(
            "Text must contain 1–{max} bytes"
        )));
    }
    Ok(())
}

impl<S: AgentSessionRepo> ReviewService<S> {
    async fn authorize(
        &self,
        access: ReviewAccess,
        write: bool,
        agent_only: bool,
    ) -> Result<(AgentSession, Author)> {
        let (id, author) = match access {
            ReviewAccess::View(receipt) if !write && !agent_only => (
                receipt_session(&receipt)?,
                Author::User {
                    id: receipt
                        .get_authenticated_user()
                        .map_err(|_| ReviewError::Forbidden)?
                        .to_string(),
                },
            ),
            ReviewAccess::Edit(receipt) if !agent_only => (
                receipt_session(&receipt)?,
                Author::User {
                    id: receipt
                        .get_authenticated_user()
                        .map_err(|_| ReviewError::Forbidden)?
                        .to_string(),
                },
            ),
            ReviewAccess::Agent { session, owner } => {
                let stored = self
                    .sessions
                    .get(session)
                    .await
                    .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
                if !stored.owner_id.is_user(&owner) {
                    return Err(ReviewError::Forbidden);
                }
                return Ok((stored, Author::Agent));
            }
            _ => return Err(ReviewError::Forbidden),
        };
        let stored = self
            .sessions
            .get(id)
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        Ok((stored, author))
    }
}

#[async_trait]
impl<S: AgentSessionRepo> Reviews for ReviewService<S> {
    async fn view(&self, access: ReviewAccess, revision: Option<u32>) -> Result<Option<Review>> {
        let (session, _) = self.authorize(access, false, false).await?;
        let Some(mut review) = self.repo.load(session.id).await? else {
            return Ok(None);
        };
        let selected = revision.unwrap_or_else(|| review.revisions.last().map_or(0, |r| r.number));
        if !review.revisions.iter().any(|r| r.number == selected) {
            return Err(ReviewError::NotFound);
        }
        if let Some(revision) = review.revisions.iter().find(|r| r.number == selected) {
            review.tour.clone_from(&revision.tour);
            review.annotations.clone_from(&revision.annotations);
            review.file_groups.clone_from(&revision.file_groups);
            review.graph.clone_from(&revision.graph);
        }
        // History lists stay small; only the selected manifest is sent to the reader.
        for other in &mut review.revisions {
            if other.number != selected {
                other.files.clear();
                other.symbols.clear();
                other.tour.clear();
                other.annotations.clear();
                other.file_groups.clear();
                other.graph = None;
            }
        }
        if let Some(revision) = review.revisions.iter().find(|r| r.number == selected) {
            for group in &mut review.file_groups {
                group.files = revision
                    .files
                    .iter()
                    .filter(|file| {
                        group
                            .files
                            .iter()
                            .any(|pattern| diffd_core::kinds::matches(pattern, &file.path))
                    })
                    .map(|file| file.path.clone())
                    .collect();
            }
            if let Some(graph) = &mut review.graph {
                for node in &mut graph.nodes {
                    node.files = revision
                        .files
                        .iter()
                        .filter(|file| {
                            file.path == node.location.path
                                || node
                                    .files
                                    .iter()
                                    .any(|pattern| diffd_core::kinds::matches(pattern, &file.path))
                        })
                        .map(|file| file.path.clone())
                        .collect();
                }
            }
        }
        Ok(Some(review))
    }

    async fn file(&self, access: ReviewAccess, revision: u32, path: &str) -> Result<ReviewFile> {
        let (session, _) = self.authorize(access, false, false).await?;
        let review = self
            .repo
            .load(session.id)
            .await?
            .ok_or(ReviewError::NotFound)?;
        self.body_at(
            &review,
            revision,
            &Location {
                path: path.into(),
                side: diffd_core::model::Side::New,
                line: 1,
                end_line: None,
            },
        )
        .await
    }

    async fn capture(
        &self,
        access: ReviewAccess,
        comparison: Comparison,
        presentation: Presentation,
    ) -> Result<ReviewLink> {
        let (session, _) = self.authorize(access, true, false).await?;
        let claim = Uuid::now_v7();
        if !self.repo.claim_capture(session.id, claim).await? {
            return Err(ReviewError::Conflict);
        }
        let lease = capture::CaptureLease::new(self.repo.clone(), session.id, claim);
        let result = self
            .capture_leased(&session, comparison, presentation, claim)
            .await;
        lease.release().await;
        result
    }

    async fn annotate(
        &self,
        access: ReviewAccess,
        revision: u32,
        presentation: Presentation,
    ) -> Result<ReviewLink> {
        let (session, _) = self.authorize(access, true, true).await?;
        for _ in 0..WRITE_RETRIES {
            let mut review = self
                .repo
                .load(session.id)
                .await?
                .ok_or(ReviewError::NotFound)?;
            if review.revisions.last().map(|r| r.number) != Some(revision) {
                return Err(ReviewError::Conflict);
            }
            self.validate_presentation(&review, &presentation).await?;
            let version = review.version;
            apply_presentation(&mut review, &presentation);
            if self.store(&mut review, Some(version)).await? {
                self.notify(&review).await;
                return Ok(self.url(&review, revision, None, None));
            }
        }
        Err(ReviewError::Conflict)
    }

    async fn link(
        &self,
        access: ReviewAccess,
        revision: u32,
        location: Location,
    ) -> Result<ReviewLink> {
        let (session, _) = self.authorize(access, false, false).await?;
        for _ in 0..WRITE_RETRIES {
            let mut review = self
                .repo
                .load(session.id)
                .await?
                .ok_or(ReviewError::NotFound)?;
            if let Some(anchor) = review
                .anchors
                .iter()
                .find(|a| a.revision == revision && a.original == location)
            {
                return Ok(self.url(&review, revision, Some(anchor.id), None));
            }
            let anchor = self.anchor(&review, revision, location.clone()).await?;
            let id = anchor.id;
            let version = review.version;
            review.anchors.push(anchor);
            if self.store(&mut review, Some(version)).await? {
                return Ok(self.url(&review, revision, Some(id), None));
            }
        }
        Err(ReviewError::Conflict)
    }

    async fn comment(&self, access: ReviewAccess, comment: Comment) -> Result<ReviewLink> {
        let (session, author) = self.authorize(access, true, false).await?;
        if matches!(author, Author::Agent) {
            return Err(ReviewError::Forbidden);
        }
        validate_text(&comment.body, MAX_MESSAGE_BYTES)?;
        for _ in 0..WRITE_RETRIES {
            let mut review = self
                .repo
                .load(session.id)
                .await?
                .ok_or(ReviewError::NotFound)?;
            if let Some(thread) = review
                .threads
                .iter()
                .find(|t| t.messages.iter().any(|m| m.id == comment.id))
            {
                let previous = thread
                    .messages
                    .iter()
                    .find(|m| m.id == comment.id)
                    .ok_or(ReviewError::NotFound)?;
                let anchor = review
                    .anchors
                    .iter()
                    .find(|a| a.id == thread.anchor)
                    .ok_or(ReviewError::NotFound)?;
                if previous.author != author
                    || previous.body != comment.body
                    || comment.thread.is_some_and(|id| id != thread.id)
                    || (comment.thread.is_none()
                        && (anchor.revision != comment.revision
                            || comment.location.as_ref() != Some(&anchor.original)))
                {
                    return Err(ReviewError::Conflict);
                }
                return Ok(self.url(
                    &review,
                    comment.revision,
                    Some(thread.anchor),
                    Some(thread.id),
                ));
            }
            if !review
                .revisions
                .iter()
                .any(|r| r.number == comment.revision)
            {
                return Err(ReviewError::NotFound);
            }
            let version = review.version;
            let thread_id = match comment.thread {
                Some(id) => id,
                None => {
                    let at = comment.location.clone().ok_or_else(|| {
                        ReviewError::Invalid("Select code for a new thread".into())
                    })?;
                    let anchor = self.anchor(&review, comment.revision, at).await?;
                    let id = Uuid::now_v7();
                    review.threads.push(Thread {
                        id,
                        anchor: anchor.id,
                        resolved: false,
                        messages: vec![],
                    });
                    review.anchors.push(anchor);
                    id
                }
            };
            let thread = review
                .threads
                .iter_mut()
                .find(|t| t.id == thread_id)
                .ok_or(ReviewError::NotFound)?;
            let anchor = thread.anchor;
            thread.messages.push(Message {
                id: comment.id,
                author: author.clone(),
                body: comment.body.clone(),
                created_at: Utc::now(),
                delivery: Some(Delivery::Pending),
            });
            if self.store(&mut review, Some(version)).await? {
                self.notify(&review).await;
                return Ok(self.url(&review, comment.revision, Some(anchor), Some(thread_id)));
            }
        }
        Err(ReviewError::Conflict)
    }

    async fn reply(
        &self,
        access: ReviewAccess,
        thread_id: Uuid,
        id: Uuid,
        body: String,
    ) -> Result<ReviewLink> {
        let (session, _) = self.authorize(access, true, true).await?;
        validate_text(&body, MAX_MESSAGE_BYTES)?;
        for _ in 0..WRITE_RETRIES {
            let mut review = self
                .repo
                .load(session.id)
                .await?
                .ok_or(ReviewError::NotFound)?;
            let version = review.version;
            let revision = review.revisions.last().ok_or(ReviewError::NotFound)?.number;
            if review
                .threads
                .iter()
                .filter(|t| t.id != thread_id)
                .any(|t| t.messages.iter().any(|m| m.id == id))
            {
                return Err(ReviewError::Conflict);
            }
            let thread = review
                .threads
                .iter_mut()
                .find(|t| t.id == thread_id)
                .ok_or(ReviewError::NotFound)?;
            let anchor = thread.anchor;
            if let Some(message) = thread.messages.iter().find(|m| m.id == id) {
                if message.author != Author::Agent || message.body != body {
                    return Err(ReviewError::Conflict);
                }
                return Ok(self.url(&review, revision, Some(anchor), Some(thread_id)));
            }
            thread.messages.push(Message {
                id,
                author: Author::Agent,
                body: body.clone(),
                created_at: Utc::now(),
                delivery: None,
            });
            if self.store(&mut review, Some(version)).await? {
                self.notify(&review).await;
                return Ok(self.url(&review, revision, Some(anchor), Some(thread_id)));
            }
        }
        Err(ReviewError::Conflict)
    }

    async fn resolve(&self, access: ReviewAccess, thread_id: Uuid, resolved: bool) -> Result<()> {
        let (session, author) = self.authorize(access, true, false).await?;
        if matches!(author, Author::Agent) {
            return Err(ReviewError::Forbidden);
        }
        for _ in 0..WRITE_RETRIES {
            let mut review = self
                .repo
                .load(session.id)
                .await?
                .ok_or(ReviewError::NotFound)?;
            let version = review.version;
            review
                .threads
                .iter_mut()
                .find(|t| t.id == thread_id)
                .ok_or(ReviewError::NotFound)?
                .resolved = resolved;
            if self.store(&mut review, Some(version)).await? {
                self.notify(&review).await;
                return Ok(());
            }
        }
        Err(ReviewError::Conflict)
    }

    async fn deliver_pending(&self) -> Result<()> {
        for session in self.repo.cleanup_sessions().await? {
            match self.bodies.delete_session(session).await {
                Ok(()) => {
                    self.repo.finish_cleanup(session).await?;
                }
                Err(error) => {
                    tracing::warn!(?error, %session, "review body cleanup will retry");
                }
            }
        }
        for session in self.repo.pending_feedback().await? {
            let Some(review) = self.repo.load(session).await? else {
                continue;
            };
            for thread in &review.threads {
                for message in &thread.messages {
                    if !matches!(message.delivery, Some(Delivery::Pending | Delivery::Queued))
                        || (Utc::now() - message.created_at).num_milliseconds() < 1500
                    {
                        continue;
                    }
                    let Author::User { id: user } = &message.author else {
                        continue;
                    };
                    if !self.repo.claim_feedback(session, message.id).await? {
                        continue;
                    }
                    if self
                        .sessions
                        .action_completed(
                            session,
                            agent_runtime_protocol::domain::action::AgentActionId::from_uuid(
                                message.id,
                            ),
                        )
                        .await
                        .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?
                    {
                        if message.delivery != Some(Delivery::Queued) {
                            self.mark_delivered(session, message.id).await?;
                        }
                        self.repo.finish_feedback(session, message.id, true).await?;
                        continue;
                    }
                    let anchor = review
                        .anchors
                        .iter()
                        .find(|a| a.id == thread.anchor)
                        .ok_or(ReviewError::NotFound)?;
                    let link = self.url(
                        &review,
                        review.revisions.last().ok_or(ReviewError::NotFound)?.number,
                        Some(anchor.id),
                        Some(thread.id),
                    );
                    let prompt = format!(
                        "Review feedback from {user}\n{}\nThread ID: {}\n{}:{} ({:?})\n\n{}\n\nOriginal code:\n```\n{}\n```\n\nReply in this thread with macro_internal.diff_reply. Use macro_internal.diff after editing, and cite returned diff links in your explanation.",
                        link.url,
                        thread.id,
                        anchor.current.path,
                        anchor.current.line,
                        anchor.current.side,
                        message.body,
                        anchor.excerpt.join("\n")
                    );
                    let delivered =
                        match self.feedback.send(session, user, message.id, prompt).await {
                            Ok(()) => true,
                            Err(error) => {
                                tracing::warn!(?error, %session, "review feedback dispatch failed");
                                false
                            }
                        };
                    if delivered && message.delivery != Some(Delivery::Queued) {
                        self.mark_delivered(session, message.id).await?;
                    }
                    // Admission is not a runtime acknowledgement. Retain the outbox
                    // until a correlated ACP response is durable, so a restart between
                    // queue dispatch and the socket write can replay the same action ID.
                    self.repo
                        .finish_feedback(session, message.id, false)
                        .await?;
                }
            }
        }
        Ok(())
    }
}

impl<S: AgentSessionRepo> ReviewService<S> {
    async fn mark_delivered(&self, session: AgentSessionId, id: Uuid) -> Result<()> {
        for _ in 0..WRITE_RETRIES {
            let Some(mut review) = self.repo.load(session).await? else {
                return Ok(());
            };
            let version = review.version;
            if let Some(message) = review
                .threads
                .iter_mut()
                .flat_map(|t| &mut t.messages)
                .find(|m| m.id == id)
            {
                message.delivery = Some(Delivery::Queued);
            }
            if self.store(&mut review, Some(version)).await? {
                self.notify(&review).await;
                return Ok(());
            }
        }
        Err(ReviewError::Conflict)
    }
}
