use super::*;
use item_filters::NotificationState::{Done, Seen, Unseen};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn exact_states_are_viewer_scoped_and_independent_of_read(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link = uuid::uuid!("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    let unseen = uuid::uuid!("20000001-0000-0000-0000-000000000001");
    let seen = uuid::uuid!("20000004-0000-0000-0000-000000000004");
    let done = uuid::uuid!("20000005-0000-0000-0000-000000000005");
    let other = uuid::uuid!("20000007-0000-0000-0000-000000000007");
    let viewer = "macro|user1@test.com";
    for (thread, state, user) in [
        (unseen, Unseen, viewer),
        (seen, Seen, viewer),
        (done, Done, viewer),
        (other, Unseen, "macro|other@test.com"),
    ] {
        let id = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender)
             VALUES ($1, 'new_email', $2, 'email_thread', 'test')",
            id, thread.to_string(),
        ).execute(&pool).await?;
        sqlx::query!(
            "INSERT INTO user_notification (user_id, notification_id, state) VALUES ($1, $2, $3)",
            user,
            id,
            state as _,
        )
        .execute(&pool)
        .await?;
    }
    sqlx::query!(
        "UPDATE email_threads SET is_read = TRUE WHERE id = $1",
        unseen
    )
    .execute(&pool)
    .await?;
    let leaf = |state| Expr::val(EmailLiteral::NotificationState(state));
    let cases = vec![
        (leaf(Unseen), vec![unseen]),
        (leaf(Seen), vec![seen]),
        (leaf(Done), vec![done]),
        (Expr::or(leaf(Unseen), leaf(Seen)), vec![unseen, seen]),
        (Expr::is_not(leaf(Done)), vec![unseen, seen, other]),
        (
            Expr::and(leaf(Unseen), Expr::val(EmailLiteral::Read(true))),
            vec![unseen],
        ),
        (
            Expr::and(leaf(Unseen), Expr::val(EmailLiteral::Read(false))),
            vec![],
        ),
        (
            Expr::and(
                leaf(Unseen),
                Expr::val(EmailLiteral::Sender(Email::Partial("example.com".into()))),
            ),
            vec![unseen],
        ),
    ];
    for (expr, mut expected) in cases {
        let query = Query::new(None, SimpleSortMethod::UpdatedAt, Arc::new(expr));
        let rows = dynamic::dynamic_email_thread_cursor(
            &pool,
            &[link],
            50,
            &PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox),
            query,
            viewer,
            None,
        )
        .await?;
        let mut actual = rows.into_iter().map(|row| row.id).collect::<Vec<_>>();
        actual.sort();
        expected.sort();
        assert_eq!(actual, expected);
    }
    Ok(())
}
