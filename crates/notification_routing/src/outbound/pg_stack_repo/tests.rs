use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;
use crate::domain::models::{StackKind, StackSource};

const OWNER: &str = "macro|stack-owner@example.com";
const OTHER: &str = "macro|stack-other@example.com";

fn user(id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        macro_user_id,
        id,
    )
    .execute(pool)
    .await
    .expect("macro_user should insert");
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        id,
        macro_user_id,
    )
    .execute(pool)
    .await
    .expect("user should insert");
}

fn support_stack(name: &str) -> NewStack {
    NewStack {
        name: name.to_string(),
        capture: vec![StackRule {
            sources: vec![StackSource::ChannelNameContains {
                text: "Macro Support".to_string(),
            }],
            ..Default::default()
        }],
        release: vec![StackRule {
            kinds: vec![StackKind::Mention, StackKind::Reply],
            ..Default::default()
        }],
    }
}

async fn create(repo: &PgStackRepository, owner: &str, name: &str) -> NotificationStack {
    repo.create(
        &user(owner),
        Uuid::now_v7(),
        &support_stack(name),
        NotificationLane::Noise,
        50,
    )
    .await
    .unwrap()
    .expect("under the limit")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stack_is_stored_with_its_rules_after_the_owners_last(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgStackRepository::new(pool);

    let first = create(&repo, OWNER, "Support").await;
    let second = create(&repo, OWNER, "Bots").await;

    assert_eq!((first.position, second.position), (0, 1));
    assert_eq!(first.lane, NotificationLane::Noise);
    assert_eq!(first.revision, 1);
    assert!(first.enabled);
    assert_eq!(first.capture, support_stack("Support").capture);
    assert_eq!(first.release, support_stack("Support").release);
    assert_eq!(repo.list(&user(OWNER)).await.unwrap(), vec![first, second]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stack_past_the_limit_is_not_stored(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    insert_user(&pool, OTHER).await;
    let repo = PgStackRepository::new(pool);
    let limited = |owner: &'static str| {
        let repo = &repo;
        async move {
            repo.create(
                &user(owner),
                Uuid::now_v7(),
                &support_stack("Support"),
                NotificationLane::Noise,
                1,
            )
            .await
            .unwrap()
        }
    };

    assert!(limited(OWNER).await.is_some());
    assert!(limited(OWNER).await.is_none());
    // The limit is each owner's own.
    assert!(limited(OTHER).await.is_some());
    assert_eq!(repo.list(&user(OWNER)).await.unwrap().len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enabled_stacks_are_read_per_owner_in_order(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    insert_user(&pool, OTHER).await;
    let repo = PgStackRepository::new(pool);
    let first = create(&repo, OWNER, "First").await;
    let disabled = create(&repo, OWNER, "Disabled").await;
    let third = create(&repo, OWNER, "Third").await;
    let theirs = create(&repo, OTHER, "Theirs").await;
    repo.update(
        &user(OWNER),
        disabled.id,
        &StackChanges {
            enabled: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let without = "macro|stack-none@example.com";

    let stacks = repo
        .enabled_for(&[user(OWNER), user(OTHER), user(without)])
        .await
        .unwrap();

    assert_eq!(stacks.len(), 2);
    assert_eq!(stacks[&user(OWNER)], vec![first, third]);
    assert_eq!(stacks[&user(OTHER)], vec![theirs]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_edit_keeps_what_it_does_not_name_and_counts_in_the_revision(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let repo = PgStackRepository::new(pool);
    let created = create(&repo, OWNER, "Support").await;
    let mentions_only = vec![StackRule {
        kinds: vec![StackKind::Mention],
        ..Default::default()
    }];

    let renamed = repo
        .update(
            &user(OWNER),
            created.id,
            &StackChanges {
                name: Some("Support channels".to_string()),
                release: Some(mentions_only.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .unwrap();

    assert_eq!(renamed.name, "Support channels");
    assert_eq!(renamed.release, mentions_only);
    assert_eq!(renamed.capture, created.capture);
    assert!(renamed.enabled);
    assert_eq!(renamed.revision, 2);
    assert_eq!(renamed.position, created.position);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn someone_elses_stack_cannot_be_edited_or_deleted(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    insert_user(&pool, OTHER).await;
    let repo = PgStackRepository::new(pool);
    let theirs = create(&repo, OTHER, "Theirs").await;
    let rename = StackChanges {
        name: Some("Mine now".to_string()),
        ..Default::default()
    };

    assert_eq!(
        repo.update(&user(OWNER), theirs.id, &rename).await.unwrap(),
        None
    );
    assert!(!repo.delete(&user(OWNER), theirs.id).await.unwrap());
    assert_eq!(repo.list(&user(OTHER)).await.unwrap(), vec![theirs.clone()]);

    assert!(repo.delete(&user(OTHER), theirs.id).await.unwrap());
    assert!(repo.list(&user(OTHER)).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_order_is_applied_only_when_it_names_each_stack_once(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    insert_user(&pool, OTHER).await;
    let repo = PgStackRepository::new(pool);
    let first = create(&repo, OWNER, "First").await;
    let second = create(&repo, OWNER, "Second").await;
    let third = create(&repo, OWNER, "Third").await;
    let theirs = create(&repo, OTHER, "Theirs").await;
    let names = |stacks: Vec<NotificationStack>| -> Vec<String> {
        stacks.into_iter().map(|stack| stack.name).collect()
    };

    let reordered = repo
        .reorder(&user(OWNER), &[third.id, first.id, second.id])
        .await
        .unwrap()
        .unwrap();
    assert_eq!(names(reordered), ["Third", "First", "Second"]);
    assert_eq!(
        names(repo.list(&user(OWNER)).await.unwrap()),
        ["Third", "First", "Second"]
    );

    let refused = [
        vec![first.id, second.id],
        vec![first.id, second.id, second.id],
        vec![first.id, second.id, theirs.id],
        vec![first.id, second.id, third.id, theirs.id],
    ];
    for order in refused {
        assert_eq!(repo.reorder(&user(OWNER), &order).await.unwrap(), None);
    }
    assert_eq!(
        names(repo.list(&user(OWNER)).await.unwrap()),
        ["Third", "First", "Second"]
    );
    assert_eq!(repo.list(&user(OTHER)).await.unwrap(), vec![theirs]);
}
