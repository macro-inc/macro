//! Immutable publication and cancellation-safe capture ownership.

use super::*;
use sha2::{Digest, Sha256};

pub(super) struct CaptureLease {
    repo: Option<Arc<dyn ReviewRepo>>,
    session: AgentSessionId,
    claim: Uuid,
}

impl CaptureLease {
    pub(super) fn new(repo: Arc<dyn ReviewRepo>, session: AgentSessionId, claim: Uuid) -> Self {
        Self {
            repo: Some(repo),
            session,
            claim,
        }
    }

    pub(super) async fn release(mut self) {
        // Retain ownership until the await completes, including when the caller
        // disconnects during release. The fenced delete is idempotent.
        if let Some(repo) = &self.repo
            && let Err(error) = repo.release_capture(self.session, self.claim).await
        {
            tracing::warn!(?error, "failed to release review capture lease");
            return;
        }
        self.repo = None;
    }
}

impl Drop for CaptureLease {
    fn drop(&mut self) {
        if let Some(repo) = self.repo.take() {
            let (session, claim) = (self.session, self.claim);
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                runtime.spawn(async move {
                    if let Err(error) = repo.release_capture(session, claim).await {
                        tracing::warn!(
                            ?error,
                            "failed to release interrupted review capture lease"
                        );
                    }
                });
            }
            // If the process/runtime has stopped, the durable lease expires.
        }
    }
}

impl<S: AgentSessionRepo> ReviewService<S> {
    async fn relocate_presentation(&self, review: &mut Review, files: &[ReviewFile]) -> Result<()> {
        let Some(revision) = review.revisions.last().map(|r| r.number) else {
            return Ok(());
        };
        let mut tour = Vec::new();
        for mut chapter in review.tour.clone() {
            let body = self.body_at(review, revision, &chapter.focus).await?;
            let mut anchor = anchors::create(revision, chapter.focus.clone(), &body)?;
            anchors::follow(&mut anchor, files);
            if anchor.status == AnchorStatus::Outdated {
                continue;
            }
            chapter.focus = anchor.current;
            chapter.paths = chapter
                .paths
                .into_iter()
                .filter_map(|path| {
                    files
                        .iter()
                        .find(|f| f.path == path || f.old_path.as_ref() == Some(&path))
                        .map(|f| f.path.clone())
                })
                .collect();
            tour.push(chapter);
        }
        let mut annotations = Vec::new();
        for mut note in review.annotations.clone() {
            let body = self.body_at(review, revision, &note.location).await?;
            let mut anchor = anchors::create(revision, note.location.clone(), &body)?;
            anchors::follow(&mut anchor, files);
            if anchor.status == AnchorStatus::Outdated {
                continue;
            }
            note.location = anchor.current;
            annotations.push(note);
        }
        self.relocate_graph(review, revision, files).await?;
        review.tour = tour;
        review.annotations = annotations;
        Ok(())
    }

