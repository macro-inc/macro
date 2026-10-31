//! Phone-number lookups answered by the account's session.

use super::*;

const UNREGISTERED: &str = "+5550003";

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lookups_are_answered_on_their_signal_and_list_found_numbers(pool: PgPool) {
    let (account, _, mut calls, started) = connected(&pool, Duration::from_secs(3600)).await;
    let found = Uuid::now_v7();
    let unregistered = Uuid::now_v7();
    for (id, phone) in [(found, REGISTERED), (unregistered, UNREGISTERED)] {
        sqlx::query!(
            "INSERT INTO whatsapp_lookup (id, account_id, phone_number, state) VALUES ($1, $2, $3, 'pending')",
            id,
            account,
            phone
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    started
        .signals
        .send(AccountSignal::Lookup.into())
        .await
        .unwrap();
    assert_eq!(
        calls.recv().await,
        Some(Call::LookUp(REGISTERED.to_owned()))
    );
    assert_eq!(
        calls.recv().await,
        Some(Call::LookUp(UNREGISTERED.to_owned()))
    );
    started.release.cancel();
    assert_eq!(started.running.await.unwrap(), AccountExit::Released);

    let registered_jid = PhoneNumber::parse(REGISTERED).unwrap().jid();
    let answered = sqlx::query!(
        "SELECT id, state, chat_jid FROM whatsapp_lookup WHERE account_id = $1 ORDER BY phone_number",
        account
    )
    .fetch_all(&pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.id, row.state, row.chat_jid))
    .collect::<Vec<_>>();
    assert_eq!(
        answered,
        [
            (found, "found".to_owned(), Some(registered_jid.clone())),
            (unregistered, "not_on_whatsapp".to_owned(), None),
        ]
    );
    let listed = sqlx::query!(
        "SELECT chat_jid, kind, name, last_activity_at FROM whatsapp_chat WHERE account_id = $1",
        account
    )
    .fetch_all(&pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.chat_jid, row.kind, row.name, row.last_activity_at))
    .collect::<Vec<_>>();
    assert_eq!(
        listed,
        [(
            registered_jid,
            "direct".to_owned(),
            Some("Customer".to_owned()),
            None
        )]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
/// A lookup started while no replica ran the account (its signal went
/// nowhere) is answered once the account connects.
async fn lookups_pending_before_connecting_are_answered_once_connected(pool: PgPool) {
    let (account, _pairing) = insert_pairing_account(&pool).await;
    make_connected(&pool, account, false).await;
    sqlx::query!(
        "INSERT INTO whatsapp_lookup (id, account_id, phone_number, state) VALUES ($1, $2, $3, 'pending')",
        Uuid::now_v7(),
        account,
        UNREGISTERED
    )
    .execute(&pool)
    .await
    .unwrap();
    let (runner, whatsapp, mut calls) = runner(&pool);
    *whatsapp.identity.lock().unwrap() = Some(IDENTITY.to_owned());
    let started = start(&runner, account);
    assert_eq!(calls.recv().await, Some(Call::Open(1, false)));
    assert_eq!(calls.recv().await, Some(Call::Connect));
    event_sender(&whatsapp)
        .send(SessionEvent::Connected)
        .unwrap();
    assert_eq!(calls.recv().await, Some(Call::JoinedGroups));
    assert_eq!(
        calls.recv().await,
        Some(Call::LookUp(UNREGISTERED.to_owned()))
    );
    started.release.cancel();
    assert_eq!(started.running.await.unwrap(), AccountExit::Released);
}
