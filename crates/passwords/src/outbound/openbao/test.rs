use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::{process::Command, sync::Mutex};

#[tokio::test]
#[ignore = "requires explicit disposable local OpenBao and bootstrap signing key"]
async fn local_provider_versions_totp_isolation_and_deletion_fence() {
    let address = std::env::var("PASSWORDS_TEST_OPENBAO_ADDRESS")
        .expect("explicit disposable local OpenBao address");
    let key_path = std::env::var("PASSWORDS_TEST_OPENBAO_SIGNING_KEY")
        .expect("explicit synthetic signing key file");
    let public_key_path = std::env::var("PASSWORDS_TEST_OPENBAO_PUBLIC_KEY")
        .expect("explicit synthetic public key file");
    let issuer = "macro-local-passwords";
    let first = TeamId(uuid::Uuid::now_v7());
    let second = TeamId(uuid::Uuid::now_v7());
    for team in [first, second] {
        let status = Command::new("python3")
            .args([
                "../../infra/local/openbao/bootstrap.py",
                "--address",
                &address,
                "--team-id",
                &team.0.to_string(),
                "--jwt-public-key",
                &public_key_path,
                "--jwt-issuer",
                issuer,
            ])
            .status()
            .expect("local bootstrap executable");
        assert!(status.success(), "bootstrap synthetic namespace");
    }
    let provider = OpenBaoProvider::new(
        address,
        issuer.into(),
        &std::fs::read_to_string(key_path).expect("fixture key"),
    )
    .expect("provider");
    let item = ItemId(uuid::Uuid::now_v7());
    let mut values = SecretValues {
        username: SecretString("synthetic-user".into()),
        password: SecretString("synthetic-first".into()),
        notes: SecretString("synthetic-notes".into()),
        fields: vec![SecretField {
            label: "private-label".into(),
            value: SecretString("synthetic-field".into()),
        }],
    };
    let operation = uuid::Uuid::now_v7();
    assert!(
        provider
            .current_version(first, item)
            .await
            .expect("missing")
            .is_none()
    );
    assert_eq!(
        provider
            .write(first, item, 0, operation, &values)
            .await
            .expect("write"),
        1
    );
    assert_eq!(
        provider.status(first, item).await.expect("status"),
        Some((1, operation))
    );
    assert!(matches!(
        provider
            .write(first, item, 0, uuid::Uuid::now_v7(), &values)
            .await,
        Err(Error::Conflict)
    ));
    values.password.0 = "synthetic-second".into();
    assert_eq!(
        provider
            .write(first, item, 1, uuid::Uuid::now_v7(), &values)
            .await
            .expect("write"),
        2
    );
    assert_eq!(
        provider
            .read(first, item, 1)
            .await
            .expect("history value")
            .password
            .0,
        "synthetic-first"
    );
    assert_eq!(
        provider
            .read(first, item, 2)
            .await
            .expect("current value")
            .password
            .0,
        "synthetic-second"
    );
    assert_eq!(
        provider
            .history(first, item)
            .await
            .expect("history")
            .iter()
            .map(|version| version.version)
            .collect::<Vec<_>>(),
        vec![2, 1]
    );
    assert!(
        provider
            .current_version(second, item)
            .await
            .expect("isolated missing")
            .is_none()
    );
    assert!(provider.read(second, item, 1).await.is_err());
    let key_id = TotpKeyId(uuid::Uuid::now_v7());
    provider
        .set_totp(first, key_id, &SecretString("JBSWY3DPEHPK3PXP".into()))
        .await
        .expect("TOTP enrollment");
    let code = provider.totp(first, key_id).await.expect("code");
    assert_eq!(code.code.0.len(), 6);
    assert!(
        code.code
            .0
            .chars()
            .all(|character| character.is_ascii_digit())
    );
    assert!(provider.totp(second, key_id).await.is_err());
    provider
        .set_totp(first, key_id, &SecretString("JBSWY3DPEHPK3PXQ".into()))
        .await
        .expect("replace TOTP");
    provider
        .delete_totp(first, key_id)
        .await
        .expect("remove TOTP");
    provider
        .delete_totp(first, key_id)
        .await
        .expect("idempotent remove TOTP");
    assert!(provider.totp(first, key_id).await.is_err());
    provider.delete(first, item).await.expect("destroy values");
    assert!(provider.read(first, item, 1).await.is_err());
    assert!(provider.read(first, item, 2).await.is_err());
    assert!(
        provider
            .history(first, item)
            .await
            .expect("destroyed history")
            .is_empty()
    );
    assert!(matches!(
        provider
            .write(first, item, 2, uuid::Uuid::now_v7(), &values)
            .await,
        Err(Error::Conflict)
    ));
    assert!(matches!(
        provider
            .write(first, item, 0, uuid::Uuid::now_v7(), &values)
            .await,
        Err(Error::Conflict)
    ));
    provider
        .delete(first, item)
        .await
        .expect("idempotent delete");
}

