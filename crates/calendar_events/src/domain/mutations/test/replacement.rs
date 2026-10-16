use super::*;
use crate::domain::models::CalendarProvider;
use crate::domain::replacement::*;
use rootcause::Report;
use serde_json::{Value, json};

impl CalendarReplacementRepository for FakeRepo {
    async fn claim_pending_replacements(&self, _: i64) -> Result<Vec<(String, Uuid)>, Report> {
        Ok(self
            .replacements
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.result.is_none() && (r.next_step > 0 || r.command.is_some()))
            .map(|r| (r.user_id.clone(), r.id))
            .collect())
    }
    async fn active_replacement(
        &self,
        user: &str,
        calendar: Uuid,
        master: &str,
    ) -> Result<Option<CalendarReplacement>, Report> {
        Ok(self
            .replacements
            .lock()
            .unwrap()
            .iter()
            .find(|r| {
                r.user_id == user
                    && r.calendar_id == calendar
                    && r.master_id == master
                    && r.result.is_none()
            })
            .cloned())
    }
    async fn prepare_replacement(
        &self,
        operation: CalendarReplacement,
    ) -> Result<CalendarReplacement, Report> {
        self.replacements.lock().unwrap().push(operation.clone());
        Ok(operation)
    }
    async fn replacement(
        &self,
        user: &str,
        id: Uuid,
    ) -> Result<Option<CalendarReplacement>, Report> {
        Ok(self
            .replacements
            .lock()
            .unwrap()
            .iter()
            .find(|r| r.id == id && r.user_id == user)
            .cloned())
    }
    async fn start_replacement_step(
        &self,
        id: Uuid,
        step: i32,
        command: &Value,
    ) -> Result<bool, Report> {
        let mut rows = self.replacements.lock().unwrap();
        let Some(r) = rows.iter_mut().find(|r| {
            r.id == id && r.next_step == step && r.command.is_none() && r.result.is_none()
        }) else {
            return Ok(false);
        };
        r.command = Some(command.clone());
        Ok(true)
    }
    async fn reject_replacement_create(&self, id: Uuid) -> Result<(), Report> {
        let mut rows = self.replacements.lock().unwrap();
        let r = rows.iter_mut().find(|r| r.id == id).unwrap();
        if r.next_step == 0 {
            r.command = None;
        }
        Ok(())
    }
    async fn finish_replacement_step(
        &self,
        id: Uuid,
        step: i32,
        created: Option<&str>,
    ) -> Result<bool, Report> {
        let mut rows = self.replacements.lock().unwrap();
        let Some(r) = rows
            .iter_mut()
            .find(|r| r.id == id && r.next_step == step && r.command.is_some())
        else {
            return Ok(false);
        };
        r.next_step += 1;
        r.command = None;
        if let Some(id) = created {
            r.replacement_provider_id = Some(id.into())
        }
        Ok(true)
    }
    async fn complete_replacement(&self, id: Uuid, event: &CalendarEvent) -> Result<(), Report> {
        self.replacements
            .lock()
            .unwrap()
            .iter_mut()
            .find(|r| r.id == id)
            .unwrap()
            .result = Some(event.clone());
        Ok(())
    }
    async fn discard_replacement(&self, user: &str, id: Uuid) -> Result<bool, Report> {
        let mut rows = self.replacements.lock().unwrap();
        let len = rows.len();
        rows.retain(|r| {
            !(r.id == id && r.user_id == user && r.next_step == 0 && r.command.is_none())
        });
        Ok(rows.len() != len)
    }
}
impl CalendarReplacementProvider for FakeProvider {
    async fn inspect_replacement(
        &self,
        _: &str,
        _: &ProviderCalendarTarget,
        _: &str,
        _: Option<&str>,
        remove: bool,
    ) -> Result<ReplacementSnapshot, CalendarProviderError> {
        self.calls.lock().unwrap().push("inspect".into());
        Ok(ReplacementSnapshot {
            source_id: "original".into(),
            is_organizer: !matches!(self.behavior, FakeProviderBehavior::NotAttendee),
            title: "Reviewed".into(),
            time: timed_time(),
            attendee_count: 2,
            is_series: false,
            remove_conference: remove,
            provider_url: None,
            payload: json!({}),
            occurrences: vec![],
        })
    }
    async fn event_url(
        &self,
        _: &str,
        _: &ProviderCalendarTarget,
        _: &str,
        _: Option<&str>,
    ) -> Result<Option<String>, CalendarProviderError> {
        Ok(None)
    }
    async fn prepare_replacement_write(
        &self,
        _: &str,
        _: &ProviderCalendarTarget,
        op: &CalendarReplacement,
    ) -> Result<Value, CalendarProviderError> {
        Ok(json!({"step":op.next_step}))
    }
    async fn apply_replacement_write(
        &self,
        _: &str,
        _: &ProviderCalendarTarget,
        command: &Value,
        allow: bool,
    ) -> Result<ReplacementWriteOutcome, CalendarProviderError> {
        if command["step"] == 0 {
            if allow {
                self.calls.lock().unwrap().push("replacement-create".into());
                if let Some(err) = self.fail() {
                    return Err(err);
                }
            } else {
                self.calls.lock().unwrap().push("replacement-read".into());
                if matches!(self.behavior, FakeProviderBehavior::Gone) {
                    return Ok(ReplacementWriteOutcome::Unconfirmed);
                }
            }
            return Ok(ReplacementWriteOutcome::Applied(Some("new".into())));
        }
        self.calls.lock().unwrap().push("replacement-cancel".into());
        Ok(ReplacementWriteOutcome::Applied(None))
    }
    async fn replacement_echo(
        &self,
        _: &str,
        target: &ProviderCalendarTarget,
        _: &str,
    ) -> Result<Option<CalendarEventUpsert>, CalendarProviderError> {
        Ok(Some(self.echo(&target.owner_id)))
    }
}
fn fixture(behavior: FakeProviderBehavior) -> (TestMutationService, FakeRepo, FakeProvider, Uuid) {
    let mut mutation = mutation_target(false);
    mutation.token_identity.provider = CalendarProvider::Outlook;
    let mut creation = creation_target(false);
    creation.calendar_id = mutation.calendar_id;
    creation.token_identity.provider = CalendarProvider::Outlook;
    let event = mutation.event_id;
    let repo = FakeRepo {
        mutation_target: Some(mutation),
        creation_target: Some(creation),
        ..Default::default()
    };
    let provider = FakeProvider::new(behavior);
    (
        service(repo.clone(), provider.clone(), FakeTokens::ok()),
        repo,
        provider,
        event,
    )
}
#[tokio::test]
async fn preview_is_read_only_and_confirmation_replays_after_old_event_retirement() {
    let (service, repo, provider, event) = fixture(FakeProviderBehavior::Echo);
    let preview = service
        .prepare_replacement("owner", event, None, None, true)
        .await
        .unwrap();
    assert_eq!(preview.status, ReplacementStatus::NeedsConfirmation);
    assert_eq!(*provider.calls.lock().unwrap(), vec!["inspect"]);
    assert_eq!(service.recover_replacements().await.unwrap(), 0);
    let result = service
        .confirm_replacement("owner", preview.operation_id)
        .await
        .unwrap();
    assert_eq!(result.status, ReplacementStatus::Complete);
    assert_eq!(repo.removed_sources.lock().unwrap().len(), 1);
    let repeated = service
        .confirm_replacement("owner", preview.operation_id)
        .await
        .unwrap();
    assert_eq!(repeated.event.unwrap().id, result.event.unwrap().id);
    assert_eq!(
        provider
            .calls
            .lock()
            .unwrap()
            .iter()
            .filter(|c| *c == "replacement-create")
            .count(),
        1
    );
}
#[tokio::test]
async fn dropped_creation_response_is_read_back_by_background_recovery_without_resending() {
    let (service, repo, provider, event) = fixture(FakeProviderBehavior::Fail(
        CalendarProviderErrorKind::Transient,
    ));
    let preview = service
        .prepare_replacement("owner", event, None, None, true)
        .await
        .unwrap();
    assert!(
        service
            .confirm_replacement("owner", preview.operation_id)
            .await
            .is_err()
    );
    assert!(repo.removed_sources.lock().unwrap().is_empty());
    assert!(
        service
            .discard_replacement("owner", preview.operation_id)
            .await
            .is_err()
    );
    assert_eq!(service.recover_replacements().await.unwrap(), 1);
    assert_eq!(
        service
            .replacement_status("owner", preview.operation_id)
            .await
            .unwrap()
            .status,
        ReplacementStatus::Complete
    );
    assert_eq!(
        provider
            .calls
            .lock()
            .unwrap()
            .iter()
            .filter(|c| *c == "replacement-create")
            .count(),
        1
    );
}
#[tokio::test]
async fn unconfirmed_creation_never_releases_the_original_or_sends_again() {
    let (service, repo, provider, event) = fixture(FakeProviderBehavior::Gone);
    let preview = service
        .prepare_replacement("owner", event, None, None, true)
        .await
        .unwrap();
    repo.start_replacement_step(preview.operation_id, 0, &json!({"step":0}))
        .await
        .unwrap();
    for _ in 0..3 {
        assert_eq!(
            service
                .confirm_replacement("owner", preview.operation_id)
                .await
                .unwrap()
                .status,
            ReplacementStatus::InProgress
        );
    }
    assert!(repo.removed_sources.lock().unwrap().is_empty());
    assert!(
        !provider
            .calls
            .lock()
            .unwrap()
            .iter()
            .any(|c| c == "replacement-create" || c == "replacement-cancel")
    );
}
#[tokio::test]
async fn replacement_denies_nonorganizers_other_actors_and_revoked_calendar_access() {
    let (service, _, provider, event) = fixture(FakeProviderBehavior::NotAttendee);
    assert!(
        service
            .prepare_replacement("owner", event, None, None, true)
            .await
            .is_err()
    );
    assert_eq!(*provider.calls.lock().unwrap(), vec!["inspect"]);
    let (service, mut repo, provider, event) = fixture(FakeProviderBehavior::Echo);
    let preview = service
        .prepare_replacement("owner", event, None, None, true)
        .await
        .unwrap();
    assert!(matches!(
        service
            .confirm_replacement("intruder", preview.operation_id)
            .await,
        Err(CalendarMutationError::NotFound)
    ));
    repo.creation_target = None;
    let revoked = super::service(repo, provider.clone(), FakeTokens::ok());
    assert!(matches!(
        revoked
            .confirm_replacement("owner", preview.operation_id)
            .await,
        Err(CalendarMutationError::NotFound)
    ));
    assert_eq!(*provider.calls.lock().unwrap(), vec!["inspect"]);
}
#[tokio::test]
async fn paused_writes_and_read_only_calendars_reject_before_provider_calls() {
    let (service, mut repo, provider, event) = fixture(FakeProviderBehavior::Echo);
    assert!(
        service
            .with_outlook_writes_enabled(false)
            .prepare_replacement("owner", event, None, None, true)
            .await
            .is_err()
    );
    repo.mutation_target.as_mut().unwrap().is_read_only = true;
    assert!(
        super::service(repo, provider.clone(), FakeTokens::ok())
            .prepare_replacement("owner", event, None, None, true)
            .await
            .is_err()
    );
    assert!(provider.calls.lock().unwrap().is_empty());
}