    pub(super) async fn capture_leased(
        &self,
        session: &AgentSession,
        mut comparison: Comparison,
        presentation: Presentation,
        claim: Uuid,
    ) -> Result<ReviewLink> {
        let existing = self.repo.load(session.id).await?;
        // Keep the original base across commits and repeated MCP calls.
        if comparison.head.is_none()
            && !comparison.worktree
            && existing
                .as_ref()
                .is_some_and(|r| r.source == SourceKind::Workspace)
        {
            comparison.head = existing
                .as_ref()
                .and_then(|r| r.revisions.last())
                .and_then(|r| r.comparison.head.clone());
        }
        if comparison.base.is_none() {
            comparison.base = existing
                .as_ref()
                .and_then(|r| r.revisions.last())
                .and_then(|r| r.comparison.base.clone());
        }
        let capture = tokio::time::timeout(
            std::time::Duration::from_secs(150),
            self.source.capture(session, &comparison),
        )
        .await
        .map_err(|_| {
            ReviewError::Unavailable("Diff capture timed out; try a smaller comparison".into())
        })??;
        if capture.snapshot.files.len() > MAX_FILES {
            return Err(ReviewError::Invalid(
                "The comparison contains more than 10,000 files".into(),
            ));
        }
        let known: std::collections::HashSet<_> = existing
            .as_ref()
            .into_iter()
            .flat_map(|r| &r.revisions)
            .flat_map(|r| &r.files)
            .map(|f| f.content.as_str())
            .collect();
        use futures::{StreamExt, TryStreamExt};
        let writes = capture
            .snapshot
            .files
            .iter()
            .map(|file| {
                let known = &known;
                async move {
                    let bytes = serde_json::to_vec(file)
                        .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
                    let content = format!("{:x}", Sha256::digest(&bytes));
                    if !known.contains(content.as_str()) {
                        self.bodies.put(session.id, &content, file).await?;
                    }
                    Ok::<_, ReviewError>(FileEntry {
                        path: file.path.clone(),
                        old_path: file.old_path.clone(),
                        content,
                        status: file.status,
                        language: file.language.clone(),
                        added: file.added,
                        removed: file.removed,
                        collapsed: file.collapsed.clone(),
                        labels: file.labels.clone(),
                        omitted: file.omitted,
                    })
                }
            })
            .collect::<Vec<_>>();
        let files = tokio::time::timeout(
            std::time::Duration::from_secs(60),
            futures::stream::iter(writes)
                .buffered(8)
                .try_collect::<Vec<_>>(),
        )
        .await
        .map_err(|_| {
            ReviewError::Unavailable("Storing this review took too long; retry the capture".into())
        })??;
        for _ in 0..WRITE_RETRIES {
            let existing = self.repo.load(session.id).await?;
            let previous = existing.as_ref().map(|r| r.version);
            let mut review = existing.unwrap_or_else(|| Review {
                id: ReviewId(Uuid::now_v7()),
                session_id: session.id.as_uuid(),
                version: 0,
                title: session.name.clone(),
                summary: String::new(),
                repository: capture.repository.clone(),
                source: capture.source,
                revisions: vec![],
                tour: vec![],
                annotations: vec![],
                file_groups: vec![],
                graph: None,
                anchors: vec![],
                threads: vec![],
            });
            let unchanged = review.revisions.last().is_some_and(|r| {
                r.comparison == capture.comparison
                    && r.files.len() == files.len()
                    && r.files
                        .iter()
                        .zip(&files)
                        .all(|(a, b)| a.path == b.path && a.content == b.content)
            });
            if !unchanged {
                let number = review.revisions.last().map_or(1, |r| r.number + 1);
                self.relocate_presentation(&mut review, &capture.snapshot.files)
                    .await?;
                review.revisions.push(Revision {
                    tour: review.tour.clone(),
                    annotations: review.annotations.clone(),
                    file_groups: review.file_groups.clone(),
                    graph: review.graph.clone(),
                    number,
                    created_at: Utc::now(),
                    comparison: capture.comparison.clone(),
                    files: files.clone(),
                    symbols: capture.snapshot.symbols.clone(),
                });
                for anchor in &mut review.anchors {
                    anchors::follow(anchor, &capture.snapshot.files);
                }
                review.source = capture.source;
                review.repository.clone_from(&capture.repository);
            }
            self.validate_presentation(&review, &presentation).await?;
            apply_presentation(&mut review, &presentation);
            if unchanged
                && presentation.title.is_none()
                && presentation.summary.is_none()
                && presentation.tour.is_none()
                && presentation.annotations.is_none()
                && presentation.file_groups.is_none()
                && presentation.graph.is_none()
            {
                return Ok(self.url(
                    &review,
                    review.revisions.last().ok_or(ReviewError::NotFound)?.number,
                    None,
                    None,
                ));
            }
            review.version = previous.unwrap_or(0) + 1;
            if self.repo.save(&review, previous, Some(claim)).await? {
                self.notify(&review).await;
                return Ok(self.url(
                    &review,
                    review.revisions.last().ok_or(ReviewError::NotFound)?.number,
                    None,
                    None,
                ));
            }
        }
        Err(ReviewError::Conflict)
    }
}
