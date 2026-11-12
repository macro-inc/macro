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
        checks,
        vec![
            PictureCheck {
                jid: GROUP.to_owned(),
                existing_id: None,
                common_group: None,
            },
            PictureCheck {
                jid: CUSTOMER_JID.to_owned(),
                existing_id: None,
                common_group: Some(GROUP.to_owned()),
            },
        ]
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
            CUSTOMER_JID,
            &PictureAnswer::Picture {
                id: "1700000001".to_owned(),
                bytes: b"jpeg bytes".to_vec(),
                mime: "image/jpeg".to_owned(),
            },
        )
        .await
        .unwrap();
    session
        .complete_picture_check(alice, GROUP, &PictureAnswer::NotSet)
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
    assert_eq!(
        session.claim_picture_checks(alice, 10).await.unwrap(),
        vec![PictureCheck {
            jid: CUSTOMER_JID.to_owned(),
            existing_id: Some("1700000001".to_owned()),
            common_group: Some(GROUP.to_owned()),
        }]
    );
    session
        .complete_picture_check(
            alice,
            CUSTOMER_JID,
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
    session.claim_picture_checks(alice, 10).await.unwrap();
    session
        .complete_picture_check(alice, CUSTOMER_JID, &PictureAnswer::Hidden)
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
    session.claim_picture_checks(alice, 10).await.unwrap();
    session
        .complete_picture_check(
            alice,
            GROUP,
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
