//! Pairing consent, identity ownership and lease fencing.
use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pairing_is_owner_bound_and_a_verified_identity_cannot_change_hands(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let pairing = linked
        .whatsapp
        .connect(&person(ALICE), false, SendAuthority::Human)
        .await
        .unwrap();
    assert_eq!(pairing.state, PairingState::Waiting);
    assert_eq!(
        linked
            .whatsapp
            .connect(&person(ALICE), false, SendAuthority::Human)
            .await
            .unwrap()
            .id,
        pairing.id,
        "a live transaction is resumed, not duplicated"
    );
    assert!(matches!(
        linked
            .whatsapp
            .pair_state(&person(BOB), pairing.id, SendAuthority::Human)
            .await
            .err()
            .unwrap()
            .current_context(),
        ExternalChatError::NotFound
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
                .whatsapp
                .pair_state(&person(ALICE), pairing.id, SendAuthority::UserApiToken)
                .await
                .err()
                .unwrap()
                .current_context(),
            ExternalChatError::Forbidden
        ),
        "automation cannot read live enrollment material"
    );
    let state = linked
        .whatsapp
        .pair_state(&person(ALICE), pairing.id, SendAuthority::Human)
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
        .whatsapp
        .pair_state(&person(ALICE), pairing.id, SendAuthority::Human)
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
            .whatsapp
            .connect(&person(ALICE), false, SendAuthority::Human)
            .await
            .unwrap_err()
            .current_context(),
        ExternalChatError::Conflict
    ));

    // Bob cannot pair Alice's WhatsApp account.
    let bob = linked
        .whatsapp
        .connect(&person(BOB), false, SendAuthority::Human)
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
    assert!(matches!(
        stolen.current_context(),
        ExternalChatError::Forbidden
    ));
    assert_eq!(
        linked
            .whatsapp
            .pair_state(&person(BOB), bob.id, SendAuthority::Human)
            .await
            .unwrap()
            .state,
        PairingState::Failed
    );
    assert_eq!(
        linked
            .whatsapp
            .account(&person(BOB))
            .await
            .unwrap()
            .unwrap()
            .state,
        AccountState::Disconnected
    );

    // A reconnect must come back as the same identity.
    let account = linked
        .whatsapp
        .account(&person(ALICE))
        .await
        .unwrap()
        .unwrap();
    linked
        .whatsapp
        .disconnect(
            &person(ALICE),
            account.authorization_generation,
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let reconnect = linked
        .whatsapp
        .connect(&person(ALICE), false, SendAuthority::Human)
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
    assert!(matches!(
        swapped.current_context(),
        ExternalChatError::Conflict
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cancelling_pairing_ends_consent_and_signals_the_replica(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let pairing = linked
        .whatsapp
        .connect(&person(ALICE), false, SendAuthority::Human)
        .await
        .unwrap();
    assert_eq!(
        linked
            .whatsapp
            .cancel(&person(ALICE), pairing.id, SendAuthority::Automation)
            .await
            .unwrap_err()
            .current_context(),
        &ExternalChatError::Forbidden
    );
    linked
        .whatsapp
        .cancel(&person(ALICE), pairing.id, SendAuthority::Human)
        .await
        .unwrap();
    linked
        .whatsapp
        .cancel(&person(ALICE), pairing.id, SendAuthority::Human)
        .await
        .unwrap();
    let work = session.pairing_work(pairing.id).await.unwrap().unwrap();
    assert_eq!(work.state, PairingState::Cancelled);
    assert_eq!(
        linked
            .whatsapp
            .account(&person(ALICE))
            .await
            .unwrap()
            .unwrap()
            .state,
        AccountState::Disconnected
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_expired_qr_session_reads_as_expired_and_a_new_connect_starts_fresh(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let pairing = linked
        .whatsapp
        .connect(&person(ALICE), false, SendAuthority::Human)
        .await
        .unwrap();
    let lease = session.begin_lease(pairing.account_id).await.unwrap();
    session
        .update_pairing(
            lease.scope,
            pairing.id,
            PairingUpdate::Qr("2@qr-ref".into()),
        )
        .await
        .unwrap();
    let work = session
        .update_pairing(lease.scope, pairing.id, PairingUpdate::Expired)
        .await
        .unwrap();
    assert_eq!(work.state, PairingState::Expired);
    let state = linked
        .whatsapp
        .pair_state(&person(ALICE), pairing.id, SendAuthority::Human)
        .await
        .unwrap();
    assert_eq!(state.state, PairingState::Expired);
    assert!(state.qr.is_none(), "an expired code is not scannable");
    assert_eq!(
        linked
            .whatsapp
            .account(&person(ALICE))
            .await
            .unwrap()
            .unwrap()
            .state,
        AccountState::Disconnected
    );
    let next = linked
        .whatsapp
        .connect(&person(ALICE), false, SendAuthority::Human)
        .await
        .unwrap();
    assert_ne!(
        next.id, pairing.id,
        "the expired transaction is not resumed"
    );
    assert_eq!(next.state, PairingState::Waiting);
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
            ExternalChatError::Fenced
        ));
    }
}
