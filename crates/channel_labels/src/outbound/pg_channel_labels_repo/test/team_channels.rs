use super::*;
use crate::domain::models::ChannelLabelRule;
use cowlike::CowLike;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_eligible_team_channels_can_be_assigned_or_moved_during_creation(pool: PgPool) {
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
    let dm = insert_channel(&pool, None, "direct_message", USER_A, &[USER_A]).await;
    let repo = PgChannelLabelsRepo::new(pool);
    let original = written(
        repo.create_label(&scope, "Original", &[channel], &user(USER_A), None)
            .await
            .unwrap(),
    );

    for invalid in [public, private, dm, other_team] {
        assert_eq!(
            repo.set_channel_label(&scope, invalid, Some(original.id), &user(USER_A))
                .await
                .unwrap(),
            SetChannelLabelOutcome::ChannelNotLabelable
        );
        assert_eq!(
            repo.create_label(&scope, "New", &[channel, invalid], &user(USER_A), None)
                .await
                .unwrap(),
            LabelWriteOutcome::InvalidChannel(SetChannelLabelOutcome::ChannelNotLabelable)
        );
        assert_eq!(
            repo.list_labels(&scope, &user(USER_A)).await.unwrap(),
            vec![original.clone()],
            "invalid creation must not create a label or move the eligible channel"
        );
    }

    let private_scope = ChannelLabelsScope::User(user(USER_A).into_owned());
    let private_label = written(
        repo.create_label(
            &private_scope,
            "Private",
            &[channel, other_team],
            &user(USER_A),
            None,
        )
        .await
        .unwrap(),
    );
    assert_eq!(private_label.channel_count, 2);
    for eligible in [public, private] {
        assert_eq!(
            repo.set_channel_label(
                &private_scope,
                eligible,
                Some(private_label.id),
                &user(USER_A)
            )
            .await
            .unwrap(),
            SetChannelLabelOutcome::Updated
        );
    }
    assert_eq!(
        repo.set_channel_label(&private_scope, dm, Some(private_label.id), &user(USER_A))
            .await
            .unwrap(),
        SetChannelLabelOutcome::ChannelNotLabelable
    );
    let listed = repo
        .list_labels(&private_scope, &user(USER_A))
        .await
        .unwrap();
    assert_eq!(listed[0].channel_count, 4);
    assert_eq!(listed[0].channel_ids.len(), 4);
    assert_eq!(
        repo.list_labels(&scope, &user(USER_A)).await.unwrap()[0],
        original
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_assignments_are_hidden_and_not_counted_but_can_be_removed(pool: PgPool) {
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
    assert_eq!(listed[0].channel_ids, vec![visible]);
    assert_eq!(
        listed[0].channel_count, 2,
        "count includes eligible hidden channels"
    );
    assert_eq!(
        repo.get_label(&scope, manual.id, &user(USER_A))
            .await
            .unwrap()
            .unwrap(),
        listed[0]
    );

    for invalid in [public, private, dm, other_team] {
        assert_eq!(
            repo.set_channel_label(&scope, invalid, None, &user(USER_A))
                .await
                .unwrap(),
            SetChannelLabelOutcome::Updated
        );
    }
    let remaining = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM channel_label_channel WHERE label_id = $1"#,
        manual.id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        remaining, 2,
        "historical ineligible assignments were removed"
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
    assert!(changed.channel_ids.is_empty());
    assert_eq!(changed.channel_count, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn smart_preview_and_membership_include_only_eligible_team_channels(pool: PgPool) {
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

    for (scope, expected) in [
        (scope.clone(), vec![channel]),
        (
            ChannelLabelsScope::User(user(USER_A).into_owned()),
            vec![other_team, private, public, channel],
        ),
    ] {
        let preview = repo
            .preview_smart_tag(&scope, &user(USER_A), &rule, 5)
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
        .preview_smart_tag(&scope, &user(USER_A), &rule, 5)
        .await
        .unwrap();
    let listed = repo.list_labels(&scope, &user(USER_A)).await.unwrap();
    assert!(preview.channels.is_empty());
    assert_eq!(preview.total_count, 0);
    assert!(listed[0].channel_ids.is_empty());
    assert_eq!(listed[0].channel_count, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sections_union_explicit_picks_and_rules_for_unjoined_team_members(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let team = insert_team(&pool, USER_A).await;
    sqlx::query!(
        "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')",
        USER_B,
        team,
    )
    .execute(&pool)
    .await
    .unwrap();
    let picked = insert_team_channel(&pool, "General", team, USER_A, &[USER_A]).await;
    let matched = insert_team_channel(&pool, "Roadmap", team, USER_A, &[USER_A]).await;
    let both = insert_team_channel(&pool, "Roadmap planning", team, USER_A, &[USER_A]).await;
    let scope = ChannelLabelsScope::Team(team);
    let sections = PgChannelLabelsRepo::for_sections(pool.clone());
    let label = written(
        sections
            .create_label(
                &scope,
                "Planning",
                &[picked, both],
                &user(USER_A),
                Some(&ChannelLabelRule::Name {
                    contains: "Roadmap".into(),
                }),
            )
            .await
            .unwrap(),
    );
    assert_eq!(label.explicit_channel_ids, Some(vec![picked, both]));
    let shared = sections.list_labels(&scope, &user(USER_B)).await.unwrap();
    assert_eq!(shared[0].channel_ids.len(), 3);
    assert!(shared[0].channel_ids.contains(&matched));
    assert_eq!(shared[0].explicit_channel_ids, Some(vec![picked, both]));
    assert_eq!(shared[0].channel_count, 3);
    let preview = sections
        .preview_smart_tag(
            &scope,
            &user(USER_B),
            &ChannelLabelRule::Name {
                contains: "Roadmap".into(),
            },
            5,
        )
        .await
        .unwrap();
    assert_eq!(preview.total_count, 2);
    assert!(
        preview
            .channels
            .iter()
            .all(|channel| channel.is_participant == Some(false))
    );

    let legacy = PgChannelLabelsRepo::new(pool);
    let old = legacy.list_labels(&scope, &user(USER_B)).await.unwrap();
    assert!(old[0].channel_ids.is_empty());
    assert_eq!(old[0].explicit_channel_ids, None);
    assert_eq!(
        legacy
            .set_channel_label(&scope, matched, Some(label.id), &user(USER_A))
            .await
            .unwrap(),
        SetChannelLabelOutcome::SmartTagReadOnly
    );
    let old_preview = legacy
        .preview_smart_tag(
            &scope,
            &user(USER_B),
            &ChannelLabelRule::Name {
                contains: "Roadmap".into(),
            },
            5,
        )
        .await
        .unwrap();
    assert_eq!(old_preview.total_count, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sections_reject_cross_team_and_preserve_picks_on_rule_edits_and_transfers(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let team = insert_team(&pool, USER_A).await;
    let other_team = insert_team(&pool, USER_B).await;
    let picked = insert_team_channel(&pool, "General", team, USER_A, &[USER_A]).await;
    let foreign =
        insert_team_channel(&pool, "Roadmap foreign", other_team, USER_B, &[USER_A]).await;
    let scope = ChannelLabelsScope::Team(team);
    let sections = PgChannelLabelsRepo::for_sections(pool);
    let label = written(
        sections
            .create_label(&scope, "Planning", &[picked], &user(USER_A), None)
            .await
            .unwrap(),
    );
    assert_eq!(
        sections
            .set_channel_label(&scope, foreign, Some(label.id), &user(USER_A))
            .await
            .unwrap(),
        SetChannelLabelOutcome::ChannelNotLabelable
    );
    let edited = written(
        sections
            .rename_label(
                &scope,
                label.id,
                "Planning",
                &user(USER_A),
                Some(&ChannelLabelRule::Name {
                    contains: "Roadmap".into(),
                }),
            )
            .await
            .unwrap(),
    );
    assert_eq!(edited.explicit_channel_ids, Some(vec![picked]));
    let personal = ChannelLabelsScope::User(user(USER_A).into_owned());
    let transferred = written(
        sections
            .transfer_label(&scope, &personal, label.id, "Planning", &user(USER_A), None)
            .await
            .unwrap(),
    );
    assert_eq!(transferred.explicit_channel_ids, Some(vec![picked]));
    assert!(transferred.channel_ids.contains(&picked));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn manual_section_transfer_with_new_rule_keeps_picks_separate_from_matches(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let team = insert_team(&pool, USER_A).await;
    let personal = ChannelLabelsScope::User(user(USER_A).into_owned());
    let shared = ChannelLabelsScope::Team(team);
    let picked = insert_team_channel(&pool, "General", team, USER_A, &[USER_A]).await;
    let other_pick = insert_team_channel(&pool, "Design", team, USER_A, &[USER_A]).await;
    let matched = insert_team_channel(&pool, "Roadmap", team, USER_A, &[USER_A]).await;
    let sections = PgChannelLabelsRepo::for_sections(pool.clone());
    let source = written(
        sections
            .create_label(
                &personal,
                "Mine",
                &[picked, other_pick],
                &user(USER_A),
                None,
            )
            .await
            .unwrap(),
    );
    let destination = written(
        sections
            .create_label(&shared, "Existing", &[picked, matched], &user(USER_A), None)
            .await
            .unwrap(),
    );

    let moved = written(
        sections
            .transfer_label(
                &personal,
                &shared,
                source.id,
                "Moved",
                &user(USER_A),
                Some(&ChannelLabelRule::Name {
                    contains: "Roadmap".into(),
                }),
            )
            .await
            .unwrap(),
    );
    assert_eq!(moved.id, source.id);
    assert_eq!(moved.explicit_channel_ids, Some(vec![other_pick, picked]));
    assert_eq!(moved.channel_ids.len(), 3);
    assert!(moved.channel_ids.contains(&matched));
    assert_eq!(
        sections
            .get_label(&shared, destination.id, &user(USER_A))
            .await
            .unwrap()
            .unwrap()
            .explicit_channel_ids,
        Some(vec![matched]),
        "only conflicting explicit picks move to the transferred section"
    );
    let assigned_to = sqlx::query_scalar!(
        "SELECT label_id FROM channel_label_channel WHERE scope_key = $1 AND channel_id = $2",
        shared.key(),
        matched,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        assigned_to, destination.id,
        "rule match stays a derived member"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_section_transfer_rolls_back_source_and_destination_assignments(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let team = insert_team(&pool, USER_A).await;
    let personal = ChannelLabelsScope::User(user(USER_A).into_owned());
    let shared = ChannelLabelsScope::Team(team);
    let picked = insert_team_channel(&pool, "General", team, USER_A, &[USER_A]).await;
    let sections = PgChannelLabelsRepo::for_sections(pool.clone());
    let source = written(
        sections
            .create_label(&personal, "Mine", &[picked], &user(USER_A), None)
            .await
            .unwrap(),
    );
    let destination = written(
        sections
            .create_label(&shared, "Taken", &[picked], &user(USER_A), None)
            .await
            .unwrap(),
    );

    assert_eq!(
        sections
            .transfer_label(
                &personal,
                &shared,
                source.id,
                "Taken",
                &user(USER_A),
                Some(&ChannelLabelRule::Name {
                    contains: "General".into(),
                }),
            )
            .await
            .unwrap(),
        LabelWriteOutcome::NameTaken
    );
    let original = sections
        .get_label(&personal, source.id, &user(USER_A))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(original.explicit_channel_ids, Some(vec![picked]));
    assert_eq!(original.rule, None);
    assert!(
        sections
            .get_label(&shared, source.id, &user(USER_A))
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        sections
            .get_label(&shared, destination.id, &user(USER_A))
            .await
            .unwrap()
            .unwrap()
            .explicit_channel_ids,
        Some(vec![picked])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unjoined_assignments_require_team_membership_and_never_enter_personal_scope(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let team = insert_team(&pool, USER_A).await;
    let channel = insert_team_channel(&pool, "Shared", team, USER_A, &[USER_A]).await;
    let scope = ChannelLabelsScope::Team(team);
    let personal = ChannelLabelsScope::User(user(USER_B).into_owned());
    let sections = PgChannelLabelsRepo::for_sections(pool.clone());
    let label = written(
        sections
            .create_label(&scope, "Shared", &[], &user(USER_A), None)
            .await
            .unwrap(),
    );
    assert_eq!(
        sections
            .set_channel_label(&scope, channel, Some(label.id), &user(USER_B))
            .await
            .unwrap(),
        SetChannelLabelOutcome::ChannelNotFound
    );
    sqlx::query!(
        "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')",
        USER_B,
        team,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        sections
            .set_channel_label(&scope, channel, Some(label.id), &user(USER_B))
            .await
            .unwrap(),
        SetChannelLabelOutcome::Updated
    );
    assert_eq!(
        sections
            .set_channel_label(&personal, channel, None, &user(USER_B))
            .await
            .unwrap(),
        SetChannelLabelOutcome::ChannelNotFound
    );
    assert_eq!(
        sections
            .set_channel_label(&scope, channel, None, &user(USER_B))
            .await
            .unwrap(),
        SetChannelLabelOutcome::Updated
    );
    let legacy = PgChannelLabelsRepo::new(pool);
    assert_eq!(
        legacy
            .set_channel_label(&scope, channel, Some(label.id), &user(USER_B))
            .await
            .unwrap(),
        SetChannelLabelOutcome::ChannelNotFound
    );
}
