use super::*;
use crate::domain::models::ChannelLabelRule;
use cowlike::CowLike;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn all_non_dm_channels_can_be_assigned_without_partial_moves_on_invalid_creation(
    pool: PgPool,
) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let team_id = insert_team(&pool, USER_A).await;
    let other_team_id = insert_team(&pool, USER_B).await;
    let channel = insert_team_channel(&pool, "Support", team_id, USER_A, &[USER_A]).await;
    let other_team =
        insert_team_channel(&pool, "Other support", other_team_id, USER_B, &[USER_A]).await;
    let public = insert_channel(&pool, Some("Public support"), "public", USER_A, &[USER_A]).await;
    let private =
        insert_channel(&pool, Some("Private support"), "private", USER_A, &[USER_A]).await;
    let dm = insert_channel(&pool, None, "direct_message", USER_A, &[USER_A]).await;
    let repo = PgChannelLabelsRepo::new(pool);
    let eligible = [channel, public, private, other_team];
    for scope in [
        ChannelLabelsScope::Team(team_id),
        ChannelLabelsScope::User(user(USER_A).into_owned()),
    ] {
        let original = written(
            repo.create_label(&scope, "Original", &eligible, &user(USER_A), None)
                .await
                .unwrap(),
        );
        assert_eq!(original.channel_count, 4);
        assert_eq!(
            repo.set_channel_label(&scope, dm, Some(original.id), &user(USER_A))
                .await
                .unwrap(),
            SetChannelLabelOutcome::ChannelNotLabelable
        );
        assert_eq!(
            repo.create_label(&scope, "New", &[channel, dm], &user(USER_A), None)
                .await
                .unwrap(),
            LabelWriteOutcome::InvalidChannel(SetChannelLabelOutcome::ChannelNotLabelable)
        );
        assert_eq!(
            repo.list_labels(&scope, &user(USER_A)).await.unwrap(),
            vec![original],
            "invalid creation must not create a label or move the eligible channel"
        );
        let destination = written(
            repo.create_label(&scope, "Destination", &[], &user(USER_A), None)
                .await
                .unwrap(),
        );
        for channel in eligible {
            assert_eq!(
                repo.set_channel_label(&scope, channel, Some(destination.id), &user(USER_A))
                    .await
                    .unwrap(),
                SetChannelLabelOutcome::Updated
            );
        }
        let moved = repo
            .get_label(&scope, destination.id, &user(USER_A))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(moved.channel_count, 4);
        assert_eq!(
            moved.channel_ids,
            vec![other_team, private, public, channel]
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn historical_dms_are_hidden_and_not_counted_but_can_be_removed(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let team_id = insert_team(&pool, USER_A).await;
    let other_team_id = insert_team(&pool, USER_B).await;
    let scope = ChannelLabelsScope::Team(team_id);
    let visible = insert_team_channel(&pool, "Support", team_id, USER_A, &[USER_A]).await;
    let hidden = insert_team_channel(&pool, "Hidden support", team_id, USER_B, &[USER_B]).await;
    let other_team =
        insert_team_channel(&pool, "Other support", other_team_id, USER_B, &[USER_A]).await;
    let public = insert_channel(&pool, Some("Public support"), "public", USER_A, &[USER_A]).await;
    let private =
        insert_channel(&pool, Some("Private support"), "private", USER_A, &[USER_A]).await;
    let dm = insert_channel(&pool, None, "direct_message", USER_A, &[USER_A]).await;
    let repo = PgChannelLabelsRepo::new(pool.clone());
    let manual = written(
        repo.create_label(&scope, "Manual", &[], &user(USER_A), None)
            .await
            .unwrap(),
    );
    let scope_key = scope.key();
    let legacy_channels = [visible, hidden, public, private, dm, other_team];
    sqlx::query!(
        r#"INSERT INTO channel_label_channel (scope_key, channel_id, label_id)
           SELECT $1, channel_id, $2 FROM unnest($3::uuid[]) AS channel_id"#,
        scope_key,
        manual.id,
        &legacy_channels,
    )
    .execute(&pool)
    .await
    .unwrap();

    let listed = repo.list_labels(&scope, &user(USER_A)).await.unwrap();
    assert_eq!(
        listed[0].channel_ids,
        vec![other_team, private, public, visible]
    );
    assert_eq!(
        listed[0].channel_count, 5,
        "count includes eligible hidden channels"
    );
    assert_eq!(
        repo.get_label(&scope, manual.id, &user(USER_A))
            .await
            .unwrap()
            .unwrap(),
        listed[0]
    );

    assert_eq!(
        repo.set_channel_label(&scope, dm, None, &user(USER_A))
            .await
            .unwrap(),
        SetChannelLabelOutcome::Updated
    );
    let remaining = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM channel_label_channel WHERE label_id = $1"#,
        manual.id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        remaining, 5,
        "the historical DM assignment was removed without affecting eligible channels"
    );

    sqlx::query!(
        "UPDATE comms_channels SET channel_type = 'public', team_id = NULL WHERE id = $1",
        visible,
    )
    .execute(&pool)
    .await
    .unwrap();
    let changed = repo
        .get_label(&scope, manual.id, &user(USER_A))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(changed.channel_ids, listed[0].channel_ids);
    assert_eq!(changed.channel_count, 5);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn smart_preview_and_membership_include_all_visible_non_dm_channel_types(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let team_id = insert_team(&pool, USER_A).await;
    let other_team_id = insert_team(&pool, USER_B).await;
    let scope = ChannelLabelsScope::Team(team_id);
    let channel = insert_team_channel(&pool, "Support", team_id, USER_A, &[USER_A]).await;
    let other_team =
        insert_team_channel(&pool, "Other support", other_team_id, USER_B, &[USER_A]).await;
    let public = insert_channel(&pool, Some("Public support"), "public", USER_A, &[USER_A]).await;
    let private =
        insert_channel(&pool, Some("Private support"), "private", USER_A, &[USER_A]).await;
    insert_channel(&pool, None, "direct_message", USER_A, &[USER_A]).await;
    let repo = PgChannelLabelsRepo::new(pool.clone());
    let rule = ChannelLabelRule::Name {
        contains: "support".into(),
    };

    let expected = vec![other_team, private, public, channel];
    for scope in [
        scope.clone(),
        ChannelLabelsScope::User(user(USER_A).into_owned()),
    ] {
        let preview = repo
            .preview_smart_tag(&user(USER_A), &rule, 5)
            .await
            .unwrap();
        let smart = written(
            repo.create_label(&scope, "Support", &[], &user(USER_A), Some(&rule))
                .await
                .unwrap(),
        );
        assert_eq!(
            preview
                .channels
                .iter()
                .map(|matched| matched.id)
                .collect::<Vec<_>>(),
            expected
        );
        assert_eq!(preview.total_count, expected.len() as i64);
        assert_eq!(smart.channel_ids, expected);
        assert_eq!(smart.channel_count, preview.total_count);
    }

    sqlx::query!(
        "UPDATE comms_channels SET team_id = $2 WHERE id = $1",
        channel,
        other_team_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let preview = repo
        .preview_smart_tag(&user(USER_A), &rule, 5)
        .await
        .unwrap();
    let listed = repo.list_labels(&scope, &user(USER_A)).await.unwrap();
    assert_eq!(preview.total_count, 4);
    assert_eq!(listed[0].channel_ids, expected);
    assert_eq!(listed[0].channel_count, 4);
}
