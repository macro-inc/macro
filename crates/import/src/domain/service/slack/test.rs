use super::*;
use crate::domain::{
    models::{
        ImportSource, ImportSourceBinding, ImportStatus, ImportTargetReservation, Initiator,
        SlackWorkspaceId,
    },
    ports::{ImportError, ImportedDocumentProperties, ImportedTaskProperties, Result},
};
use std::{collections::HashSet, sync::Mutex};

#[derive(Default)]
struct State {
    target: Option<ImportTargetReservation>,
    channels: HashSet<Uuid>,
    live_creations: usize,
    creator_calls: usize,
    participant_emails: Vec<String>,
    fail_before_creation: bool,
    fail_after_creation: bool,
    fail_completion: bool,
    wrong_result: bool,
}

#[derive(Default)]
struct Harness(Mutex<State>);

impl CanonicalImportRepo for Harness {
    async fn source_binding(&self, _: Uuid) -> Result<Option<ImportSourceBinding>> {
        unreachable!("onboarding does not confirm unknown archive identities")
    }

    async fn bind_source(
        &self,
        _: Uuid,
        _: Option<&SlackWorkspaceId>,
        _: bool,
    ) -> Result<ImportSourceBinding> {
        unreachable!("onboarding does not confirm unknown archive identities")
    }

    async fn reserve_target(
        &self,
        _: &MacroUserIdStr<'static>,
        key: &ImportTargetKey,
        kind: ImportTargetKind,
        existing: Option<Uuid>,
    ) -> Result<ImportTargetReservation> {
        assert_eq!(kind, ImportTargetKind::Team);
        assert_eq!(existing, None);
        let target = {
            let mut state = self.0.lock().unwrap();
            state
                .target
                .get_or_insert_with(|| ImportTargetReservation {
                    key: key.clone(),
                    channel_id: Uuid::now_v7(),
                    ready: false,
                })
                .clone()
        };
        assert_eq!(&target.key, key);
        tokio::task::yield_now().await;
        Ok(target)
    }

    async fn complete_target(
        &self,
        key: &ImportTargetKey,
        channel_id: Uuid,
        kind: ImportTargetKind,
    ) -> Result<ImportTargetReservation> {
        assert_eq!(kind, ImportTargetKind::Team);
        let mut state = self.0.lock().unwrap();
        if std::mem::take(&mut state.fail_completion) {
            return Err(ImportError::Other(anyhow::anyhow!(
                "interrupted before completion"
            )));
        }
        if !state.channels.contains(&channel_id) {
            return Err(ImportError::TargetConflict);
        }
        let target = state.target.as_mut().unwrap();
        if &target.key != key || target.channel_id != channel_id {
            return Err(ImportError::TargetConflict);
        }
        target.ready = true;
        Ok(target.clone())
    }
}

impl EntityCreator for Harness {
    async fn create_task(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        _: &str,
        _: &ImportedTaskProperties,
    ) -> anyhow::Result<String> {
        unreachable!()
    }

    async fn create_markdown_doc(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        _: &str,
        _: &ImportedDocumentProperties,
    ) -> anyhow::Result<String> {
        unreachable!()
    }

    async fn create_channel(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        target: &ImportTargetReservation,
        participant_emails: &[String],
    ) -> anyhow::Result<Uuid> {
        tokio::task::yield_now().await;
        let mut state = self.0.lock().unwrap();
        state.creator_calls += 1;
        state.participant_emails = participant_emails.to_vec();
        anyhow::ensure!(
            !std::mem::take(&mut state.fail_before_creation),
            "interrupted after reservation"
        );
        if state.channels.insert(target.channel_id) {
            state.live_creations += 1;
        }
        anyhow::ensure!(
            !std::mem::take(&mut state.fail_after_creation),
            "lost creation response"
        );
        if state.wrong_result {
            return Ok(Uuid::now_v7());
        }
        Ok(target.channel_id)
    }
}

fn fixture() -> (MacroUserIdStr<'static>, ImportEntity, ImportTargetKey) {
    let user = MacroUserIdStr::try_from("macro|onboarder@example.com".to_string()).unwrap();
    let key = ImportTargetKey {
        team_id: Uuid::now_v7(),
        foreign_id: SlackConversationId::new("C0123456789").unwrap(),
    };
    let row = ImportEntity {
        id: Uuid::now_v7(),
        user_id: user.to_string(),
        team_id: None,
        source: ImportSource::Slack,
        foreign_id: key.foreign_id.as_str().to_string(),
        status: ImportStatus::Importing,
        initiator: Initiator::Onboarding,
        metadata: serde_json::json!({"name": "engineering", "channel_id": key.foreign_id.as_str()}),
        entity_id: None,
        entity_type: None,
        last_error: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };
    (user, row, key)
}

