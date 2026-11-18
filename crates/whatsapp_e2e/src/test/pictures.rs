//! Profile pictures end to end: what the owner's account sees of an added
//! group and its people is fetched, staged for DSS, kept while unchanged,
//! re-fetched when WhatsApp says it changed, dropped when hidden, and never
//! queried past the account's budget.

use chrono::{DateTime, Utc};
use whatsapp_linked::domain::models::PICTURE_QUERIES_PER_DAY;
use whatsapp_linked::domain::ports::PictureRepository;

use super::*;

struct Row {
    state: String,
    picture_id: Option<String>,
    static_file_id: Option<Uuid>,
    staged: Option<Vec<u8>>,
    mime: Option<String>,
    checked_at: Option<DateTime<Utc>>,
}

async fn picture(pool: &PgPool, jid: &str) -> Option<Row> {
    sqlx::query_as!(
        Row,
        "SELECT state, picture_id, static_file_id, staged, mime, checked_at FROM whatsapp_profile_picture WHERE jid = $1",
        jid
    )
    .fetch_optional(pool)
    .await
    .unwrap()
}

/// Waits until the picture of `jid` satisfies `ready`.
async fn wait_picture(world: &World, jid: &str, ready: impl Fn(&Row) -> bool, what: &str) -> Row {
    let row = wait_for_rows(&world.pool, TIMEOUT, || async {
        picture(&world.pool, jid).await.filter(|row| ready(row))
    })
    .await;
    world.expect(row, what).await
}

