use super::*;

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local contact interaction fixtures"
)]
async fn interactions(lab: &mut Lab) {
    for (inbox, link) in [
        lab.fixture.links[0],
        lab.fixture.links[2],
        lab.fixture.links[1],
        fixture::OUTLOOK,
    ]
    .into_iter()
    .enumerate()
    {
        let thread =
            Uuid::from_u128(0x6000_0000_0000_0000_0000_0000_0000_0000 + inbox as u128 * 100);
        sqlx::query("INSERT INTO email_threads (id,link_id) VALUES ($1,$2)")
            .bind(thread)
            .bind(link)
            .execute(&lab.db)
            .await
            .expect("contact thread");
        for index in 0..4 {
            let contact = Uuid::from_u128(thread.as_u128() + 10 + index);
            let message = Uuid::from_u128(thread.as_u128() + 20 + index);
            lab.transcript
                .normalizer
                .symbol(contact, format!("<contact:{inbox}:{index}>"));
            lab.transcript
                .normalizer
                .symbol(message, format!("<contact-message:{inbox}:{index}>"));
            lab.transcript
                .normalizer
                .symbol(thread, format!("<contact-thread:{inbox}>"));
            sqlx::query("INSERT INTO email_contacts (id,link_id,email_address,name,sfs_photo_url) VALUES ($1,$2,$3,$4,$5)")
                .bind(contact).bind(link).bind(format!("contact-{inbox}-{index}@example.com"))
                .bind((index != 0).then(||format!("Contact {index}"))).bind((index == 1).then_some("https://example.com/photo.png"))
                .execute(&lab.db).await.expect("contact");
            sqlx::query("INSERT INTO email_messages (id,thread_id,link_id,is_sent,internal_date_ts) VALUES ($1,$2,$3,$4,'2026-01-01'::timestamptz + $5 * interval '1 day')")
                .bind(message).bind(thread).bind(link).bind(index != 3).bind(if index==0 {0} else {1})
                .execute(&lab.db).await.expect("interaction message");
            for role in ["TO", "CC", "BCC"] {
                sqlx::query("INSERT INTO email_message_recipients (message_id,contact_id,recipient_type) VALUES ($1,$2,$3::email_recipient_type)")
                    .bind(message).bind(contact).bind(role).execute(&lab.db).await.expect("interaction recipient");
            }
        }
    }
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn contacts_results(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "contacts_results", 41100).await;
    interactions(&mut lab).await;
    for (name, auth) in [
        ("own second delegated and Outlook inboxes", Auth::User(0)),
        ("owner of delegated inbox", Auth::User(1)),
        ("no inboxes", Auth::User(2)),
        ("internal acting user", Auth::Internal),
        ("repeat list", Auth::User(0)),
    ] {
        request(
            &mut lab,
            name,
            "GET",
            CONTACTS,
            auth,
            None,
            json!(null),
            200,
        )
        .await;
    }
    assert_eq!(
        lab.request_with_headers(
            "collection ignores malformed inbox header",
            "GET",
            CONTACTS,
            Auth::User(0),
            RequestBody::Empty,
            &[("x-email-link-id", b"bad")]
        )
        .await,
        200
    );
    lab.transcript.finish();
}
