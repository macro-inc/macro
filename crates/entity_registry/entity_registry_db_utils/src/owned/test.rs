use super::*;
use bot_id::{BotId, MACRO_AI_BOT_ID};
use entity_registry::{Owner, RegisteredEntityType};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const OWNED_BOT: BotId = BotId::new_from_uuid(Uuid::from_u128(42));

struct Facts(Option<Owner>);

impl BotFacts for Facts {
    async fn sponsor(&self, bot: BotId) -> EntityRegistryResult<Option<Owner>> {
        assert_eq!(bot, OWNED_BOT);
        Ok(self.0.clone())
    }
}

fn user() -> Owner {
    Owner::parse(OwnerType::User, "macro|sponsor@example.com").unwrap()
}

fn registrar(sponsor: Option<Owner>) -> OwnedEntityRegistrar<Facts> {
    OwnedEntityRegistrar::new(OwnerGrantPolicy::new(Facts(sponsor)))
}

async fn grants(tx: &mut Transaction<'_, Postgres>, id: Uuid) -> Vec<(String, String, String)> {
    sqlx::query!(
        r#"
        SELECT source_type::text AS "source_type!", source_id,
               access_level::text AS "access_level!"
        FROM entity_access
        WHERE entity_id = $1 AND granted_from_project_id IS NULL
        ORDER BY source_type::text, source_id
        "#,
        id,
    )
    .fetch_all(tx.as_mut())
    .await
    .unwrap()
    .into_iter()
    .map(|r| (r.source_type, r.source_id, r.access_level))
    .collect()
}

async fn registered(tx: &mut Transaction<'_, Postgres>, id: Uuid) -> bool {
    sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM entity WHERE id = $1) AS "exists!""#,
        id
    )
    .fetch_one(tx.as_mut())
    .await
    .unwrap()
}

fn expected(sources: &[Owner]) -> Vec<(String, String, String)> {
    let mut rows = sources
        .iter()
        .map(|owner| {
            (
                owner.owner_type().to_string(),
                owner.principal_id(),
                "owner".to_owned(),
            )
        })
        .collect::<Vec<_>>();
    rows.sort();
    rows
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn registers_all_owner_kinds_and_entity_kinds_idempotently(pool: PgPool) {
    let team = Owner::Team(Uuid::from_u128(1));
    let cases = [
        (user(), None, vec![user()]),
        (team.clone(), None, vec![team.clone()]),
        (
            Owner::Bot(OWNED_BOT),
            Some(user()),
            vec![Owner::Bot(OWNED_BOT), user()],
        ),
        (
            Owner::Bot(OWNED_BOT),
            Some(team.clone()),
            vec![Owner::Bot(OWNED_BOT), team],
        ),
        (
            Owner::Bot(MACRO_AI_BOT_ID),
            None,
            vec![Owner::Bot(MACRO_AI_BOT_ID)],
        ),
    ];
    let mut tx = pool.begin().await.unwrap();
    for (owner, sponsor, sources) in cases {
        let registrar = registrar(sponsor);
        for kind in RegisteredEntityType::ALL {
            let record = NewEntityRecord::new(Uuid::now_v7(), kind, owner.clone());
            assert_eq!(
                registrar
                    .register_owned_entity(&mut tx, record.clone())
                    .await
                    .unwrap(),
                InsertOutcome::Inserted
            );
            assert_eq!(
                registrar
                    .register_owned_entity(&mut tx, record.clone())
                    .await
                    .unwrap(),
                InsertOutcome::AlreadyRegistered
            );
            assert!(registered(&mut tx, record.id).await);
            assert_eq!(grants(&mut tx, record.id).await, expected(&sources));
        }
    }
    tx.commit().await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn conflicting_registration_never_grants_access(pool: PgPool) {
    let registrar = registrar(None);
    let record = NewEntityRecord::new(Uuid::now_v7(), RegisteredEntityType::Document, user());
    let mut tx = pool.begin().await.unwrap();
    registrar
        .register_owned_entity(&mut tx, record.clone())
        .await
        .unwrap();
    for conflict in [
        NewEntityRecord {
            owner: Owner::Team(Uuid::from_u128(1)),
            ..record.clone()
        },
        NewEntityRecord {
            entity_type: RegisteredEntityType::Chat,
            ..record.clone()
        },
    ] {
        let error = registrar
            .register_owned_entity(&mut tx, conflict)
            .await
            .unwrap_err();
        assert_eq!(
            *error.current_context(),
            EntityRegistryError::RegistrationConflict
        );
        assert_eq!(grants(&mut tx, record.id).await, expected(&[user()]));
    }
    tx.commit().await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn retry_repairs_missing_grants_and_outer_rollback_removes_both(pool: PgPool) {
    let record = NewEntityRecord::new(
        Uuid::now_v7(),
        RegisteredEntityType::Chat,
        Owner::Bot(OWNED_BOT),
    );
    let mut tx = pool.begin().await.unwrap();
    insert_entity(&mut tx, record.clone()).await.unwrap();
    assert_eq!(
        registrar(Some(user()))
            .register_owned_entity(&mut tx, record.clone())
            .await
            .unwrap(),
        InsertOutcome::AlreadyRegistered
    );
    assert_eq!(
        grants(&mut tx, record.id).await,
        expected(&[record.owner.clone(), user()])
    );
    tx.rollback().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    assert!(!registered(&mut tx, record.id).await);
    assert!(grants(&mut tx, record.id).await.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn missing_sponsor_writes_nothing(pool: PgPool) {
    let record = NewEntityRecord::new(
        Uuid::now_v7(),
        RegisteredEntityType::Chat,
        Owner::Bot(OWNED_BOT),
    );
    let mut tx = pool.begin().await.unwrap();
    assert!(
        registrar(None)
            .register_owned_entity(&mut tx, record.clone())
            .await
            .is_err()
    );
    tx.commit().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    assert!(!registered(&mut tx, record.id).await);
    assert!(grants(&mut tx, record.id).await.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("fail_sponsor_grant"))
)]
async fn second_grant_failure_rolls_back_registration_even_if_caller_commits(pool: PgPool) {
    let record = NewEntityRecord::new(
        Uuid::now_v7(),
        RegisteredEntityType::Chat,
        Owner::Bot(OWNED_BOT),
    );
    let mut tx = pool.begin().await.unwrap();
    let error = registrar(Some(user()))
        .register_owned_entity(&mut tx, record.clone())
        .await
        .unwrap_err();
    assert_eq!(
        *error.current_context(),
        EntityRegistryError::Infrastructure
    );
    tx.commit().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    assert!(!registered(&mut tx, record.id).await);
    assert!(grants(&mut tx, record.id).await.is_empty());
}
