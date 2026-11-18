use super::{team_refresh_recipients, teammates_to_refresh};

fn found(users: &[&str]) -> Vec<Option<String>> {
    users.iter().map(|user| Some((*user).to_string())).collect()
}

#[test]
fn an_inbox_refresh_leaves_its_viewers_to_their_own_refresh() {
    let shared_by = [
        "macro|owner@example.com".to_string(),
        "macro|delegate@example.com".to_string(),
    ];

    let recipients = team_refresh_recipients(
        found(&[
            "macro|owner@example.com",
            "macro|delegate@example.com",
            "macro|teammate@example.com",
        ]),
        &shared_by,
        false,
    );

    assert_eq!(recipients, ["macro|teammate@example.com"]);
}

#[test]
fn a_sharing_change_also_refreshes_the_sharer() {
    let shared_by = ["macro|owner@example.com".to_string()];

    let recipients = team_refresh_recipients(
        found(&["macro|owner@example.com", "macro|teammate@example.com"]),
        &shared_by,
        true,
    );

    assert_eq!(
        recipients,
        ["macro|owner@example.com", "macro|teammate@example.com"]
    );
}

async fn insert_user(db: &sqlx::PgPool, id: &str) {
    let macro_user_id = uuid::Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
        macro_user_id,
        id,
        format!("cus_{macro_user_id}"),
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        id,
        macro_user_id,
    )
    .execute(db)
    .await
    .unwrap();
}

/// One team of `members`, each with the sharing setting given, or none.
async fn team(db: &sqlx::PgPool, members: &[(&str, Option<&str>)]) {
    for (member, _) in members {
        insert_user(db, member).await;
    }
    let team_id = uuid::Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)",
        team_id,
        members[0].0,
    )
    .execute(db)
    .await
    .unwrap();
    for (member, sharing) in members {
        sqlx::query!(
            "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')",
            member,
            team_id,
        )
        .execute(db)
        .await
        .unwrap();
        if let Some(sharing) = sharing {
            sqlx::query!(
                "INSERT INTO calendar_team_sharing (user_id, sharing) VALUES ($1, $2)",
                member,
                sharing,
            )
            .execute(db)
            .await
            .unwrap();
        }
    }
}

fn sorted(mut users: Vec<String>) -> Vec<String> {
    users.sort();
    users
}

/// Teammates see nothing of a sharer whose setting is `none`, so that
/// sharer's changes refresh no teammate; anyone else's reach every teammate,
/// including the default for a member who never chose.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_sharer_who_shares_nothing_refreshes_no_teammate(db: sqlx::PgPool) {
    team(
        &db,
        &[
            ("macro|ada@example.com", None),
            ("macro|ben@example.com", Some("all")),
            ("macro|cy@example.com", Some("none")),
        ],
    )
    .await;

    assert_eq!(
        sorted(teammates_to_refresh(&db, &["macro|ada@example.com".to_owned()], false).await),
        ["macro|ben@example.com", "macro|cy@example.com"]
    );
    assert_eq!(
        teammates_to_refresh(&db, &["macro|cy@example.com".to_owned()], false).await,
        Vec::<String>::new()
    );
}

/// Turning sharing off is itself the change teammates must see, so a sharing
/// change reaches every teammate and the sharer whatever the new setting.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_sharing_change_reaches_every_teammate_whatever_the_new_setting(db: sqlx::PgPool) {
    team(
        &db,
        &[
            ("macro|ada@example.com", None),
            ("macro|cy@example.com", Some("none")),
        ],
    )
    .await;

    assert_eq!(
        sorted(teammates_to_refresh(&db, &["macro|cy@example.com".to_owned()], true).await),
        ["macro|ada@example.com", "macro|cy@example.com"]
    );
}
