//! Profile-picture checks: one at a time, spaced, pausing after WhatsApp
//! rate-limits the account.

use super::*;
use crate::domain::pictures::PicturePacing;

const FIRST: &str = "5550001@lid";
const SECOND: &str = "5550002@lid";

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn checks_are_spaced_and_pause_after_a_rate_limit(pool: PgPool) {
    let (account, _pairing) = insert_pairing_account(&pool).await;
    sqlx::query!(
        "UPDATE whatsapp_linked_account SET state = 'connected', identity_jid = $2 WHERE id = $1",
        account,
        IDENTITY,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE whatsapp_pairing SET state = 'success', consumed_at = now() WHERE account_id = $1",
        account
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO whatsapp_profile_picture (account_id, jid, state, retry_at) VALUES
            ($1, $2, 'due', now() - interval '2 minutes'), ($1, $3, 'due', now() - interval '1 minute')"#,
        account,
        FIRST,
        SECOND
    )
    .execute(&pool)
    .await
    .unwrap();

    let pacing = PicturePacing {
        spacing: Duration::from_millis(300),
        warmup: Duration::ZERO,
        backoff: Duration::from_secs(1),
    };
    let (runner, whatsapp, mut calls) = runner_pacing(
        Duration::from_secs(600),
        Duration::from_secs(3600),
        pacing,
        &pool,
    );
    *whatsapp.identity.lock().unwrap() = Some(IDENTITY.to_owned());
    whatsapp.pictures.lock().unwrap().extend([
        PictureAnswer::RateLimited,
        PictureAnswer::Picture {
            id: "1700000001".to_owned(),
            bytes: b"jpeg bytes".to_vec(),
            mime: "image/jpeg".to_owned(),
        },
        PictureAnswer::Hidden,
    ]);
    let started = start(&runner, account);
    assert_eq!(calls.recv().await, Some(Call::Open(1, false)));
    assert_eq!(calls.recv().await, Some(Call::Connect));
    event_sender(&whatsapp)
        .send(SessionEvent::Connected)
        .unwrap();

    // The group refresh on connect runs alongside; only picture queries
    // matter here.
    let mut queried = vec![];
    while queried.len() < 3 {
        if let Some(Call::ProfilePicture(jid)) = calls.recv().await {
            queried.push((jid, tokio::time::Instant::now()));
        }
    }
    started.release.cancel();
    assert_eq!(started.running.await.unwrap(), AccountExit::Released);

    assert_eq!(
        queried
            .iter()
            .map(|(jid, _)| jid.as_str())
            .collect::<Vec<_>>(),
        [FIRST, SECOND, FIRST],
        "a rate-limited check is due again, behind those already waiting"
    );
    assert!(queried[1].1 - queried[0].1 >= pacing.backoff);
    assert!(queried[2].1 - queried[1].1 >= pacing.spacing);

    let stored = sqlx::query!(
        "SELECT jid, state FROM whatsapp_profile_picture WHERE account_id = $1 ORDER BY jid",
        account
    )
    .fetch_all(&pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.jid, row.state))
    .collect::<Vec<_>>();
    assert_eq!(
        stored,
        [
            (FIRST.to_owned(), "hidden".to_owned()),
            (SECOND.to_owned(), "staged".to_owned()),
        ]
    );
    let counted = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM whatsapp_picture_query WHERE account_id = $1"#,
        account
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        counted, 3,
        "a rate-limited query still counts against the budget"
    );
}
