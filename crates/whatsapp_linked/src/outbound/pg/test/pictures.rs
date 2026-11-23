//! Profile pictures: tracked on first sight in an added chat, checked within
//! the account's budget, staged for DSS and stored as static files, and
//! dropped or re-checked when WhatsApp says they changed.

use super::*;
use crate::domain::{
    models::{PICTURE_QUERIES_PER_DAY, PICTURE_QUERIES_PER_HOUR},
    ports::PictureRepository,
};

async fn pictures(
    pool: &PgPool,
    account: Uuid,
) -> Vec<(String, String, Option<String>, Option<Uuid>)> {
    sqlx::query!(
        "SELECT jid, state, picture_id, static_file_id FROM whatsapp_profile_picture WHERE account_id = $1 ORDER BY jid",
        account
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.jid, row.state, row.picture_id, row.static_file_id))
    .collect()
}

async fn released_files(pool: &PgPool) -> Vec<Uuid> {
    sqlx::query_scalar!("SELECT file_id FROM external_chat_file_deletion ORDER BY file_id")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_owner_tracks_the_added_group_and_new_senders_once_and_stores_what_it_sees(
    pool: PgPool,
) {
    let (_, session, repository, _, alice, bob) = adopted(&pool).await;
    session
        .ingest_event(
            bob,
            &text(1, CUSTOMER_JID, "3EB0AAAA", "Can someone call me?"),
        )
        .await
        .unwrap();
    session
        .ingest_event(alice, &text(2, CUSTOMER_JID, "3EB0BBBB", "Hello?"))
        .await
        .unwrap();

    assert_eq!(
        pictures(&pool, alice.account_id).await,
        vec![
            (GROUP.to_owned(), "due".to_owned(), None, None),
            (CUSTOMER_JID.to_owned(), "due".to_owned(), None, None),
        ],
        "the owner's account tracks the group and the sender, whoever observed the message"
    );
    assert!(
        pictures(&pool, bob.account_id).await.is_empty(),
        "chats show their owner's view, so other observers track nothing"
    );

    let mut checks = session.claim_picture_checks(alice, 10).await.unwrap();
    checks.sort_by(|a, b| a.jid.cmp(&b.jid));
    assert_eq!(
        checks
            .iter()
            .map(|check| (
                check.jid.as_str(),
                check.existing_id.as_deref(),
                check.common_group.as_deref()
            ))
            .collect::<Vec<_>>(),
        [(GROUP, None, None), (CUSTOMER_JID, None, Some(GROUP))]
    );
    assert!(
        session
            .claim_picture_checks(alice, 10)
            .await
            .unwrap()
            .is_empty(),
        "claimed checks are held"
    );

    session
        .complete_picture_check(
            alice,
            &checks[1],
            &PictureAnswer::Picture {
                id: "1700000001".to_owned(),
                bytes: b"jpeg bytes".to_vec(),
                mime: "image/jpeg".to_owned(),
            },
        )
        .await
        .unwrap();
    session
        .complete_picture_check(alice, &checks[0], &PictureAnswer::NotSet)
        .await
        .unwrap();

    let staged = repository.staged_pictures(10).await.unwrap();
    assert_eq!(
        staged,
        vec![StagedPicture {
            account_id: alice.account_id,
            user_id: ALICE.to_owned(),
            jid: CUSTOMER_JID.to_owned(),
            picture_id: "1700000001".to_owned(),
            bytes: b"jpeg bytes".to_vec(),
            mime: "image/jpeg".to_owned(),
        }]
    );
    assert!(
        repository.staged_pictures(10).await.unwrap().is_empty(),
        "a DSS replica holds what it is importing"
    );

    let first_file = Uuid::now_v7();
    assert!(
        repository
            .picture_stored(alice.account_id, CUSTOMER_JID, "1700000001", first_file)
            .await
            .unwrap()
    );
    assert_eq!(
        pictures(&pool, alice.account_id).await,
        vec![
            (GROUP.to_owned(), "none".to_owned(), None, None),
            (
                CUSTOMER_JID.to_owned(),
                "ready".to_owned(),
                Some("1700000001".to_owned()),
                Some(first_file)
            ),
        ]
    );

    // A new picture is checked again at once, offering the stored id, and
    // replacing the stored file releases the old one.
    session
        .picture_changed(alice, &[CUSTOMER_JID.to_owned()], Some("1700000001"))
        .await
        .unwrap();
    assert!(
        session
            .claim_picture_checks(alice, 10)
            .await
            .unwrap()
            .is_empty(),
        "the same id changes nothing"
    );
    session
        .picture_changed(
            alice,
            &["99990001@lid".to_owned(), CUSTOMER_JID.to_owned()],
            Some("1700000002"),
        )
        .await
        .unwrap();
    let checks = session.claim_picture_checks(alice, 10).await.unwrap();
    assert_eq!(
        checks
            .iter()
            .map(|check| (
                check.jid.as_str(),
                check.existing_id.as_deref(),
                check.common_group.as_deref()
            ))
            .collect::<Vec<_>>(),
        [(CUSTOMER_JID, Some("1700000001"), Some(GROUP))]
    );
    session
        .complete_picture_check(
            alice,
            &checks[0],
            &PictureAnswer::Picture {
                id: "1700000002".to_owned(),
                bytes: b"new jpeg".to_vec(),
                mime: "image/jpeg".to_owned(),
            },
        )
        .await
        .unwrap();
    let second_file = Uuid::now_v7();
    assert!(
        repository
            .picture_stored(alice.account_id, CUSTOMER_JID, "1700000002", second_file)
            .await
            .unwrap()
    );
    assert_eq!(released_files(&pool).await, vec![first_file]);

    // Hidden by their privacy setting: the picture is dropped, so the chat
    // shows initials.
    session
        .picture_changed(alice, &[CUSTOMER_JID.to_owned()], Some("1700000003"))
        .await
        .unwrap();
    let checks = session.claim_picture_checks(alice, 10).await.unwrap();
    session
        .complete_picture_check(alice, &checks[0], &PictureAnswer::Hidden)
        .await
        .unwrap();
    assert_eq!(
        pictures(&pool, alice.account_id).await[1],
        (CUSTOMER_JID.to_owned(), "hidden".to_owned(), None, None)
    );
    assert_eq!(released_files(&pool).await.len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_picture_that_moved_on_during_import_is_never_stored(pool: PgPool) {
    let (_, session, repository, _, alice, _) = adopted(&pool).await;
    let checks = session.claim_picture_checks(alice, 10).await.unwrap();
    session
        .complete_picture_check(
            alice,
            &checks[0],
            &PictureAnswer::Picture {
                id: "1700000001".to_owned(),
                bytes: b"group jpeg".to_vec(),
                mime: "image/png".to_owned(),
            },
        )
        .await
        .unwrap();
    let importing = repository.staged_pictures(10).await.unwrap();
    assert_eq!(importing.len(), 1);

    // The group's picture is removed while DSS is storing the old one.
    session
        .picture_changed(alice, &[GROUP.to_owned()], None)
        .await
        .unwrap();
    let orphan = Uuid::now_v7();
    assert!(
        !repository
            .picture_stored(alice.account_id, GROUP, "1700000001", orphan)
            .await
            .unwrap()
    );
    assert_eq!(
        pictures(&pool, alice.account_id).await,
        vec![(GROUP.to_owned(), "none".to_owned(), None, None)]
    );
    assert_eq!(
        released_files(&pool).await,
        vec![orphan],
        "the file DSS stored for nothing is deleted"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn checks_stop_when_the_hourly_or_daily_budget_is_spent(pool: PgPool) {
    let (_, session, _, _, alice, _) = adopted(&pool).await;
    sqlx::query!(
        "INSERT INTO whatsapp_picture_query (account_id, queried_at) SELECT $1, now() - interval '2 hours' FROM generate_series(1, $2::bigint)",
        alice.account_id,
        PICTURE_QUERIES_PER_DAY - 1
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO whatsapp_picture_query (account_id, queried_at) VALUES ($1, now())",
        alice.account_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        session
            .claim_picture_checks(alice, 10)
            .await
            .unwrap()
            .is_empty(),
        "the day's budget is spent"
    );

    sqlx::query!(
        "UPDATE whatsapp_picture_query SET queried_at = now() - interval '25 hours' WHERE account_id = $1 AND queried_at < now() - interval '1 hour'",
        alice.account_id
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO whatsapp_picture_query (account_id, queried_at) SELECT $1, now() FROM generate_series(2, $2::bigint)",
        alice.account_id,
        PICTURE_QUERIES_PER_HOUR
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        session
            .claim_picture_checks(alice, 10)
            .await
            .unwrap()
            .is_empty(),
        "the hour's budget is spent; queries older than a day no longer count"
    );

    sqlx::query!(
        "UPDATE whatsapp_picture_query SET queried_at = now() - interval '2 hours' WHERE account_id = $1",
        alice.account_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        session.claim_picture_checks(alice, 10).await.unwrap().len(),
        1,
        "the group's check runs once the hour has passed"
    );
    let counted = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM whatsapp_picture_query WHERE account_id = $1"#,
        alice.account_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(counted, PICTURE_QUERIES_PER_HOUR + 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_picture_whose_import_failed_is_never_offered_as_unchanged(pool: PgPool) {
    let (_, session, repository, _, alice, _) = adopted(&pool).await;
    let checks = session.claim_picture_checks(alice, 10).await.unwrap();
    session
        .complete_picture_check(
            alice,
            &checks[0],
            &PictureAnswer::Picture {
                id: "1700000001".to_owned(),
                bytes: b"first logo".to_vec(),
                mime: "image/png".to_owned(),
            },
        )
        .await
        .unwrap();
    repository.staged_pictures(10).await.unwrap();
    let first_file = Uuid::now_v7();
    assert!(
        repository
            .picture_stored(alice.account_id, GROUP, "1700000001", first_file)
            .await
            .unwrap()
    );

    // A new picture is staged, but DSS never manages to store it.
    session
        .picture_changed(alice, &[GROUP.to_owned()], Some("1700000002"))
        .await
        .unwrap();
    let checks = session.claim_picture_checks(alice, 10).await.unwrap();
    session
        .complete_picture_check(
            alice,
            &checks[0],
            &PictureAnswer::Picture {
                id: "1700000002".to_owned(),
                bytes: b"second logo".to_vec(),
                mime: "image/png".to_owned(),
            },
        )
        .await
        .unwrap();
    for _ in 0..5 {
        repository
            .picture_store_failed(alice.account_id, GROUP, "1700000002")
            .await
            .unwrap();
    }
    sqlx::query!(
        "UPDATE whatsapp_profile_picture SET retry_at = now() WHERE account_id = $1",
        alice.account_id
    )
    .execute(&pool)
    .await
    .unwrap();

    let checks = session.claim_picture_checks(alice, 10).await.unwrap();
    assert_eq!(
        checks
            .iter()
            .map(|check| (check.jid.as_str(), check.existing_id.as_deref()))
            .collect::<Vec<_>>(),
        [(GROUP, None)],
        "the stored file is the first picture, so the second's id must not be offered"
    );
    assert_eq!(
        pictures(&pool, alice.account_id).await,
        vec![(
            GROUP.to_owned(),
            "failed".to_owned(),
            Some("1700000002".to_owned()),
            Some(first_file)
        )],
        "the first picture stays shown meanwhile"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn ending_consent_drops_what_the_account_saw_and_checks_again(pool: PgPool) {
    let (linked, session, repository, _, alice, _) = adopted(&pool).await;
    let checks = session.claim_picture_checks(alice, 10).await.unwrap();
    session
        .complete_picture_check(
            alice,
            &checks[0],
            &PictureAnswer::Picture {
                id: "1700000001".to_owned(),
                bytes: b"group logo".to_vec(),
                mime: "image/png".to_owned(),
            },
        )
        .await
        .unwrap();
    repository.staged_pictures(10).await.unwrap();
    let file = Uuid::now_v7();
    repository
        .picture_stored(alice.account_id, GROUP, "1700000001", file)
        .await
        .unwrap();

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

    assert_eq!(
        pictures(&pool, alice.account_id).await,
        vec![(GROUP.to_owned(), "due".to_owned(), None, None)],
        "a relink, perhaps with another number, sees for itself"
    );
    assert_eq!(released_files(&pool).await, vec![file]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_answer_overtaken_by_a_removal_is_dropped(pool: PgPool) {
    let (_, session, repository, _, alice, _) = adopted(&pool).await;
    let checks = session.claim_picture_checks(alice, 10).await.unwrap();

    // The group's picture is removed while its download is in flight.
    session
        .picture_changed(alice, &[GROUP.to_owned()], None)
        .await
        .unwrap();
    session
        .complete_picture_check(
            alice,
            &checks[0],
            &PictureAnswer::Picture {
                id: "1700000001".to_owned(),
                bytes: b"removed logo".to_vec(),
                mime: "image/png".to_owned(),
            },
        )
        .await
        .unwrap();

    assert_eq!(
        pictures(&pool, alice.account_id).await,
        vec![(GROUP.to_owned(), "none".to_owned(), None, None)],
        "the removed picture is never staged"
    );
    assert!(repository.staged_pictures(10).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn storing_the_same_file_again_keeps_it(pool: PgPool) {
    let (_, session, repository, _, alice, _) = adopted(&pool).await;
    let checks = session.claim_picture_checks(alice, 10).await.unwrap();
    session
        .complete_picture_check(
            alice,
            &checks[0],
            &PictureAnswer::Picture {
                id: "1700000001".to_owned(),
                bytes: b"group logo".to_vec(),
                mime: "image/png".to_owned(),
            },
        )
        .await
        .unwrap();
    repository.staged_pictures(10).await.unwrap();
    let file = Uuid::now_v7();
    for _ in 0..2 {
        assert!(
            repository
                .picture_stored(alice.account_id, GROUP, "1700000001", file)
                .await
                .unwrap(),
            "a retried store of the stored file succeeds"
        );
    }

    assert_eq!(
        pictures(&pool, alice.account_id).await,
        vec![(
            GROUP.to_owned(),
            "ready".to_owned(),
            Some("1700000001".to_owned()),
            Some(file)
        )]
    );
    assert!(
        released_files(&pool).await.is_empty(),
        "the stored file is never queued for deletion"
    );
}

/// The migration that tracks chats and people added before pictures were.
const BACKFILL: &str = include_str!(
    "../../../../../macro_db_client/migrations/20261113035846_whatsapp_profile_picture_backfill.sql"
);
const CUSTOMER_LID: &str = "100000000000001@lid";

async fn backfill(pool: &PgPool) {
    let mut tx = pool.begin().await.unwrap();
    sqlx::raw_sql(BACKFILL).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_backfill_tracks_added_chats_and_their_people_as_live_tracking_would(pool: PgPool) {
    let (linked, session, _, binding, alice, bob) = adopted(&pool).await;
    session
        .ingest_event(alice, &text(1, CUSTOMER_JID, "3EB0AAAA", "Hello?"))
        .await
        .unwrap();
    session
        .ingest_event(alice, &text(2, BOB_JID, "3EB0BBBB", "On it"))
        .await
        .unwrap();
    assert_eq!(
        pictures(&pool, alice.account_id).await,
        vec![
            (GROUP.to_owned(), "due".to_owned(), None, None),
            (CUSTOMER_JID.to_owned(), "due".to_owned(), None, None),
        ],
        "live tracking: the group and the customer, not Bob, a Macro user"
    );
    // The customer's LID became known; phones key people by it.
    sqlx::query!(
        "INSERT INTO whatsapp_identity_alias (chat_id, jid, person_id, evidence_account_id, verified_at)
        SELECT chat_id, $2, person_id, evidence_account_id, now() FROM whatsapp_identity_alias WHERE chat_id = $1 AND jid = $3",
        binding.id,
        CUSTOMER_LID,
        CUSTOMER_JID
    )
    .execute(&pool)
    .await
    .unwrap();

    // Before this change nothing was tracked; running it twice changes nothing.
    sqlx::query!("DELETE FROM whatsapp_profile_picture")
        .execute(&pool)
        .await
        .unwrap();
    backfill(&pool).await;
    backfill(&pool).await;
    assert_eq!(
        pictures(&pool, alice.account_id).await,
        vec![
            (CUSTOMER_LID.to_owned(), "due".to_owned(), None, None),
            (GROUP.to_owned(), "due".to_owned(), None, None),
        ],
        "the owner's added group, and its non-Macro person once, by LID"
    );
    assert!(pictures(&pool, bob.account_id).await.is_empty());

    linked
        .chats
        .detach(
            &receipt::<MessageView>(ALICE, binding.id),
            SendAuthority::Human,
        )
        .await
        .unwrap();
    sqlx::query!("DELETE FROM whatsapp_profile_picture")
        .execute(&pool)
        .await
        .unwrap();
    backfill(&pool).await;
    assert!(
        pictures(&pool, alice.account_id).await.is_empty(),
        "a detached chat is not tracked"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn detaching_a_chat_stops_checks_only_it_needed_and_releases_their_files(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    // Another of Alice's groups.
    let other_group = GROUP.replace("0001@", "0002@");
    let mut other = group(&[ALICE_JID, CUSTOMER_JID]);
    other.jid = other_group.clone();
    session
        .update_groups(
            alice,
            &[group(&[ALICE_JID, BOB_JID, CUSTOMER_JID]), other],
            true,
        )
        .await
        .unwrap();
    let second = linked
        .chats
        .add(
            &person(ALICE),
            &AddChat {
                provider: ExternalChatProvider::WhatsApp,
                remote_id: other_group.as_str().into(),
                kind: ExternalChatKind::Group,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    session
        .ingest_event(alice, &text(1, CUSTOMER_JID, "3EB0AAAA", "Hello?"))
        .await
        .unwrap();
    let mut elsewhere = text(2, CUSTOMER_JID, "3EB0BBBB", "Same here");
    elsewhere.group_jid = other_group;
    session.ingest_event(alice, &elsewhere).await.unwrap();
    let file = Uuid::now_v7();
    sqlx::query!(
        "UPDATE whatsapp_profile_picture SET state = 'ready', picture_id = '1700000001', static_file_id = $2 WHERE jid = $1",
        CUSTOMER_JID,
        file
    )
    .execute(&pool)
    .await
    .unwrap();

    linked
        .chats
        .detach(
            &receipt::<MessageView>(ALICE, second.id),
            SendAuthority::Human,
        )
        .await
        .unwrap();
    assert_eq!(
        pictures(&pool, alice.account_id).await,
        vec![
            (GROUP.to_owned(), "due".to_owned(), None, None),
            (
                CUSTOMER_JID.to_owned(),
                "ready".to_owned(),
                Some("1700000001".to_owned()),
                Some(file)
            ),
        ],
        "the customer is still shown by the first group"
    );
    assert!(released_files(&pool).await.is_empty());

    linked
        .chats
        .detach(
            &receipt::<MessageView>(ALICE, binding.id),
            SendAuthority::Human,
        )
        .await
        .unwrap();
    assert!(
        pictures(&pool, alice.account_id).await.is_empty(),
        "no added chat shows them: nothing is checked"
    );
    assert_eq!(released_files(&pool).await, [file]);
}
