use super::*;

fn paths() -> Paths {
    Paths::new("cache.db".into(), "cache.db-wal".into())
}

fn active_machine() -> (Machine, OwnerId, SessionId, [HandleId; 2]) {
    let mut machine = Machine::default();
    let owner = machine.claim_owner().unwrap();
    let session = machine.start_open(owner, paths()).unwrap();
    let main = machine.register(owner, session, FileRole::Main).unwrap();
    let wal = machine.register(owner, session, FileRole::Wal).unwrap();
    machine.activate(owner, session, false).unwrap();
    (machine, owner, session, [main, wal])
}

fn closed_machine() -> (Machine, OwnerId, CloseToken) {
    let (mut machine, owner, session, _) = active_machine();
    machine.bind_connection(owner, session).unwrap();
    machine.record_connection_close(owner, session).unwrap();
    machine.start_close(owner, session).unwrap();
    let token = machine.finish_close(owner, session).unwrap();
    (machine, owner, token)
}

#[test]
fn numeric_trait_tokens_are_send_sync_and_pointer_free() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<OwnerId>();
    assert_send_sync::<SessionId>();
    assert_send_sync::<HandleId>();
    assert_send_sync::<CloseToken>();
    assert_eq!(std::mem::size_of::<OwnerId>(), std::mem::size_of::<u64>());
    assert_eq!(std::mem::size_of::<SessionId>(), std::mem::size_of::<u64>());
    assert_eq!(std::mem::size_of::<HandleId>(), std::mem::size_of::<u64>());
    assert_eq!(
        std::mem::size_of::<CloseToken>(),
        std::mem::size_of::<u64>()
    );
}

#[test]
fn one_owner_and_matching_idle_release_are_required() {
    let mut machine = Machine::default();
    let owner = machine.claim_owner().unwrap();
    assert_eq!(owner.get(), 1);
    assert!(machine.is_idle_owner(owner));
    assert_eq!(
        machine.claim_owner().unwrap_err().kind,
        StateErrorKind::Ownership
    );
    assert_eq!(
        machine
            .release_owner(OwnerId(owner.get() + 1))
            .unwrap_err()
            .kind,
        StateErrorKind::Ownership
    );
    assert_eq!(machine.phase_label(), "idle");
    machine.release_owner(owner).unwrap();
    assert_eq!(machine.phase_label(), "unowned");
    assert_eq!(machine.claim_owner().unwrap().get(), 2);
}

#[test]
fn opening_requires_exactly_main_and_wal_once() {
    let mut machine = Machine::default();
    let owner = machine.claim_owner().unwrap();
    let session = machine.start_open(owner, paths()).unwrap();
    let main = machine.register(owner, session, FileRole::Main).unwrap();
    assert_eq!(main.get(), 1);
    assert_eq!(
        machine
            .register(owner, session, FileRole::Main)
            .unwrap_err()
            .kind,
        StateErrorKind::Registration
    );
    assert_eq!(
        machine.activate(owner, session, false).unwrap_err().kind,
        StateErrorKind::Registration
    );
    let wal = machine.register(owner, session, FileRole::Wal).unwrap();
    assert_eq!(wal.get(), 2);
    machine.activate(owner, session, false).unwrap();
    assert_eq!(machine.phase_label(), "active");
}

#[test]
fn partial_open_cleanup_returns_idle_only_when_certain() {
    let mut clean = Machine::default();
    let owner = clean.claim_owner().unwrap();
    let session = clean.start_open(owner, paths()).unwrap();
    clean.register(owner, session, FileRole::Main).unwrap();
    clean
        .abort_open(owner, session, true, "WAL open failed".into())
        .unwrap();
    assert_eq!(clean.phase_label(), "idle");
    assert!(clean.start_open(owner, paths()).is_ok());

    let mut uncertain = Machine::default();
    let owner = uncertain.claim_owner().unwrap();
    let session = uncertain.start_open(owner, paths()).unwrap();
    uncertain.register(owner, session, FileRole::Main).unwrap();
    uncertain
        .abort_open(
            owner,
            session,
            false,
            "WAL open and main close failed".into(),
        )
        .unwrap();
    assert_eq!(uncertain.phase_label(), "poisoned");
    assert_eq!(
        uncertain.start_open(owner, paths()).unwrap_err().kind,
        StateErrorKind::Poisoned
    );
    assert_eq!(
        uncertain.release_owner(owner).unwrap_err().kind,
        StateErrorKind::Poisoned
    );
}

#[test]
fn approved_main_and_wal_flags_are_enforced() {
    let (machine, owner, session, handles) = active_machine();
    machine.validate_session(owner, session).unwrap();
    machine
        .validate_path(owner, session, "cache.db-wal")
        .unwrap();
    assert_eq!(
        machine
            .validate_open(owner, session, "cache.db", false, false, true)
            .unwrap(),
        handles[0]
    );
    assert_eq!(
        machine
            .validate_open(owner, session, "cache.db-wal", false, false, false)
            .unwrap(),
        handles[1]
    );
    assert_eq!(
        machine
            .validate_open(owner, session, "cache.db-wal", false, true, false)
            .unwrap(),
        handles[1]
    );
    for error in [
        machine.validate_open(owner, session, "other.db", false, false, true),
        machine.validate_open(owner, session, "cache.db", true, false, true),
        machine.validate_open(owner, session, "cache.db", false, true, true),
        machine.validate_open(owner, session, "cache.db", false, false, false),
        machine.validate_open(owner, session, "cache.db-wal", false, false, true),
    ] {
        assert!(error.is_err());
    }
}

