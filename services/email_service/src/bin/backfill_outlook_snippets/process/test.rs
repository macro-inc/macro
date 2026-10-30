use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const OUTLOOK_LINK: Uuid = uuid::uuid!("0190a000-0000-7000-8000-000000000001");
const GMAIL_LINK: Uuid = uuid::uuid!("0190a000-0000-7000-8000-000000000002");

const QUOTED_PREVIEW: &str =
    "Tell sam I said hello From: Riley Sent: Tuesday To: Sam Subject: Hello Original message";

async fn seed(db: &PgPool) {
    let thread = uuid::uuid!("0190a000-0000-7000-8000-0000000000a1");
    let gmail_thread = uuid::uuid!("0190a000-0000-7000-8000-0000000000a2");
    sqlx::query!(
        "INSERT INTO email_links(id,macro_id,fusionauth_user_id,email_address,provider) VALUES ($1,'macro|outlook@example.com','outlook','outlook@example.com','OUTLOOK'),($2,'macro|gmail@example.com','gmail','gmail@example.com','GMAIL')",
        OUTLOOK_LINK,
        GMAIL_LINK
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_threads(id,link_id) VALUES ($1,$2),($3,$4)",
        thread,
        OUTLOOK_LINK,
        gmail_thread,
        GMAIL_LINK
    )
    .execute(db)
    .await
    .unwrap();
    let reply_html = email_utils::sanitize_email_html(concat!(
        "<html><body><div>Tell sam   I said\nhello</div>",
        "<div id=\"appendonsend\"></div><hr><div id=\"divRplyFwdMsg\">",
        "<b>From:</b> Riley<br><b>Sent:</b> Tuesday<br><b>To:</b> Sam<br>",
        "<b>Subject:</b> Hello</div><div>Original message</div></body></html>"
    ));
    let reply_text = "Tell sam I said hello\n**From:** Riley\n**Sent:** Tuesday\n**To:** Sam\n**Subject:** Hello\nOriginal message";
    for (link, thread, provider_id, is_draft, html, text, snippet) in [
        (
            OUTLOOK_LINK,
            thread,
            Some("outlook-html-reply"),
            false,
            Some(reply_html.as_str()),
            Some(reply_text),
            Some(QUOTED_PREVIEW),
        ),
        (
            OUTLOOK_LINK,
            thread,
            Some("outlook-text-reply"),
            false,
            None,
            Some(
                "Me too\n\nOn Tue, Oct 20, 2026 at 3:00 PM Riley <riley@example.com> wrote:\n> God I love outlook",
            ),
            Some(
                "Me too On Tue, Oct 20, 2026 at 3:00 PM Riley <riley@example.com> wrote: > God I love outlook",
            ),
        ),
        (
            OUTLOOK_LINK,
            thread,
            Some("outlook-no-body"),
            false,
            None,
            None,
            Some("Graph preview kept"),
        ),
        (
            OUTLOOK_LINK,
            thread,
            None,
            true,
            Some("<div>Draft Outlook has not seen</div>"),
            Some("Draft Outlook has not seen"),
            None,
        ),
        (
            GMAIL_LINK,
            gmail_thread,
            Some("gmail-reply"),
            false,
            Some(reply_html.as_str()),
            Some(reply_text),
            Some(QUOTED_PREVIEW),
        ),
    ] {
        sqlx::query!(
            "INSERT INTO email_messages(id,link_id,thread_id,provider_id,is_draft,subject,body_html_sanitized,body_text,snippet) VALUES($1,$2,$3,$4,$5,'RE: Hello',$6,$7,$8)",
            Uuid::now_v7(),
            link,
            thread,
            provider_id,
            is_draft,
            html,
            text,
            snippet
        )
        .execute(db)
        .await
        .unwrap();
    }
}

async fn snippets(db: &PgPool) -> Vec<(Option<String>, Option<String>)> {
    sqlx::query!("SELECT provider_id, snippet FROM email_messages ORDER BY provider_id NULLS FIRST")
        .fetch_all(db)
        .await
        .unwrap()
        .into_iter()
        .map(|row| (row.provider_id, row.snippet))
        .collect()
}

async fn run(db: &PgPool, mode: Mode) -> Vec<(Uuid, u64)> {
    backfill(db, None, 1, mode)
        .await
        .unwrap()
        .into_iter()
        .map(|(link, result)| (link, result.unwrap()))
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rewrites_only_outlook_replies_that_have_a_body(db: PgPool) {
    seed(&db).await;

    assert_eq!(run(&db, Mode::Apply).await, vec![(OUTLOOK_LINK, 2)]);

    assert_eq!(
        snippets(&db).await,
        vec![
            (None, None),
            (Some("gmail-reply".into()), Some(QUOTED_PREVIEW.into())),
            (
                Some("outlook-html-reply".into()),
                Some("Tell sam I said hello".into())
            ),
            (
                Some("outlook-no-body".into()),
                Some("Graph preview kept".into())
            ),
            (Some("outlook-text-reply".into()), Some("Me too".into())),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn verify_counts_stale_snippets_without_writing(db: PgPool) {
    seed(&db).await;
    let before = snippets(&db).await;

    assert_eq!(run(&db, Mode::Verify).await, vec![(OUTLOOK_LINK, 2)]);

    assert_eq!(snippets(&db).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_second_run_changes_nothing(db: PgPool) {
    seed(&db).await;
    assert_eq!(run(&db, Mode::Apply).await, vec![(OUTLOOK_LINK, 2)]);
    let after_first = snippets(&db).await;

    assert_eq!(run(&db, Mode::Apply).await, vec![(OUTLOOK_LINK, 0)]);
    assert_eq!(run(&db, Mode::Verify).await, vec![(OUTLOOK_LINK, 0)]);

    assert_eq!(snippets(&db).await, after_first);
}
