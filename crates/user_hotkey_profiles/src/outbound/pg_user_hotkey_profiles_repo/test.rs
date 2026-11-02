use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres};

use crate::domain::models::{EmailHotkeyProfile, TasksHotkeyProfile, UserHotkeyProfiles};
use crate::domain::ports::UserHotkeyProfilesRepo;
use crate::outbound::pg_user_hotkey_profiles_repo::PgUserHotkeyProfilesRepo;

fn user(id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("hotkey_profile_users"))
)]
async fn stores_replaces_and_clears_the_profiles(pool: Pool<Postgres>) {
    let repo = PgUserHotkeyProfilesRepo::new(pool);
    let user_id = user("macro|hotkeys@example.com");

    assert_eq!(repo.get_profiles(&user_id).await.unwrap(), None);

    let both = UserHotkeyProfiles {
        email: Some(EmailHotkeyProfile::Superhuman),
        tasks: Some(TasksHotkeyProfile::Linear),
    };
    assert!(repo.set_profiles(&user_id, both).await.unwrap());
    assert_eq!(repo.get_profiles(&user_id).await.unwrap(), Some(both));

    let tasks_only = UserHotkeyProfiles {
        email: None,
        tasks: Some(TasksHotkeyProfile::Linear),
    };
    assert!(repo.set_profiles(&user_id, tasks_only).await.unwrap());
    assert_eq!(repo.get_profiles(&user_id).await.unwrap(), Some(tasks_only));

    let neither = UserHotkeyProfiles {
        email: None,
        tasks: None,
    };
    assert!(repo.set_profiles(&user_id, neither).await.unwrap());
    assert_eq!(repo.get_profiles(&user_id).await.unwrap(), Some(neither));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn missing_user_reads_and_writes_nothing(pool: Pool<Postgres>) {
    let repo = PgUserHotkeyProfilesRepo::new(pool);
    let user_id = user("macro|nobody@example.com");

    assert_eq!(repo.get_profiles(&user_id).await.unwrap(), None);
    assert!(
        !repo
            .set_profiles(
                &user_id,
                UserHotkeyProfiles {
                    email: Some(EmailHotkeyProfile::Superhuman),
                    tasks: None,
                },
            )
            .await
            .unwrap()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("hotkey_profile_users"))
)]
async fn unknown_stored_profile_is_an_error(pool: Pool<Postgres>) {
    sqlx::query!(
        r#"
        INSERT INTO user_hotkey_profiles (user_id, email_profile)
        VALUES ('macro|hotkeys@example.com', 'retired_layout')
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgUserHotkeyProfilesRepo::new(pool);

    assert!(matches!(
        repo.get_profiles(&user("macro|hotkeys@example.com")).await,
        Err(sqlx::Error::ColumnDecode { index, .. }) if index == "email_profile"
    ));
}
