use super::*;
use crate::domain::ports::SecretProvider;
use crate::{
    domain::service::{PasswordService, test::fakes::FakeAvailability},
    outbound::{openbao::OpenBaoProvider, postgres::test::folder_fixture},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::process::Command;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "requires explicit disposable local OpenBao and bootstrap signing key"]
#[expect(
    clippy::disallowed_methods,
    reason = "disposable integration fixture requires explicit local provider configuration"
)]
async fn real_import_retries_preserve_provider_version_folder_grants_and_totp(pool: PgPool) {
    let (repository, actor, record) = folder_fixture(pool.clone()).await;
    let team = record.metadata.team_id;
    let address =
        std::env::var("PASSWORDS_TEST_OPENBAO_ADDRESS").expect("explicit disposable address");
    let key_path = std::env::var("PASSWORDS_TEST_OPENBAO_SIGNING_KEY").expect("synthetic key path");
    let public_key_path =
        std::env::var("PASSWORDS_TEST_OPENBAO_PUBLIC_KEY").expect("synthetic public key path");
    assert!(
        Command::new("python3")
            .args([
                "../../infra/local/openbao/bootstrap.py",
                "--address",
                &address,
                "--team-id",
                &team.0.to_string(),
                "--jwt-public-key",
                &public_key_path,
                "--jwt-issuer",
                "macro-local-passwords",
            ])
            .status()
            .expect("bootstrap")
            .success()
    );
    let provider = Arc::new(
        OpenBaoProvider::new(
            address,
            "macro-local-passwords".into(),
            &std::fs::read_to_string(key_path).expect("synthetic key"),
        )
        .unwrap(),
    );
    let repository = Arc::new(repository);
    let service = PasswordService {
        repository: repository.clone(),
        provider: provider.clone(),
        availability: Arc::new(FakeAvailability),
    };
    let import_id = Uuid::now_v7();
    let input = serde_json::json!({
        "format":"bitwarden_json", "target":{"kind":"new","name":"Synthetic import"},"private":true,
        "folders":[{"key":"parent","name":"Synthetic parent"},{"key":"child","name":"Synthetic child","parentKey":"parent"}],
        "items":[{"sourceKey":"item","name":"Synthetic credential","kind":"login","folderKey":"child","favorite":false,
            "values":{"username":"synthetic-import-user","password":"synthetic-import-value","notes":"","fields":[]},
            "totp":"JBSWY3DPEHPK3PXP"}]
    });
    let first = service
        .import_batch(
            &actor,
            team,
            import_id,
            serde_json::from_value(input.clone()).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first.items[0].outcome, ImportOutcome::Created);
    let id = first.items[0].item_id.unwrap();
    let original = repository.get(team, id).await.unwrap();
    assert!(original.grants.is_empty());
    assert!(original.metadata.has_totp);
    assert_eq!(
        original.metadata.folder_id,
        Some(first.folders[1].folder_id)
    );
    let second = service
        .import_batch(
            &actor,
            team,
            import_id,
            serde_json::from_value(input).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second.items[0].outcome, ImportOutcome::AlreadyPresent);
    assert_eq!(second.items[0].item_id, Some(id));
    let retained = repository.get(team, id).await.unwrap();
    assert_eq!(retained.totp_key_id, original.totp_key_id);
    assert_eq!(retained.metadata.version, 1);
    assert_eq!(provider.current_version(team, id).await.unwrap(), Some(1));
    let values = provider.read(team, id, 1).await.unwrap();
    assert_eq!(values.password.0, "synthetic-import-value");
    assert_eq!(
        provider
            .totp(team, retained.totp_key_id.unwrap())
            .await
            .unwrap()
            .code
            .0
            .len(),
        6
    );
    let audit = sqlx::query!("SELECT created,already_present,failed FROM password_import_activity WHERE team_id=$1 ORDER BY id",team.0).fetch_all(&pool).await.unwrap();
    assert_eq!(audit.len(), 2);
    assert_eq!(
        (audit[0].created, audit[0].already_present, audit[0].failed),
        (1, 0, 0)
    );
    assert_eq!(
        (audit[1].created, audit[1].already_present, audit[1].failed),
        (0, 1, 0)
    );
    // Only this disposable namespace is erased, using the normal trusted purge path.
    for _ in 0..4 {
        let purged = service.purge_team(team).await;
        let mut connections = Vec::new();
        for _ in 0..pool.options().get_max_connections() {
            connections.push(pool.acquire().await.unwrap());
        }
        drop(connections);
        match purged {
            Ok(()) => return,
            Err(Error::Busy) => {}
            Err(error) => panic!("disposable purge failed: {error}"),
        }
    }
    panic!("disposable namespace purge acknowledgement did not complete");
}
