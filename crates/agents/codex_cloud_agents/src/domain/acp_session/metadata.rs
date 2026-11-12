//! Metadata refresh consumes provider facts without replaying assistant output.
use super::*;
use crate::domain::cloud::ExternalPullRequest;

fn repository(url: &str) -> Option<String> {
    let path = url.strip_prefix("https://github.com/")?;
    let mut parts = path.split('/');
    let owner = parts.next()?;
    let repo = parts.next()?;
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some(format!("{owner}/{repo}").to_ascii_lowercase())
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct Selected {
    turn: String,
    url: String,
}
fn select(
    accepted: &[String],
    target: &CloudTarget,
    prs: &[ExternalPullRequest],
) -> Option<Selected> {
    let repo = repository(target.repository_url.as_deref()?)?;
    accepted.iter().rev().find_map(|turn| {
        prs.iter()
            .rev()
            .find(|pr| {
                pr.assistant_turn_id.as_str() == turn
                    && repository(&pr.url).as_deref() == Some(repo.as_str())
            })
            .map(|pr| Selected {
                turn: turn.clone(),
                url: pr.url.clone(),
            })
    })
}

/// A provider association is an observed link, not evidence that our adapter created a PR.
pub(super) fn pull_request_event(
    machine: &ReplayMachine,
    state: &StoredSession,
    turn: &str,
) -> Option<CloudEvent> {
    let task = state.task.as_deref()?;
    let target = state.target.as_ref()?;
    if !machine
        .accepted(task)
        .iter()
        .any(|accepted| accepted == turn)
    {
        return None;
    }
    let selected = select(&[turn.to_owned()], target, &machine.pull_requests(task))?;
    Some(CloudEvent {
        id: format!("codex-pr:{}:{}", selected.turn, selected.url),
        method: "adapter/pull_request".into(),
        params: serde_json::json!({
            "url": selected.url,
            "assistantTurnId": selected.turn,
            "source": "codex_cloud_metadata",
        }),
    })
}
impl<R: CloudRuntime, J: SessionStore> SessionService<R, J> {
    /// Wait for a newly attached session or foreground metadata observation.
    pub async fn metadata_changed(&self) {
        self.metadata_changed.notified().await;
    }
    /// Refresh attached sessions' task metadata without launching work or replaying history.
    /// Fence and identity checks precede provider reads; the attachment retries failures with backoff.
    pub async fn refresh_metadata(&self) -> Result<Vec<String>, rootcause::Report> {
        let mut changed = Vec::new();
        let sessions: Vec<_> = self
            .sessions
            .lock()
            .await
            .iter()
            .map(|(id, session)| (id.clone(), session.clone()))
            .collect();
        if sessions.is_empty() {
            return Ok(changed);
        }
        self.journal.validate().await?;
        for (id, session) in sessions {
            self.session(&id).await?;
            let Ok(_guard) = session.metadata_lock.try_lock() else {
                continue;
            };
            let state = session.state.lock().await.clone();
            let (Some(task), Some(target)) = (state.task, state.target) else {
                continue;
            };
            let task = CloudId::new(task)?;
            let (accepted, known, sequence) = {
                let machine = session.machine.lock().await;
                (
                    machine.accepted(task.as_str()),
                    machine.pull_requests(task.as_str()),
                    machine.sequence(),
                )
            };
            let prior = select(&accepted, &target, &known);
            let read_error = match self.probe.snapshot(&task).await {
                Ok(mut snapshot) => {
                    if session.machine.lock().await.sequence() != sequence {
                        continue;
                    }
                    if snapshot.task_id != task {
                        eprintln!("codex_acp: PR metadata returned a different task");
                        continue;
                    }
                    let mut candidates = known;
                    candidates.extend(snapshot.pull_requests.iter().rev().cloned());
                    if select(&accepted, &target, &candidates) != prior {
                        let native = snapshot.native.take();
                        // Record before host publication; unchanged evidence needs no new row.
                        self.record_metadata_if_current(
                            &id,
                            &session,
                            sequence,
                            JournalInput::Metadata { snapshot, native },
                        )
                        .await?;
                    }
                    None
                }
                Err(error) => Some(error),
            };
            if self.publish_recorded_pr(&session).await? {
                changed.push(id);
            }
            if let Some(error) = read_error {
                return Err(error);
            }
        }
        Ok(changed)
    }
    async fn record_metadata_if_current(
        &self,
        id: &str,
        session: &Session,
        expected: i64,
        input: JournalInput,
    ) -> Result<bool, rootcause::Report> {
        let turn = session
            .state
            .lock()
            .await
            .turn
            .clone()
            .map(TurnId::new)
            .transpose()?;
        let mut machine = session.machine.lock().await;
        if machine.sequence() != expected {
            return Ok(false);
        }
        machine.ensure_appendable(&input)?;
        let entry = self
            .journal
            .append(id, expected, turn.as_ref(), &input)
            .await?;
        machine.push(&entry)?;
        Ok(true)
    }
    async fn publish_recorded_pr(&self, session: &Session) -> Result<bool, rootcause::Report> {
        let state = session.state.lock().await.clone();
        let (Some(task), Some(target)) = (state.task, state.target) else {
            return Ok(false);
        };
        let selected = {
            let machine = session.machine.lock().await;
            select(
                &machine.accepted(&task),
                &target,
                &machine.pull_requests(&task),
            )
        };
        let Some(Selected { url, .. }) = selected else {
            return Ok(false);
        };
        let mut published = session.published_pr.lock().await;
        if published.as_ref() == Some(&url) {
            return Ok(false);
        }
        self.journal.validate().await?;
        self.probe.report_pull_request(&url).await?;
        *published = Some(url);
        Ok(true)
    }
}