#[test]
fn stale_sessions_and_reentrant_operations_do_not_mutate_health() {
    let (mut machine, owner, session, _) = active_machine();
    assert_eq!(
        machine
            .poison(OwnerId(owner.get() + 1), "stale cleanup".into())
            .unwrap_err()
            .kind,
        StateErrorKind::Ownership
    );
    assert_eq!(machine.phase_label(), "active");
    assert_eq!(
        machine
            .begin_operation(owner, SessionId(session.get() + 1))
            .unwrap_err()
            .kind,
        StateErrorKind::Session
    );
    assert_eq!(machine.phase_label(), "active");
    machine.begin_operation(owner, session).unwrap();
    assert_eq!(
        machine.begin_operation(owner, session).unwrap_err().kind,
        StateErrorKind::Reentrant
    );
    assert_eq!(
        machine.start_close(owner, session).unwrap_err().kind,
        StateErrorKind::ActiveReferences
    );
    machine.end_operation(owner, session);
    assert_eq!(
        machine.start_close(owner, session).unwrap_err().kind,
        StateErrorKind::ActiveReferences
    );
    machine.bind_connection(owner, session).unwrap();
    assert_eq!(
        machine.start_close(owner, session).unwrap_err().kind,
        StateErrorKind::ActiveReferences
    );
    machine.record_connection_close(owner, session).unwrap();
    machine.start_close(owner, session).unwrap();
    assert_eq!(machine.phase_label(), "closing");
}

#[test]
fn invalid_close_tokens_never_mutate_closed_state() {
    let (mut machine, owner, token) = closed_machine();
    assert_eq!(token.get(), 1);
    assert_eq!(
        machine
            .preserve(OwnerId(owner.get() + 1), token)
            .unwrap_err()
            .kind,
        StateErrorKind::Token
    );
    assert_eq!(machine.phase_label(), "closed");
    assert_eq!(
        machine
            .start_reset(owner, CloseToken::from_raw(token.get() + 1))
            .unwrap_err()
            .kind,
        StateErrorKind::Token
    );
    assert_eq!(machine.phase_label(), "closed");
    machine.preserve(owner, token).unwrap();
    assert_eq!(machine.phase_label(), "idle");
    assert_eq!(
        machine.preserve(owner, token).unwrap_err().kind,
        StateErrorKind::Token
    );
    assert_eq!(machine.phase_label(), "idle");
}

#[test]
fn reset_consumes_token_and_returns_matching_owner_to_idle() {
    let (mut machine, owner, token) = closed_machine();
    let selected = machine.start_reset(owner, token).unwrap();
    assert_eq!(selected, paths());
    assert_eq!(machine.phase_label(), "resetting");
    assert_eq!(
        machine.start_reset(owner, token).unwrap_err().kind,
        StateErrorKind::Token
    );
    assert_eq!(machine.phase_label(), "resetting");
    machine.finish_reset(owner, token).unwrap();
    assert_eq!(machine.phase_label(), "idle");
    assert_eq!(
        machine.start_reset(owner, token).unwrap_err().kind,
        StateErrorKind::Token
    );
    assert_eq!(machine.phase_label(), "idle");
}

#[test]
fn reset_failure_poison_rejects_reopen_release_and_token_reuse() {
    let (mut machine, owner, token) = closed_machine();
    machine.start_reset(owner, token).unwrap();
    machine.poison(owner, "partial deletion".into()).unwrap();
    machine.poison(owner, "later failure".into()).unwrap();
    assert_eq!(machine.phase_label(), "poisoned");
    assert_eq!(machine.poison_reason(), Some("partial deletion"));
    assert_eq!(
        machine.finish_reset(owner, token).unwrap_err().kind,
        StateErrorKind::Poisoned
    );
    assert_eq!(
        machine.start_reset(owner, token).unwrap_err().kind,
        StateErrorKind::Poisoned
    );
    assert_eq!(
        machine.start_open(owner, paths()).unwrap_err().kind,
        StateErrorKind::Poisoned
    );
    assert_eq!(
        machine.release_owner(owner).unwrap_err().kind,
        StateErrorKind::Poisoned
    );
}

#[test]
fn incomplete_pair_is_reset_only_and_never_operational() {
    let mut machine = Machine::default();
    let owner = machine.claim_owner().unwrap();
    let session = machine.start_open(owner, paths()).unwrap();
    machine.register(owner, session, FileRole::Main).unwrap();
    machine.register(owner, session, FileRole::Wal).unwrap();
    machine.activate(owner, session, true).unwrap();
    assert_eq!(
        machine.begin_operation(owner, session).unwrap_err().kind,
        StateErrorKind::Session
    );
    assert_eq!(
        machine.bind_connection(owner, session).unwrap_err().kind,
        StateErrorKind::Session
    );
    assert_eq!(
        machine.start_close(owner, session).unwrap_err().kind,
        StateErrorKind::ActiveReferences
    );
    machine.start_reset_only_close(owner, session).unwrap();
    let token = machine.finish_close(owner, session).unwrap();
    machine.start_reset(owner, token).unwrap();
    machine.finish_reset(owner, token).unwrap();
    assert_eq!(machine.phase_label(), "idle");
}

#[test]
fn recovery_wipe_is_consuming_and_poisoned_cancellation_cannot_finish() {
    let mut machine = Machine::default();
    let owner = machine.claim_owner().unwrap();
    machine.start_wipe(owner, paths()).unwrap();
    assert_eq!(machine.phase_label(), "wiping");
    assert_eq!(
        machine.start_open(owner, paths()).unwrap_err().kind,
        StateErrorKind::Ownership
    );
    machine
        .poison(owner, "recovery future cancelled".into())
        .unwrap();
    assert_eq!(machine.phase_label(), "poisoned");
    assert_eq!(
        machine.finish_wipe(owner).unwrap_err().kind,
        StateErrorKind::Poisoned
    );
}