#[derive(Clone)]
struct LogBuffer(Arc<Mutex<Vec<u8>>>);
impl std::io::Write for LogBuffer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().expect("log lock").extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for LogBuffer {
    type Writer = Self;
    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}
#[tokio::test]
async fn malicious_provider_error_body_never_reaches_tracing_subscriber() {
    use axum::{Router, http::StatusCode, routing::get};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener");
    let address = listener.local_addr().expect("address");
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().fallback(get(|| async {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    r#"{"errors":["synthetic-provider-secret"]}"#,
                )
            })),
        )
        .await
        .expect("server")
    });
    let buffer = LogBuffer(Arc::new(Mutex::new(vec![])));
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_ansi(false)
        .with_writer(buffer.clone())
        .finish();
    let client = VaultClient::new(
        VaultClientSettingsBuilder::default()
            .address(format!("http://{address}"))
            .token("synthetic-token")
            .build()
            .expect("settings"),
    )
    .expect("client");
    async {
        tracing::info!("capture-active");
        let result = quiet(kv2::read::<serde_json::Value>(
            &client,
            "passwords",
            "synthetic-item",
        ))
        .await;
        assert!(result.is_err());
    }
    .with_subscriber(subscriber)
    .await;
    server.abort();
    let logs = buffer.0.lock().expect("logs");
    let logs = String::from_utf8_lossy(&logs);
    assert!(logs.contains("capture-active"));
    assert!(!logs.contains("synthetic-provider-secret"));
    assert!(!logs.contains("synthetic-token"));
}

