use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::PgChannelLabelsRepo;
use crate::domain::models::{ChannelLabelsScope, LabelWriteOutcome, SetChannelLabelOutcome};
use crate::domain::ports::ChannelLabelsRepo;

mod team_channels;

const USER_A: &str = "macro|labels-a@macro.com";
const USER_B: &str = "macro|labels-b@macro.com";

fn user(id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
    )
    .bind(macro_user_id)
    .bind(id)
    .execute(pool)
    .await
    .expect("macro_user should insert");
    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#)
        .bind(id)
        .bind(macro_user_id)
        .execute(pool)
        .await
        .expect("user should insert");
}

async fn insert_team(pool: &PgPool, owner: &str) -> Uuid {
    let team_id = Uuid::now_v7();
    sqlx::query(r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'GTM', $2)"#)
        .bind(team_id)
        .bind(owner)
        .execute(pool)
        .await
        .expect("team should insert");
    sqlx::query(r#"INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'owner')"#)
        .bind(owner)
        .bind(team_id)
        .execute(pool)
        .await
        .expect("team_user should insert");
    team_id
}

async fn insert_channel(
    pool: &PgPool,
    name: Option<&str>,
    channel_type: &str,
    owner: &str,
    participants: &[&str],
) -> Uuid {
    insert_channel_with_team(pool, name, channel_type, None, owner, participants).await
}

async fn insert_team_channel(
    pool: &PgPool,
    name: &str,
    team_id: Uuid,
    owner: &str,
    participants: &[&str],
) -> Uuid {
    insert_channel_with_team(pool, Some(name), "team", Some(team_id), owner, participants).await
}

async fn insert_channel_with_team(
    pool: &PgPool,
    name: Option<&str>,
    channel_type: &str,
    team_id: Option<Uuid>,
    owner: &str,
    participants: &[&str],
) -> Uuid {
    let channel_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO comms_channels (id, name, channel_type, owner_id, team_id)
           VALUES ($1, $2, $3::text::comms_channel_type, $4, $5)"#,
        channel_id,
        name,
        channel_type,
        owner,
        team_id,
    )
    .execute(pool)
    .await
    .expect("channel should insert");
    for participant in participants {
        sqlx::query!(
            r#"INSERT INTO comms_channel_participants (channel_id, role, user_id)
               VALUES ($1, 'member', $2)"#,
            channel_id,
            participant,
        )
        .execute(pool)
        .await
        .expect("participant should insert");
    }
    channel_id
}

