use super::*;
use item_filters::NotificationState::{Done, Seen, Unseen};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn notification_boolean_filters_match_every_present_state_set(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool.clone());
    let user = "macro|user@example.com";
    let mut ids = Vec::new();
    for present in 0..8 {
        let entity = insert_foreign_entity_for_source(
            &repo,
            &format!("pr-{present}"),
            "github_pull_request",
            user,
            "user",
        )
        .await;
        ids.push(entity.id);
        for (bit, done, seen) in [(1, false, false), (2, false, true), (4, true, true)] {
            if present & bit != 0 {
                insert_foreign_entity_notification(&pool, entity.id, user, done, seen).await;
            }
        }
    }
    // Neither another user's notification nor a deleted row may affect our set.
    insert_foreign_entity_notification(&pool, ids[0], "macro|other@example.com", true, true).await;
    insert_foreign_entity_notification(&pool, ids[0], user, false, true).await;
    sqlx::query!(
        "UPDATE user_notification un SET deleted_at = NOW() FROM notification n
         WHERE un.notification_id = n.id AND n.event_item_id = $1 AND un.user_id = $2",
        ids[0].to_string(),
        user,
    )
    .execute(&pool)
    .await
    .unwrap();

    let leaf = |state| Expr::val(ForeignEntityLiteral::NotificationState(state));
    let cases: Vec<(_, fn(u8) -> bool)> = vec![
        (leaf(Unseen), |set| set & 1 != 0),
        (leaf(Seen), |set| set & 2 != 0),
        (leaf(Done), |set| set & 4 != 0),
        (Expr::or(leaf(Unseen), leaf(Seen)), |set| set & 3 != 0),
        (Expr::and(leaf(Unseen), leaf(Done)), |set| {
            set & 1 != 0 && set & 4 != 0
        }),
        (Expr::is_not(leaf(Done)), |set| set & 4 == 0),
        (Expr::is_not(Expr::and(leaf(Unseen), leaf(Seen))), |set| {
            set & 3 != 3
        }),
    ];
    for (expr, matches) in cases {
        let mut actual = repo
            .get_foreign_entities_for_user(
                Some(user.to_owned()),
                vec![SourceId::user(user)],
                100,
                filter_query(Some(Arc::new(expr))),
            )
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.id)
            .collect::<Vec<_>>();
        let mut expected = ids
            .iter()
            .enumerate()
            .filter_map(|(set, id)| matches(set as u8).then_some(*id))
            .collect::<Vec<_>>();
        actual.sort();
        expected.sort();
        assert_eq!(actual, expected);
    }
    let missing_viewer = repo
        .get_foreign_entities_for_user(
            None,
            vec![SourceId::user(user)],
            100,
            filter_query(Some(Arc::new(Expr::is_not(leaf(Done))))),
        )
        .await
        .unwrap();
    assert!(missing_viewer.is_empty());
}

#[test]
fn mixed_subtrees_cannot_be_misclassified_by_boolean_short_circuiting() {
    let state = || Expr::val(ForeignEntityLiteral::NotificationState(Done));
    let impossible = Expr::and(state(), Expr::is_not(state()));
    let mixed = Expr::and(impossible, Expr::val(ForeignEntityLiteral::Id(Uuid::nil())));
    assert!(super::super::notification_truth_table(&mixed).is_none());
}
