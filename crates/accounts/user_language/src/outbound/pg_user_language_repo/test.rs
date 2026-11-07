use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use model_user::Language;
use sqlx::{Pool, Postgres};

use crate::domain::ports::UserLanguageRepo;
use crate::outbound::pg_user_language_repo::PgUserLanguageRepo;

fn user(id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("language_users"))
)]
async fn stores_and_clears_the_language(pool: Pool<Postgres>) {
    let repo = PgUserLanguageRepo::new(pool);
    let user_id = user("macro|language@test.com");

    assert_eq!(repo.get_language(&user_id).await.unwrap(), Some(None));

    assert!(
        repo.set_language(&user_id, Some(Language::ChineseTraditional))
            .await
            .unwrap()
    );
    assert_eq!(
        repo.get_language(&user_id).await.unwrap(),
        Some(Some(Language::ChineseTraditional))
    );

    assert!(repo.set_language(&user_id, None).await.unwrap());
    assert_eq!(repo.get_language(&user_id).await.unwrap(), Some(None));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn missing_user_reads_and_writes_nothing(pool: Pool<Postgres>) {
    let repo = PgUserLanguageRepo::new(pool);
    let user_id = user("macro|nobody@test.com");

    assert_eq!(repo.get_language(&user_id).await.unwrap(), None);
    assert!(
        !repo
            .set_language(&user_id, Some(Language::French))
            .await
            .unwrap()
    );
}
