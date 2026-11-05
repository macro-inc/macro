use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::PgAgentSecretsRepo;
use crate::domain::models::{EncryptedSecret, SecretName};
use crate::domain::ports::AgentSecretRepository;

const AGENT: &str = "macro|sam@example.com";

async fn seed_agent(pool: &PgPool) {
    let macro_user_id = Uuid::now_v7();

    sqlx::query(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
    )
    .bind(macro_user_id)
    .bind(AGENT)
    .execute(pool)
    .await
    .expect("macro_user should insert");
    sqlx::query(
        r#"INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ($1, $1, $2, TRUE)"#,
    )
    .bind(AGENT)
    .bind(macro_user_id)
    .execute(pool)
    .await
    .expect("user should insert");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_secret_is_stored_replaced_listed_and_deleted(pool: PgPool) {
    seed_agent(&pool).await;
    let repo = PgAgentSecretsRepo::new(pool.clone());
    let agent = MacroUserIdStr::parse_from_str(AGENT)
        .expect("user id")
        .into_owned();
    let name = SecretName::parse("github-token").expect("name");

    let first = repo
        .upsert(
            &agent,
            &name,
            &EncryptedSecret {
                ciphertext: b"first".to_vec(),
                encryption_version: 1,
                kms_key_id: "key-1".to_string(),
            },
        )
        .await
        .expect("stored");
    let second = repo
        .upsert(
            &agent,
            &name,
            &EncryptedSecret {
                ciphertext: b"second".to_vec(),
                encryption_version: 1,
                kms_key_id: "key-1".to_string(),
            },
        )
        .await
        .expect("replaced");

    assert_eq!(second.name, "github-token");
    assert_eq!(second.created_at, first.created_at);
    assert!(second.updated_at >= first.updated_at);

    let stored = repo
        .get(&agent, &name)
        .await
        .expect("read")
        .expect("stored secret");
    assert_eq!(stored.encrypted.ciphertext, b"second".to_vec());
    assert_eq!(stored.encrypted.kms_key_id, "key-1");

    let listed = repo.list(&agent).await.expect("listed");
    assert_eq!(
        listed
            .iter()
            .map(|secret| secret.name.as_str())
            .collect::<Vec<_>>(),
        vec!["github-token"]
    );

    assert!(repo.delete(&agent, &name).await.expect("deleted"));
    assert!(!repo.delete(&agent, &name).await.expect("deleted again"));
    assert_eq!(repo.get(&agent, &name).await.expect("read"), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_the_account_deletes_its_secrets(pool: PgPool) {
    seed_agent(&pool).await;
    let repo = PgAgentSecretsRepo::new(pool.clone());
    let agent = MacroUserIdStr::parse_from_str(AGENT)
        .expect("user id")
        .into_owned();
    repo.upsert(
        &agent,
        &SecretName::parse("github-token").expect("name"),
        &EncryptedSecret {
            ciphertext: b"secret".to_vec(),
            encryption_version: 1,
            kms_key_id: "key-1".to_string(),
        },
    )
    .await
    .expect("stored");

    sqlx::query(r#"DELETE FROM macro_user WHERE username = $1"#)
        .bind(AGENT)
        .execute(&pool)
        .await
        .expect("account deleted");

    assert_eq!(repo.list(&agent).await.expect("listed"), vec![]);
}