impl Harness {
    async fn archive(&self, key: &ImportTargetKey) -> Uuid {
        // A different admin uses the same namespace and silently ensures the
        // target, just as the archive worker does through its channel port.
        let admin = MacroUserIdStr::try_from("macro|archiver@example.com".to_string()).unwrap();
        let target = self
            .reserve_target(&admin, key, ImportTargetKind::Team, None)
            .await
            .unwrap();
        self.0.lock().unwrap().channels.insert(target.channel_id);
        self.complete_target(key, target.channel_id, ImportTargetKind::Team)
            .await
            .unwrap()
            .channel_id
    }

    fn assert_canonical(&self, id: Uuid, live_creations: usize) {
        let state = self.0.lock().unwrap();
        assert_eq!(state.channels, HashSet::from([id]));
        assert_eq!(state.target.as_ref().unwrap().channel_id, id);
        assert!(state.target.as_ref().unwrap().ready);
        assert_eq!(state.live_creations, live_creations);
    }
}

#[tokio::test]
async fn archive_first_onboarding_reuses_without_invites_or_events() {
    let h = Harness::default();
    let (user, row, key) = fixture();
    let archive = h.archive(&key).await;
    assert_eq!(
        ensure_channel(&h, &h, &user, &row, key.team_id, &[])
            .await
            .unwrap(),
        archive
    );
    h.assert_canonical(archive, 0);
    assert_eq!(h.0.lock().unwrap().creator_calls, 0);
}

#[tokio::test]
async fn onboarding_first_archive_reuses_target() {
    let h = Harness::default();
    let (user, row, key) = fixture();
    let onboarding = ensure_channel(&h, &h, &user, &row, key.team_id, &[])
        .await
        .unwrap();
    assert_eq!(h.archive(&key).await, onboarding);
    h.assert_canonical(onboarding, 1);
}

#[tokio::test]
async fn concurrent_onboarding_and_archive_reservations_converge() {
    let h = Harness::default();
    let (user, row, key) = fixture();
    let (onboarding, archive) = tokio::join!(
        ensure_channel(&h, &h, &user, &row, key.team_id, &[]),
        h.archive(&key),
    );
    assert_eq!(onboarding.unwrap(), archive);
    let effects = h.0.lock().unwrap().live_creations;
    assert!(effects <= 1);
    h.assert_canonical(archive, effects);
}

#[tokio::test]
async fn crash_retry_at_each_boundary_keeps_one_channel_and_mapping() {
    for boundary in 0..3 {
        let h = Harness::default();
        let (user, row, key) = fixture();
        {
            let mut state = h.0.lock().unwrap();
            state.fail_before_creation = boundary == 0;
            state.fail_after_creation = boundary == 1;
            state.fail_completion = boundary == 2;
        }
        assert!(
            ensure_channel(&h, &h, &user, &row, key.team_id, &[])
                .await
                .is_err()
        );
        let reserved = h.0.lock().unwrap().target.as_ref().unwrap().channel_id;
        assert_eq!(
            ensure_channel(&h, &h, &user, &row, key.team_id, &[])
                .await
                .unwrap(),
            reserved
        );
        // Also covers a crash after canonical completion but before the legacy
        // importing-row CAS: retry returns the ready target without creating.
        let calls = h.0.lock().unwrap().creator_calls;
        assert_eq!(
            ensure_channel(&h, &h, &user, &row, key.team_id, &[])
                .await
                .unwrap(),
            reserved
        );
        assert_eq!(h.0.lock().unwrap().creator_calls, calls);
        h.assert_canonical(reserved, 1);
    }
}

#[tokio::test]
async fn completion_uses_returned_persisted_id_not_candidate() {
    let h = Harness::default();
    h.0.lock().unwrap().wrong_result = true;
    let (user, row, key) = fixture();
    assert!(
        ensure_channel(&h, &h, &user, &row, key.team_id, &[])
            .await
            .is_err()
    );
    assert!(!h.0.lock().unwrap().target.as_ref().unwrap().ready);
}

#[tokio::test]
async fn creation_uses_supplied_emails_instead_of_staged_participants() {
    let h = Harness::default();
    let (user, mut row, key) = fixture();
    row.metadata["participants"] = serde_json::json!([
        {"name": "Staged", "email": "staged@example.com"}
    ]);
    let emails = vec!["live@example.com".to_string()];
    ensure_channel(&h, &h, &user, &row, key.team_id, &emails)
        .await
        .unwrap();
    assert_eq!(h.0.lock().unwrap().participant_emails, emails);
}

#[tokio::test]
async fn ambiguous_or_missing_source_identity_fails_before_reservation() {
    let h = Harness::default();
    let (user, mut row, key) = fixture();
    row.metadata["channel_id"] = serde_json::json!("COTHER");
    assert!(
        ensure_channel(&h, &h, &user, &row, key.team_id, &[])
            .await
            .is_err()
    );
    row.foreign_id = "#engineering".to_string();
    assert!(
        ensure_channel(&h, &h, &user, &row, key.team_id, &[])
            .await
            .is_err()
    );
    assert!(h.0.lock().unwrap().target.is_none());
}