struct RecentSession;
#[async_trait]
impl crate::domain::ports::Reauthentication for RecentSession {
    async fn verify(&self, _: &Actor) -> Result<(), Error> {
        Ok(())
    }
}
#[async_trait]
impl crate::domain::ports::Availability for RecentSession {
    async fn require_enabled(&self, _: &Actor) -> Result<(), Error> {
        Ok(())
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "requires explicit disposable local OpenBao and bootstrap signing key"]
async fn delayed_enrollment_cannot_replace_live_key_or_survive_retirement_cleanup(
    pool: sqlx::PgPool,
) {
    use crate::{
        domain::{ports::Repository, service::PasswordService},
        outbound::postgres::PgRepository,
    };
    use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
    let address =
        std::env::var("PASSWORDS_TEST_OPENBAO_ADDRESS").expect("explicit disposable address");
    let key_path =
        std::env::var("PASSWORDS_TEST_OPENBAO_SIGNING_KEY").expect("explicit synthetic key file");
    let public_key_path = std::env::var("PASSWORDS_TEST_OPENBAO_PUBLIC_KEY")
        .expect("explicit synthetic public key file");
    let team = TeamId(uuid::Uuid::now_v7());
    let status = Command::new("python3")
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
        .expect("bootstrap");
    assert!(status.success());
    let provider = Arc::new(
        OpenBaoProvider::new(
            address,
            "macro-local-passwords".into(),
            &std::fs::read_to_string(key_path).expect("synthetic key"),
        )
        .expect("provider"),
    );
    let owner = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|enrollment@example.test")
            .expect("identity")
            .into_owned(),
        session_token: None,
    };
    let macro_user_id = uuid::Uuid::now_v7();
    sqlx::query!("INSERT INTO macro_user(id,username,email,stripe_customer_id) VALUES ($1,'enrollment@example.test','enrollment@example.test',$2)",macro_user_id,format!("fixture-{macro_user_id}")).execute(&pool).await.expect("account");
    sqlx::query!(
        r#"INSERT INTO "User"(id,email,macro_user_id) VALUES ($1,'enrollment@example.test',$2)"#,
        owner.user_id.as_ref(),
        macro_user_id
    )
    .execute(&pool)
    .await
    .expect("user");
    sqlx::query!(
        "INSERT INTO team(id,name,owner_id) VALUES ($1,'Fixture',$2)",
        team.0,
        owner.user_id.as_ref()
    )
    .execute(&pool)
    .await
    .expect("team");
    sqlx::query!(
        "INSERT INTO team_user(user_id,team_id,team_role) VALUES ($1,$2,'owner')",
        owner.user_id.as_ref(),
        team.0
    )
    .execute(&pool)
    .await
    .expect("membership");
    let repository = Arc::new(PgRepository::new(pool.clone()).expect("repository capacity"));
    let now = chrono::Utc::now();
    let item = ItemId(uuid::Uuid::now_v7());
    repository
        .save(
            &Record {
                user_id: owner.user_id.clone(),
                grants: vec![],
                deleting: false,
                revision: 0,
                totp_key_id: None,
                metadata: ItemMetadata {
                    id: item,
                    team_id: team,
                    name: "Synthetic login".into(),
                    kind: ItemKind::Login,
                    url: None,
                    folder_id: None,
                    favorite: false,
                    version: 1,
                    has_totp: false,
                    shared: false,
                    created_at: now,
                    updated_at: now,
                    last_used_at: None,
                },
            },
            None,
        )
        .await
        .expect("metadata");
    let service = PasswordService {
        repository: repository.clone(),
        provider: provider.clone(),
        reauthentication: Arc::new(RecentSession),
        availability: Arc::new(RecentSession),
    };
    service
        .configure_totp(
            &owner,
            team,
            item,
            Some(SecretString("JBSWY3DPEHPK3PXP".into())),
        )
        .await
        .expect("first enrollment");
    let first = repository
        .get(team, item)
        .await
        .expect("record")
        .totp_key_id
        .expect("first key");
    service
        .configure_totp(
            &owner,
            team,
            item,
            Some(SecretString("JBSWY3DPEHPK3PXQ".into())),
        )
        .await
        .expect("replace enrollment");
    let second = repository
        .get(team, item)
        .await
        .expect("record")
        .totp_key_id
        .expect("second key");
    assert_ne!(first, second);
    // Reproduce an old HTTP enrollment committing after its replacement returned.
    provider
        .set_totp(team, first, &SecretString("JBSWY3DPEHPK3PXP".into()))
        .await
        .expect("late old enrollment");
    assert_eq!(
        repository
            .get(team, item)
            .await
            .expect("record")
            .totp_key_id,
        Some(second)
    );
    assert!(service.totp(&owner, team, item).await.is_ok());
    assert_eq!(
        service
            .cleanup_expired_totp_enrollments()
            .await
            .expect("grace period"),
        0
    );
    assert_eq!(
        service
            .cleanup_expired_totp_enrollments()
            .await
            .expect("quarantine before grace expiry"),
        0
    );
    sqlx::query!("UPDATE password_totp_enrollments SET cleanup_after=now()-interval '1 second' WHERE team_id=$1",team.0).execute(&pool).await.expect("expire synthetic journal");
    service
        .cleanup_expired_totp_enrollments()
        .await
        .expect("cleanup retired key");
    assert!(provider.totp(team, first).await.is_err());
    assert!(provider.totp(team, second).await.is_ok());
    service
        .configure_totp(&owner, team, item, None)
        .await
        .expect("remove enrollment");
    provider
        .set_totp(team, second, &SecretString("JBSWY3DPEHPK3PXQ".into()))
        .await
        .expect("late removed enrollment");
    assert!(matches!(
        service.totp(&owner, team, item).await,
        Err(Error::NotFound)
    ));
    assert_eq!(
        service
            .cleanup_expired_totp_enrollments()
            .await
            .expect("quarantine before grace expiry"),
        0
    );
    sqlx::query!("UPDATE password_totp_enrollments SET cleanup_after=now()-interval '1 second' WHERE team_id=$1",team.0).execute(&pool).await.expect("expire synthetic journal");
    service
        .cleanup_expired_totp_enrollments()
        .await
        .expect("cleanup removed key");
    assert!(provider.totp(team, second).await.is_err());
    let pending = TotpKeyId(uuid::Uuid::now_v7());
    repository
        .stage_totp(team, item, pending)
        .await
        .expect("pending canceled enrollment");
    provider
        .set_totp(team, pending, &SecretString("JBSWY3DPEHPK3PXP".into()))
        .await
        .expect("late canceled enrollment");
    assert!(matches!(
        service.totp(&owner, team, item).await,
        Err(Error::NotFound)
    ));
    assert_eq!(
        service
            .cleanup_expired_totp_enrollments()
            .await
            .expect("quarantine before grace expiry"),
        0
    );
    sqlx::query!("UPDATE password_totp_enrollments SET cleanup_after=now()-interval '1 second' WHERE team_id=$1",team.0).execute(&pool).await.expect("expire synthetic journal");
    service
        .cleanup_expired_totp_enrollments()
        .await
        .expect("cleanup canceled enrollment");
    assert!(provider.totp(team, pending).await.is_err());
    service
        .configure_totp(
            &owner,
            team,
            item,
            Some(SecretString("JBSWY3DPEHPK3PXP".into())),
        )
        .await
        .expect("new enrollment");
    let third = repository
        .get(team, item)
        .await
        .expect("record")
        .totp_key_id
        .expect("third key");
    service
        .delete(&owner, team, item)
        .await
        .expect("delete item");
    provider
        .set_totp(team, third, &SecretString("JBSWY3DPEHPK3PXP".into()))
        .await
        .expect("late deleted enrollment");
    assert!(matches!(
        service.totp(&owner, team, item).await,
        Err(Error::NotFound)
    ));
    assert_eq!(
        service
            .cleanup_expired_totp_enrollments()
            .await
            .expect("quarantine before grace expiry"),
        0
    );
    sqlx::query!("UPDATE password_totp_enrollments SET cleanup_after=now()-interval '1 second' WHERE team_id=$1",team.0).execute(&pool).await.expect("expire synthetic journal");
    service
        .cleanup_expired_totp_enrollments()
        .await
        .expect("cleanup deleted key");
    assert!(provider.totp(team, third).await.is_err());
    let retained = repository
        .totp_keys(team, item)
        .await
        .expect("durable retired identities");
    assert_eq!(retained.len(), 4);
    for key in [first, second, pending, third] {
        assert!(retained.contains(&key));
    }
    assert!(
        repository
            .totp_cleanup_due()
            .await
            .expect("hourly re-erasure deferred")
            .is_empty()
    );
    // A process that resumes after its database lease was lost may send even after cleanup.
    provider
        .set_totp(team, first, &SecretString("JBSWY3DPEHPK3PXP".into()))
        .await
        .expect("write after acknowledged cleanup");
    sqlx::query!("UPDATE password_totp_enrollments SET cleanup_after=now()-interval '1 second' WHERE team_id=$1 AND key_id=$2",team.0,first.0).execute(&pool).await.expect("expire synthetic hourly retry");
    assert_eq!(
        service
            .cleanup_expired_totp_enrollments()
            .await
            .expect("repeat erasure from permanent journal"),
        1
    );
    assert!(provider.totp(team, first).await.is_err());
    assert!(
        repository
            .totp_cleanup_due()
            .await
            .expect("hourly retry deferred")
            .is_empty()
    );
}
