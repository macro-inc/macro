//! Pairing consent, identity ownership and lease fencing.
use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pairing_is_owner_bound_and_a_verified_identity_cannot_change_hands(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let pairing = linked
        .connect(ALICE, false, SendAuthority::Human)
        .await
        .unwrap();
    assert_eq!(pairing.state, PairingState::Waiting);
    assert_eq!(
        linked
            .connect(ALICE, false, SendAuthority::Human)
            .await
            .unwrap()
            .id,
        pairing.id,
        "a live transaction is resumed, not duplicated"
    );
    assert!(matches!(
        linked
            .pair_state(BOB, pairing.id, SendAuthority::Human)
            .await
            .err()
            .unwrap()
            .current_context(),
        LinkedError::NotFound
    ));
    let lease = session.begin_lease(pairing.account_id).await.unwrap();
    session
        .update_pairing(
            lease.scope,
            pairing.id,
            PairingUpdate::Qr("2@qr-ref".into()),
        )
        .await
        .unwrap();
    assert!(
        matches!(
            linked
                .pair_state(ALICE, pairing.id, SendAuthority::UserApiToken)
                .await
                .err()
                .unwrap()
                .current_context(),
            LinkedError::Forbidden
        ),
        "automation cannot read live enrollment material"
    );
    let state = linked
        .pair_state(ALICE, pairing.id, SendAuthority::Human)
        .await
        .unwrap();
    assert_eq!(state.state, PairingState::Qr);
    assert_eq!(state.qr.as_deref(), Some("2@qr-ref"));
    session
        .update_pairing(
            lease.scope,
            pairing.id,
            PairingUpdate::Success {
                identity_jid: ALICE_JID.into(),
            },
        )
        .await
        .unwrap();
    let state = linked
        .pair_state(ALICE, pairing.id, SendAuthority::Human)
        .await
        .unwrap();
    assert_eq!(state.state, PairingState::Success);
    assert!(
        state.qr.is_none(),
        "codes are cleared when the transaction ends"
    );
    assert_eq!(state.identity_jid.as_deref(), Some(ALICE_JID));
    assert!(matches!(
        linked
            .connect(ALICE, false, SendAuthority::Human)
            .await
            .unwrap_err()
            .current_context(),
        LinkedError::Conflict
    ));

    // Bob cannot pair Alice's WhatsApp account.
    let bob = linked
        .connect(BOB, false, SendAuthority::Human)
        .await
        .unwrap();
    let bob_lease = session.begin_lease(bob.account_id).await.unwrap();
    let stolen = session
        .update_pairing(
            bob_lease.scope,
            bob.id,
            PairingUpdate::Success {
                identity_jid: ALICE_JID.into(),
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(stolen.current_context(), LinkedError::Forbidden));
    assert_eq!(
        linked
            .pair_state(BOB, bob.id, SendAuthority::Human)
            .await
            .unwrap()
            .state,
        PairingState::Failed
    );
    assert_eq!(
        linked.account(BOB).await.unwrap().unwrap().state,
        AccountState::Disconnected
    );

    // A reconnect must come back as the same identity.
    let account = linked.account(ALICE).await.unwrap().unwrap();
    linked
        .disconnect(
            ALICE,
            account.authorization_generation,
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let reconnect = linked
        .connect(ALICE, false, SendAuthority::Human)
        .await
        .unwrap();
    let lease = session.begin_lease(reconnect.account_id).await.unwrap();
    let swapped = session
        .update_pairing(
            lease.scope,
            reconnect.id,
            PairingUpdate::Success {
                identity_jid: BOB_JID.into(),
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(swapped.current_context(), LinkedError::Conflict));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cancelling_pairing_ends_consent_and_signals_the_replica(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let pairing = linked
        .connect(ALICE, false, SendAuthority::Human)
        .await
        .unwrap();
    assert_eq!(
        linked
            .cancel(ALICE, pairing.id, SendAuthority::Automation)
            .await
            .unwrap_err()
            .current_context(),
        &LinkedError::Forbidden
    );
    linked
        .cancel(ALICE, pairing.id, SendAuthority::Human)
        .await
        .unwrap();
    linked
        .cancel(ALICE, pairing.id, SendAuthority::Human)
        .await
        .unwrap();
    let work = session.pairing_work(pairing.id).await.unwrap().unwrap();
    assert_eq!(work.state, PairingState::Cancelled);
    assert_eq!(
        linked.account(ALICE).await.unwrap().unwrap().state,
        AccountState::Disconnected
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_newer_lease_fences_the_previous_replica(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let old = pair(&linked, &session, ALICE, ALICE_JID).await;
    let new = session.begin_lease(old.account_id).await.unwrap();
    assert!(new.scope.lease_epoch > old.lease_epoch);
    for result in [
        session
            .update_groups(old, &[group(&[ALICE_JID])], true)
            .await,
        session.claim_sends(old, 8).await.map(|_| ()),
        session
            .ingest_event(old, &text(1, CUSTOMER_JID, "SRC1", "hi"))
            .await
            .map(|_| ()),
    ] {
        assert!(matches!(
            result.unwrap_err().current_context(),
            LinkedError::Fenced
        ));
    }
}
