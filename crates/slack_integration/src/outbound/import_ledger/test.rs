use super::*;
use import::domain::ports::{ImportError as LedgerError, Result as LedgerResult};
use macro_user_id::cowlike::CowLike;

struct Canonical {
    binding: Option<ledger::ImportSourceBinding>,
    kind: ledger::ImportTargetKind,
    conflict: bool,
}

fn team() -> TeamId {
    Uuid::from_u128(1).try_into().unwrap()
}
fn target() -> Uuid {
    Uuid::from_u128(2)
}
fn metadata(kind: ConversationKind) -> ConversationMetadata {
    ConversationMetadata {
        slack_channel_id: "G123".parse().unwrap(),
        kind,
        name: "private".into(),
        folder: "private".parse().unwrap(),
        member_ids: vec![],
        creator_id: None,
        created_at: None,
        archived: false,
        message_count: None,
    }
}

impl CanonicalImportRepo for Canonical {
    async fn source_binding(
        &self,
        team_id: Uuid,
    ) -> LedgerResult<Option<ledger::ImportSourceBinding>> {
        assert_eq!(team_id, Uuid::from(team()));
        Ok(self.binding.clone())
    }
    async fn bind_source(
        &self,
        _: Uuid,
        _: Option<&ledger::SlackWorkspaceId>,
        _: bool,
    ) -> LedgerResult<ledger::ImportSourceBinding> {
        panic!("source binding must commit with job creation, not in this adapter")
    }
    async fn reserve_target(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ledger::ImportTargetKey,
        kind: ledger::ImportTargetKind,
        existing: Option<Uuid>,
    ) -> LedgerResult<ledger::ImportTargetReservation> {
        assert_eq!(user.as_ref(), "macro|admin@example.com");
        assert_eq!(key.team_id, Uuid::from(team()));
        assert_eq!(key.foreign_id.as_str(), "G123");
        assert_eq!(kind, self.kind);
        assert_eq!(existing, Some(target()));
        if self.conflict {
            return Err(LedgerError::TargetConflict);
        }
        Ok(ledger::ImportTargetReservation {
            key: key.clone(),
            channel_id: target(),
            ready: false,
        })
    }
    async fn complete_target(
        &self,
        key: &ledger::ImportTargetKey,
        channel_id: Uuid,
        kind: ledger::ImportTargetKind,
    ) -> LedgerResult<ledger::ImportTargetReservation> {
        assert_eq!(key.team_id, Uuid::from(team()));
        assert_eq!(key.foreign_id.as_str(), "G123");
        assert_eq!(channel_id, target());
        assert_eq!(kind, self.kind);
        Ok(ledger::ImportTargetReservation {
            key: key.clone(),
            channel_id,
            ready: true,
        })
    }
}

#[tokio::test]
async fn translates_binding_without_exposing_ledger_internals() {
    for (binding, expected) in [
        (None, SourceBinding::Unbound),
        (
            Some(ledger::ImportSourceBinding {
                workspace_id: None,
                confirmed_unknown_at: Some(chrono::Utc::now()),
            }),
            SourceBinding::ConfirmedUnknown,
        ),
        (
            Some(ledger::ImportSourceBinding {
                workspace_id: ledger::SlackWorkspaceId::new("T123"),
                confirmed_unknown_at: None,
            }),
            SourceBinding::Known {
                source_id: "T123".parse().unwrap(),
            },
        ),
    ] {
        let adapter = CanonicalImportLedger::new(Canonical {
            binding,
            kind: ledger::ImportTargetKind::Team,
            conflict: false,
        });
        assert_eq!(adapter.source_binding(team()).await.unwrap(), expected);
    }
}

#[tokio::test]
async fn reservation_passes_requester_explicit_team_and_authorized_target_for_every_kind() {
    let requester = MacroUserIdStr::parse_from_str("macro|admin@example.com")
        .unwrap()
        .into_owned();
    for (source_kind, kind) in [
        (
            ConversationKind::PublicChannel,
            ledger::ImportTargetKind::Team,
        ),
        (
            ConversationKind::PrivateChannel,
            ledger::ImportTargetKind::Private,
        ),
        (
            ConversationKind::GroupDirectMessage,
            ledger::ImportTargetKind::Private,
        ),
        (
            ConversationKind::DirectMessage,
            ledger::ImportTargetKind::DirectMessage,
        ),
    ] {
        let adapter = CanonicalImportLedger::new(Canonical {
            binding: None,
            kind,
            conflict: false,
        });
        let reservation = adapter
            .reserve(team(), &requester, &metadata(source_kind), Some(target()))
            .await
            .unwrap();
        assert_eq!(reservation.channel_id, target());
        assert_eq!(reservation.status, ReservationStatus::Pending);
        adapter.complete(&reservation, source_kind).await.unwrap();
    }
}

#[test]
fn unexpected_discovery_error_fails_closed() {
    assert_eq!(
        map_error(LedgerError::UnsupportedDiscovery(
            ledger::ImportSource::Slack
        ))
        .into_current_context(),
        ImportError::Internal
    );
}

#[test]
fn unexpected_ai_admission_error_fails_closed() {
    let admission = serde_json::from_str(r#""unavailable""#).unwrap();
    assert_eq!(
        map_error(LedgerError::Admission(admission)).into_current_context(),
        ImportError::Internal
    );
}

#[tokio::test]
async fn ambiguous_mapping_fails_closed_without_target_disclosure() {
    let requester = MacroUserIdStr::parse_from_str("macro|admin@example.com")
        .unwrap()
        .into_owned();
    let adapter = CanonicalImportLedger::new(Canonical {
        binding: None,
        kind: ledger::ImportTargetKind::Private,
        conflict: true,
    });
    assert_eq!(
        adapter
            .reserve(
                team(),
                &requester,
                &metadata(ConversationKind::PrivateChannel),
                Some(target())
            )
            .await
            .unwrap_err()
            .into_current_context(),
        ImportError::Conflict
    );
}