/// Makes the picture of `jid` due now, as a week passing would.
async fn make_due(pool: &PgPool, jid: &str) {
    sqlx::query!(
        "UPDATE whatsapp_profile_picture SET retry_at = now() WHERE jid = $1",
        jid
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pictures_of_an_added_group_and_its_people_follow_whatsapp(pool: PgPool) {
    let world = World::new(pool).await;
    let repository = PgWhatsAppRepository::new(world.pool.clone());
    let group_id = world
        .whatsapp
        .set_picture(&world.group, b"group logo".to_vec(), "image/png");
    let first_id = world.whatsapp.set_picture(
        &world.customer.jid(),
        b"customer face".to_vec(),
        "image/jpeg",
    );
    let replica = world.replica().await;
    let (_, _binding) = world.alice_adopted().await;
    let group = world.group.to_string();
    // The customer writes by LID with their phone number alongside; the
    // picture is asked by LID, as phones key people.
    let customer = world.customer.lid().to_string();

    // Set: the group's picture on adding it, the customer's once they write.
    world
        .customer
        .send_text(&world.group, "my order is late")
        .await
        .unwrap();
    for (jid, id, bytes, mime) in [
        (&group, &group_id, b"group logo".as_slice(), "image/png"),
        (
            &customer,
            &first_id,
            b"customer face".as_slice(),
            "image/jpeg",
        ),
    ] {
        let row = wait_picture(
            &world,
            jid,
            |row| row.state == "staged",
            "the picture is staged",
        )
        .await;
        assert_eq!(
            (
                row.picture_id.as_ref(),
                row.staged.as_deref(),
                row.mime.as_deref()
            ),
            (Some(id), Some(bytes), Some(mime))
        );
    }
    let mut staged = repository
        .staged_pictures(10)
        .await
        .unwrap()
        .into_iter()
        .map(|picture| (picture.jid, picture.user_id, picture.account_id))
        .collect::<Vec<_>>();
    staged.sort();
    let account = staged[0].2;
    let mut expected = vec![
        (group.clone(), ALICE.to_owned(), account),
        (customer.clone(), ALICE.to_owned(), account),
    ];
    expected.sort();
    assert_eq!(staged, expected, "files belong to the chat owner's account");
    let first_file = Uuid::now_v7();
    assert!(
        repository
            .picture_stored(account, &customer, &first_id, first_file)
            .await
            .unwrap()
    );

    // Unchanged: a later check offers the stored id and downloads nothing.
    let stored = picture(&world.pool, &customer).await.unwrap();
    let queries = world.whatsapp.picture_queries();
    make_due(&world.pool, &customer).await;
    let rechecked = wait_picture(
        &world,
        &customer,
        |row| row.checked_at > stored.checked_at,
        "the stored picture is checked again",
    )
    .await;
    assert_eq!(
        (
            rechecked.state.as_str(),
            rechecked.static_file_id,
            rechecked.staged
        ),
        ("ready", Some(first_file), None)
    );
    assert_eq!(world.whatsapp.picture_queries(), queries + 1);

    // A change notification fetches the new picture at once.
    let second_id =
        world
            .whatsapp
            .set_picture(&world.customer.jid(), b"new face".to_vec(), "image/jpeg");
    let changed = wait_picture(
        &world,
        &customer,
        |row| row.state == "staged" && row.picture_id.as_ref() == Some(&second_id),
        "the changed picture is staged",
    )
    .await;
    assert_eq!(changed.staged.as_deref(), Some(b"new face".as_slice()));
    let second_file = Uuid::now_v7();
    assert!(
        repository
            .picture_stored(account, &customer, &second_id, second_file)
            .await
            .unwrap()
    );

    // Hidden by their privacy setting: the picture is dropped and its file
    // released, so the chat shows initials.
    world.whatsapp.hide_picture(&world.customer.jid(), true);
    make_due(&world.pool, &customer).await;
    let hidden = wait_picture(
        &world,
        &customer,
        |row| row.state == "hidden",
        "the picture is hidden",
    )
    .await;
    assert_eq!(hidden.static_file_id, None);
    let released =
        sqlx::query_scalar!("SELECT file_id FROM external_chat_file_deletion ORDER BY file_id")
            .fetch_all(&world.pool)
            .await
            .unwrap();
    assert_eq!(released, [first_file, second_file]);

    // Budget: with the day's queries spent, a due check waits, even when a
    // notification says the picture changed, until the budget frees.
    sqlx::query!(
        "INSERT INTO whatsapp_picture_query (account_id, queried_at) SELECT $1, now() FROM generate_series(1, $2::bigint)",
        account,
        PICTURE_QUERIES_PER_DAY
    )
    .execute(&world.pool)
    .await
    .unwrap();
    let queries = world.whatsapp.picture_queries();
    let unchecked = picture(&world.pool, &group).await.unwrap();
    let third_id = world
        .whatsapp
        .set_picture(&world.group, b"new logo".to_vec(), "image/png");
    // The runner has stored the notification (the staged row is due again)
    // and woken the check loop, which finds the budget spent.
    wait_picture(
        &world,
        &group,
        |row| row.state == "due",
        "the change notification makes the group's picture due",
    )
    .await;
    // Every claim first forgets queries older than a day: once this
    // day-old marker is gone, a check cycle claimed while the picture was
    // due, and the spent budget gave it nothing to ask.
    sqlx::query!(
        "INSERT INTO whatsapp_picture_query (account_id, queried_at) VALUES ($1, now() - interval '2 days')",
        account
    )
    .execute(&world.pool)
    .await
    .unwrap();
    let claimed = wait_for_rows(&world.pool, TIMEOUT, || async {
        let markers = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM whatsapp_picture_query
            WHERE account_id = $1 AND queried_at <= now() - interval '1 day'"#,
            account
        )
        .fetch_one(&world.pool)
        .await
        .unwrap();
        (markers == 0).then_some(())
    })
    .await;
    world
        .expect(claimed, "a check cycle claims while the budget is spent")
        .await;
    assert_eq!(
        world.whatsapp.picture_queries(),
        queries,
        "the claiming cycle asks nothing while the budget is spent"
    );
    assert_eq!(
        picture(&world.pool, &group).await.unwrap().state,
        "due",
        "the picture stays due for when the budget frees"
    );
    let freed_at = sqlx::query_scalar!(
        r#"WITH freed AS (DELETE FROM whatsapp_picture_query WHERE account_id = $1)
        SELECT now() AS "now!""#,
        account
    )
    .fetch_one(&world.pool)
    .await
    .unwrap();
    let refreshed = wait_picture(
        &world,
        &group,
        |row| row.picture_id.as_ref() == Some(&third_id),
        "the group's new picture is fetched once the budget frees",
    )
    .await;
    assert!(unchecked.checked_at < refreshed.checked_at);
    assert!(
        refreshed.checked_at >= Some(freed_at),
        "no query ran while the budget was spent"
    );
    assert_eq!(world.whatsapp.picture_queries(), queries + 1);

    replica.drain(TIMEOUT).await.unwrap();
}