fn written(outcome: LabelWriteOutcome) -> crate::domain::models::ChannelLabel {
    match outcome {
        LabelWriteOutcome::Written(label) => label,
        other => panic!("expected a written label, got {other:?}"),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_appends_in_order_and_rejects_duplicate_names(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let team_id = insert_team(&pool, USER_A).await;
    let repo = PgChannelLabelsRepo::new(pool);

    let first = written(
        repo.create_label(
            &ChannelLabelsScope::Team(team_id),
            "Enterprise",
            &[],
            &user(USER_A),
            None,
        )
        .await
        .expect("first label should insert"),
    );
    let second = written(
        repo.create_label(
            &ChannelLabelsScope::Team(team_id),
            "SMB",
            &[],
            &user(USER_A),
            None,
        )
        .await
        .expect("second label should insert"),
    );
    assert!(first.sort_order < second.sort_order);
    assert_eq!(first.channel_ids, Vec::<Uuid>::new());
    assert_eq!(first.channel_count, 0);

    let duplicate = repo
        .create_label(
            &ChannelLabelsScope::Team(team_id),
            "enterprise",
            &[],
            &user(USER_A),
            None,
        )
        .await
        .expect("duplicate should not error");
    assert_eq!(duplicate, LabelWriteOutcome::NameTaken);

    let listed = repo
        .list_labels(&ChannelLabelsScope::Team(team_id), &user(USER_A))
        .await
        .expect("labels should list");
    assert_eq!(
        listed.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(),
        ["Enterprise", "SMB"]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn labels_are_team_scoped(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let team_a = insert_team(&pool, USER_A).await;
    let team_b = insert_team(&pool, USER_B).await;
    let repo = PgChannelLabelsRepo::new(pool);

    let label = written(
        repo.create_label(
            &ChannelLabelsScope::Team(team_a),
            "Enterprise",
            &[],
            &user(USER_A),
            None,
        )
        .await
        .expect("label should insert"),
    );

    assert!(
        repo.list_labels(&ChannelLabelsScope::Team(team_b), &user(USER_B))
            .await
            .expect("labels should list")
            .is_empty()
    );
    assert_eq!(
        repo.rename_label(
            &ChannelLabelsScope::Team(team_b),
            label.id,
            "Stolen",
            &user(USER_B),
            None
        )
        .await
        .expect("rename should not error"),
        LabelWriteOutcome::NotFound
    );
    assert!(
        !repo
            .delete_label(&ChannelLabelsScope::Team(team_b), label.id)
            .await
            .expect("delete should not error")
    );
    assert!(
        repo.delete_label(&ChannelLabelsScope::Team(team_a), label.id)
            .await
            .expect("delete should not error")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rename_reports_conflicts_and_missing_labels(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let team_id = insert_team(&pool, USER_A).await;
    let repo = PgChannelLabelsRepo::new(pool);

    let enterprise = written(
        repo.create_label(
            &ChannelLabelsScope::Team(team_id),
            "Enterprise",
            &[],
            &user(USER_A),
            None,
        )
        .await
        .expect("label should insert"),
    );
    written(
        repo.create_label(
            &ChannelLabelsScope::Team(team_id),
            "SMB",
            &[],
            &user(USER_A),
            None,
        )
        .await
        .expect("label should insert"),
    );

    let renamed = written(
        repo.rename_label(
            &ChannelLabelsScope::Team(team_id),
            enterprise.id,
            "Enterprise support",
            &user(USER_A),
            None,
        )
        .await
        .expect("rename should succeed"),
    );
    assert_eq!(renamed.name, "Enterprise support");
    assert!(renamed.updated_at >= enterprise.updated_at);

    assert_eq!(
        repo.rename_label(
            &ChannelLabelsScope::Team(team_id),
            enterprise.id,
            "smb",
            &user(USER_A),
            None
        )
        .await
        .expect("rename should not error"),
        LabelWriteOutcome::NameTaken
    );
    assert_eq!(
        repo.rename_label(
            &ChannelLabelsScope::Team(team_id),
            Uuid::now_v7(),
            "Anything",
            &user(USER_A),
            None
        )
        .await
        .expect("rename should not error"),
        LabelWriteOutcome::NotFound
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channels_in_a_label_are_viewer_relative_and_sorted_by_name(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let team_id = insert_team(&pool, USER_A).await;
    let shared =
        insert_team_channel(&pool, "zeta-support", team_id, USER_A, &[USER_A, USER_B]).await;
    let only_a = insert_team_channel(&pool, "acme-support", team_id, USER_A, &[USER_A]).await;
    let only_b = insert_team_channel(&pool, "beta-support", team_id, USER_B, &[USER_B]).await;
    let repo = PgChannelLabelsRepo::new(pool);

    let label = written(
        repo.create_label(
            &ChannelLabelsScope::Team(team_id),
            "Enterprise",
            &[],
            &user(USER_A),
            None,
        )
        .await
        .expect("label should insert"),
    );
    for channel in [shared, only_a] {
        assert_eq!(
            repo.set_channel_label(
                &ChannelLabelsScope::Team(team_id),
                channel,
                Some(label.id),
                &user(USER_A)
            )
            .await
            .expect("set should not error"),
            SetChannelLabelOutcome::Updated
        );
    }
    // B labels a channel A cannot see.
    assert_eq!(
        repo.set_channel_label(
            &ChannelLabelsScope::Team(team_id),
            only_b,
            Some(label.id),
            &user(USER_B)
        )
        .await
        .expect("set should not error"),
        SetChannelLabelOutcome::Updated
    );

    let for_a = repo
        .get_label(&ChannelLabelsScope::Team(team_id), label.id, &user(USER_A))
        .await
        .expect("label should load")
        .expect("label should exist");
    assert_eq!(for_a.channel_ids, vec![only_a, shared], "A→Z by name");
    assert_eq!(
        for_a.channel_count, 3,
        "count includes channels A cannot see"
    );

    let for_b = repo
        .get_label(&ChannelLabelsScope::Team(team_id), label.id, &user(USER_B))
        .await
        .expect("label should load")
        .expect("label should exist");
    assert_eq!(for_b.channel_ids, vec![only_b, shared]);

    // Removing from the label and deleting the label both unlabel channels.
    assert_eq!(
        repo.set_channel_label(
            &ChannelLabelsScope::Team(team_id),
            shared,
            None,
            &user(USER_A)
        )
        .await
        .expect("set should not error"),
        SetChannelLabelOutcome::Updated
    );
    assert!(
        repo.delete_label(&ChannelLabelsScope::Team(team_id), label.id)
            .await
            .expect("delete should not error")
    );
    let labelled: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM channel_label_channel"#)
        .fetch_one(&repo.pool)
        .await
        .expect("count should load");
    assert_eq!(labelled, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_channel_label_rejects_invisible_channels_dms_and_foreign_labels(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let team_a = insert_team(&pool, USER_A).await;
    let team_b = insert_team(&pool, USER_B).await;
    let only_b = insert_team_channel(&pool, "beta-support", team_b, USER_B, &[USER_B]).await;
    let dm = insert_channel(&pool, None, "direct_message", USER_A, &[USER_A, USER_B]).await;
    let mine = insert_team_channel(&pool, "acme-support", team_a, USER_A, &[USER_A]).await;
    let repo = PgChannelLabelsRepo::new(pool);

    let label_a = written(
        repo.create_label(
            &ChannelLabelsScope::Team(team_a),
            "Enterprise",
            &[],
            &user(USER_A),
            None,
        )
        .await
        .expect("label should insert"),
    );
    let label_b = written(
        repo.create_label(
            &ChannelLabelsScope::Team(team_b),
            "Theirs",
            &[],
            &user(USER_B),
            None,
        )
        .await
        .expect("label should insert"),
    );

    assert_eq!(
        repo.set_channel_label(
            &ChannelLabelsScope::Team(team_a),
            only_b,
            Some(label_a.id),
            &user(USER_A)
        )
        .await
        .expect("set should not error"),
        SetChannelLabelOutcome::ChannelNotFound
    );
    assert_eq!(
        repo.set_channel_label(
            &ChannelLabelsScope::Team(team_a),
            dm,
            Some(label_a.id),
            &user(USER_A)
        )
        .await
        .expect("set should not error"),
        SetChannelLabelOutcome::ChannelNotLabelable
    );
    assert_eq!(
        repo.set_channel_label(
            &ChannelLabelsScope::Team(team_a),
            mine,
            Some(label_b.id),
            &user(USER_A)
        )
        .await
        .expect("set should not error"),
        SetChannelLabelOutcome::LabelNotFound
    );
    assert_eq!(
        repo.set_channel_label(
            &ChannelLabelsScope::Team(team_a),
            Uuid::now_v7(),
            None,
            &user(USER_A)
        )
        .await
        .expect("set should not error"),
        SetChannelLabelOutcome::ChannelNotFound
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn private_and_team_assignments_do_not_overwrite_each_other(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let team_id = insert_team(&pool, USER_A).await;
    let team = ChannelLabelsScope::Team(team_id);
    let a = ChannelLabelsScope::User(MacroUserIdStr::try_from(USER_A.to_owned()).unwrap());
    let b = ChannelLabelsScope::User(MacroUserIdStr::try_from(USER_B.to_owned()).unwrap());
    let channel = insert_team_channel(&pool, "Shared", team_id, USER_A, &[USER_A, USER_B]).await;
    let repo = PgChannelLabelsRepo::new(pool);
    let team_label = written(
        repo.create_label(&team, "Group", &[channel], &user(USER_A), None)
            .await
            .unwrap(),
    );
    let private_a = written(
        repo.create_label(&a, "Group", &[channel], &user(USER_A), None)
            .await
            .unwrap(),
    );
    let private_b = written(
        repo.create_label(&b, "Group", &[channel], &user(USER_B), None)
            .await
            .unwrap(),
    );
    assert_eq!(private_a.team_id, None);
    assert_eq!(private_b.team_id, None);
    assert_eq!(
        repo.list_labels(&a, &user(USER_A)).await.unwrap(),
        vec![private_a.clone()]
    );
    assert_eq!(
        repo.set_channel_label(&b, channel, Some(private_a.id), &user(USER_B))
            .await
            .unwrap(),
        SetChannelLabelOutcome::LabelNotFound
    );
    assert!(!repo.delete_label(&b, private_a.id).await.unwrap());
    repo.set_channel_label(&a, channel, None, &user(USER_A))
        .await
        .unwrap();
    assert_eq!(
        repo.get_label(&team, team_label.id, &user(USER_A))
            .await
            .unwrap()
            .unwrap()
            .channel_ids,
        vec![channel]
    );
    assert_eq!(
        repo.get_label(&b, private_b.id, &user(USER_B))
            .await
            .unwrap()
            .unwrap()
            .channel_ids,
        vec![channel]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_with_invalid_channel_leaves_no_partial_label_or_moves(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let scope = ChannelLabelsScope::User(MacroUserIdStr::try_from(USER_A.to_owned()).unwrap());
    let team_id = insert_team(&pool, USER_A).await;
    let channel = insert_team_channel(&pool, "Mine", team_id, USER_A, &[USER_A]).await;
    let dm = insert_channel(&pool, None, "direct_message", USER_A, &[USER_A]).await;
    let repo = PgChannelLabelsRepo::new(pool);
    let original = written(
        repo.create_label(&scope, "Original", &[channel], &user(USER_A), None)
            .await
            .unwrap(),
    );
    for invalid in [dm, Uuid::now_v7()] {
        let outcome = repo
            .create_label(
                &scope,
                "New group",
                &[channel, invalid],
                &user(USER_A),
                None,
            )
            .await
            .unwrap();
        assert!(matches!(outcome, LabelWriteOutcome::InvalidChannel(_)));
        assert_eq!(
            repo.list_labels(&scope, &user(USER_A)).await.unwrap(),
            vec![original.clone()]
        );
    }
    let created = written(
        repo.create_label(&scope, "New group", &[channel], &user(USER_A), None)
            .await
            .unwrap(),
    );
    assert_eq!(created.channel_ids, vec![channel]);
    assert_eq!(
        repo.get_label(&scope, original.id, &user(USER_A))
            .await
            .unwrap()
            .unwrap()
            .channel_count,
        0
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn smart_tags_overlap_manual_groups_and_follow_channel_changes(pool: PgPool) {
    use crate::domain::models::ChannelLabelRule;
    insert_user(&pool, USER_A).await;
    let scope = ChannelLabelsScope::User(MacroUserIdStr::try_from(USER_A.to_owned()).unwrap());
    let repo = PgChannelLabelsRepo::new(pool.clone());
    let team_id = insert_team(&pool, USER_A).await;
    let channel = insert_team_channel(&pool, "Acme SUPPORT", team_id, USER_A, &[USER_A]).await;
    let manual = written(
        repo.create_label(&scope, "Manual", &[channel], &user(USER_A), None)
            .await
            .unwrap(),
    );
    let support_rule = ChannelLabelRule::Name {
        contains: "support".into(),
    };
    let acme_rule = ChannelLabelRule::Name {
        contains: "acme".into(),
    };
    let support = written(
        repo.create_label(&scope, "Support", &[], &user(USER_A), Some(&support_rule))
            .await
            .unwrap(),
    );
    let acme = written(
        repo.create_label(&scope, "Acme", &[], &user(USER_A), Some(&acme_rule))
            .await
            .unwrap(),
    );
    for label in [&manual, &support, &acme] {
        assert_eq!(label.channel_ids, vec![channel]);
    }
    assert_eq!(
        repo.set_channel_label(&scope, channel, Some(support.id), &user(USER_A))
            .await
            .unwrap(),
        SetChannelLabelOutcome::SmartTagReadOnly
    );
    let renamed = written(
        repo.rename_label(
            &scope,
            acme.id,
            "Sales",
            &user(USER_A),
            Some(&ChannelLabelRule::Name {
                contains: "sales".into(),
            }),
        )
        .await
        .unwrap(),
    );
    assert!(renamed.channel_ids.is_empty());
    sqlx::query!(
        "UPDATE comms_channels SET name = 'Acme sales' WHERE id = $1",
        channel
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        repo.get_label(&scope, support.id, &user(USER_A))
            .await
            .unwrap()
            .unwrap()
            .channel_ids
            .is_empty()
    );
    assert_eq!(
        repo.get_label(&scope, acme.id, &user(USER_A))
            .await
            .unwrap()
            .unwrap()
            .channel_ids,
        vec![channel]
    );
    let added = insert_team_channel(&pool, "New support", team_id, USER_A, &[USER_A]).await;
    assert_eq!(
        repo.get_label(&scope, support.id, &user(USER_A))
            .await
            .unwrap()
            .unwrap()
            .channel_ids,
        vec![added]
    );
    repo.delete_label(&scope, support.id).await.unwrap();
    assert_eq!(
        repo.get_label(&scope, manual.id, &user(USER_A))
            .await
            .unwrap()
            .unwrap()
            .channel_ids,
        vec![channel]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn smart_preview_is_bounded_literal_and_respects_membership(pool: PgPool) {
    use crate::domain::models::ChannelLabelRule;
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let team_id = insert_team(&pool, USER_A).await;
    let repo = PgChannelLabelsRepo::new(pool.clone());
    let rule = ChannelLabelRule::Name {
        contains: "support".into(),
    };
    for n in 0..8 {
        insert_team_channel(&pool, &format!("SUPPORT {n}"), team_id, USER_A, &[USER_A]).await;
    }
    insert_team_channel(&pool, "support hidden", team_id, USER_B, &[USER_B]).await;
    insert_channel(&pool, None, "direct_message", USER_A, &[USER_A]).await;
    let left = insert_team_channel(&pool, "support left", team_id, USER_A, &[USER_A]).await;
    sqlx::query!(
        "UPDATE comms_channel_participants SET left_at = now() WHERE channel_id = $1",
        left
    )
    .execute(&pool)
    .await
    .unwrap();
    let preview = repo
        .preview_smart_tag(&ChannelLabelsScope::Team(team_id), &user(USER_A), &rule, 5)
        .await
        .unwrap();
    assert_eq!(preview.total_count, 8);
    assert_eq!(preview.channels.len(), 5);
    assert_eq!(preview.channels[0].name, "SUPPORT 0");
    let saved = written(
        repo.create_label(
            &ChannelLabelsScope::Team(team_id),
            "Support",
            &[],
            &user(USER_A),
            Some(&rule),
        )
        .await
        .unwrap(),
    );
    assert_eq!(saved.channel_ids.len(), 8);
    assert_eq!(saved.channel_count, 8);
    let literal = insert_team_channel(&pool, "100%_support", team_id, USER_A, &[USER_A]).await;
    let literal_rule = ChannelLabelRule::Name {
        contains: "%_".into(),
    };
    let literal_preview = repo
        .preview_smart_tag(
            &ChannelLabelsScope::Team(team_id),
            &user(USER_A),
            &literal_rule,
            5,
        )
        .await
        .unwrap();
    assert_eq!(literal_preview.total_count, 1);
    assert_eq!(literal_preview.channels[0].id, literal);
    let empty = repo
        .preview_smart_tag(
            &ChannelLabelsScope::Team(team_id),
            &user(USER_B),
            &literal_rule,
            5,
        )
        .await
        .unwrap();
    assert_eq!(empty.total_count, 0);
    assert!(empty.channels.is_empty());
}
