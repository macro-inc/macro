//! Under a scope that may not share, every grant writer refuses a grant that
//! adds access and the helpers that revoke a direct grant refuse to; a refused
//! write writes nothing, and grants that add no access are still written.

use agent_correlation::context::{Attribution, scope_attribution};
use agent_correlation::scope::SessionScope;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_owner::Owner;
use models_permissions::share_permission::channel_share_permission::{
    UpdateChannelSharePermission, UpdateOperation,
};
use sqlx::{PgPool, Postgres, Transaction};

use crate::{AccessLevel, EntityAccessSourceType, EntityType};

const ROOT_PROJECT_ID: Uuid = Uuid::from_u128(0x11111111_1111_1111_1111_111111111111);
const CHILD_PROJECT_ID: Uuid = Uuid::from_u128(0x22222222_2222_2222_2222_222222222222);
const EMPTY_PROJECT_ID: Uuid = Uuid::from_u128(0x33333333_3333_3333_3333_333333333333);
const CHILD_DOCUMENT_ID: Uuid = Uuid::from_u128(0x55555555_5555_5555_5555_555555555555);
const CHILD_CHAT_ID: Uuid = Uuid::from_u128(0x66666666_6666_6666_6666_666666666666);
const TEAM_ID: Uuid = Uuid::from_u128(0x7ea);
const CHANNEL_ID: Uuid = Uuid::from_u128(0xc4a);

fn scoped(scope: SessionScope) -> Attribution {
    Attribution {
        scope: Some(scope),
        ..Attribution::default()
    }
}

/// Runs `write` in a transaction under `scope` (`None` for an unscoped
/// request) and commits it when it succeeds.
async fn write_under<F>(
    pool: &PgPool,
    scope: Option<SessionScope>,
    write: F,
) -> Result<(), sqlx::Error>
where
    F: for<'t> AsyncFnOnce(&'t mut Transaction<'static, Postgres>) -> Result<(), sqlx::Error>,
{
    let attribution = scope.map(scoped).unwrap_or_default();
    scope_attribution(attribution, async {
        let mut tx = pool.begin().await?;
        write(&mut tx).await?;
        tx.commit().await
    })
    .await
}

fn assert_refused(outcome: Result<(), sqlx::Error>) {
    match outcome {
        Err(sqlx::Error::InvalidArgument(message)) => {
            assert_eq!(message, agent_correlation::context::SharingRefused::MESSAGE)
        }
        other => panic!("expected a sharing refusal, got {other:?}"),
    }
}

async fn grants(pool: &PgPool, entity_id: &Uuid) -> Vec<(String, String, AccessLevel)> {
    sqlx::query_as::<_, (String, String, AccessLevel)>(
        "SELECT source_id, source_type::text, access_level FROM entity_access \
         WHERE entity_id = $1 ORDER BY source_type::text, source_id",
    )
    .bind(entity_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn grant(
    pool: &PgPool,
    entity_id: &Uuid,
    source_id: &str,
    source_type: EntityAccessSourceType,
    level: AccessLevel,
) {
    write_under(pool, None, async |tx| {
        crate::insert_entity_access_row(
            tx,
            entity_id,
            EntityType::Document,
            source_id,
            source_type,
            level,
        )
        .await
    })
    .await
    .unwrap();
}

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

/// The owner of the fixture's folders.
async fn fixture_owner(pool: &PgPool) -> String {
    sqlx::query_scalar!(
        r#"SELECT "userId" FROM "Project" WHERE id = $1"#,
        ROOT_PROJECT_ID.to_string()
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_row_is_only_its_owners_grant(pool: PgPool) {
    let entity = Uuid::now_v7();
    let owner = user("owner@example.com");
    for scope in [SessionScope::Generation, SessionScope::NoSend] {
        for (source_id, source_type, level) in [
            (
                TEAM_ID.to_string(),
                EntityAccessSourceType::Team,
                AccessLevel::Owner,
            ),
            (
                CHANNEL_ID.to_string(),
                EntityAccessSourceType::Channel,
                AccessLevel::Edit,
            ),
            (
                owner.to_string(),
                EntityAccessSourceType::User,
                AccessLevel::Edit,
            ),
        ] {
            assert_refused(
                write_under(&pool, Some(scope), async |tx| {
                    crate::insert_entity_access_row(
                        tx,
                        &entity,
                        EntityType::Document,
                        &source_id,
                        source_type,
                        level,
                    )
                    .await
                })
                .await,
            );
        }
    }
    assert!(grants(&pool, &entity).await.is_empty());
    write_under(&pool, Some(SessionScope::NoSend), async |tx| {
        crate::insert_entity_access_row(
            tx,
            &entity,
            EntityType::Document,
            owner.as_ref(),
            EntityAccessSourceType::User,
            AccessLevel::Owner,
        )
        .await
    })
    .await
    .unwrap();
    assert_eq!(grants(&pool, &entity).await.len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_team_owner_shares_with_its_members(pool: PgPool) {
    let entity = Uuid::now_v7();
    assert_refused(
        write_under(&pool, Some(SessionScope::NoSend), async |tx| {
            crate::upsert_owner_grant(tx, &entity, EntityType::Document, &Owner::Team(TEAM_ID))
                .await
        })
        .await,
    );
    assert!(grants(&pool, &entity).await.is_empty());
    let owner = Owner::User(user("owner@example.com"));
    write_under(&pool, Some(SessionScope::NoSend), async |tx| {
        crate::upsert_owner_grant(tx, &entity, EntityType::Document, &owner).await
    })
    .await
    .unwrap();
    assert_eq!(grants(&pool, &entity).await.len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn user_grants_are_refused_only_when_they_add_access(pool: PgPool) {
    let entity = Uuid::now_v7();
    let owner = user("owner@example.com");
    let viewer = user("viewer@example.com");
    let stranger = user("stranger@example.com");
    grant(
        &pool,
        &entity,
        owner.as_ref(),
        EntityAccessSourceType::User,
        AccessLevel::Owner,
    )
    .await;
    grant(
        &pool,
        &entity,
        viewer.as_ref(),
        EntityAccessSourceType::User,
        AccessLevel::View,
    )
    .await;
    let before = grants(&pool, &entity).await;

    for (users, level) in [
        (vec![viewer.clone()], AccessLevel::Edit),
        (vec![stranger.clone()], AccessLevel::View),
        (vec![owner.clone(), stranger.clone()], AccessLevel::View),
    ] {
        let outcome = scope_attribution(scoped(SessionScope::NoSend), async {
            crate::upsert_user_entity_access_bulk(
                &mut *pool.acquire().await?,
                &users,
                &entity,
                EntityType::Document,
                level,
            )
            .await
        })
        .await;
        let error = outcome.expect_err("adds access");
        assert!(matches!(
            error.downcast_ref::<sqlx::Error>(),
            Some(sqlx::Error::InvalidArgument(_))
        ));
    }
    assert_eq!(grants(&pool, &entity).await, before);

    // Re-granting what is already held is not sharing.
    scope_attribution(scoped(SessionScope::NoSend), async {
        crate::upsert_user_entity_access_bulk(
            &mut *pool.acquire().await.unwrap(),
            &[owner.clone(), viewer.clone()],
            &entity,
            EntityType::Document,
            AccessLevel::View,
        )
        .await
    })
    .await
    .unwrap();
    assert_eq!(grants(&pool, &entity).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_and_team_grants_are_refused(pool: PgPool) {
    let entity = Uuid::now_v7();
    let channel = CHANNEL_ID.to_string();
    let add = |operation, level| {
        vec![UpdateChannelSharePermission {
            operation,
            channel_id: channel.clone(),
            access_level: Some(level),
        }]
    };
    let scope = Some(SessionScope::NoSend);
    assert_refused(
        write_under(&pool, scope, async |tx| {
            crate::update_entity_access_channel_share_permissions(
                tx,
                &entity,
                EntityType::Document,
                &add(UpdateOperation::Add, AccessLevel::View),
            )
            .await
        })
        .await,
    );
    assert_refused(
        write_under(&pool, scope, async |tx| {
            crate::channel_share::insert_if_absent(
                tx,
                &entity,
                EntityType::Document,
                &CHANNEL_ID,
                AccessLevel::View,
            )
            .await
        })
        .await,
    );
    assert_refused(
        write_under(&pool, scope, async |tx| {
            crate::team_share::upsert_direct(
                tx.as_mut(),
                &entity,
                EntityType::Document,
                TEAM_ID,
                AccessLevel::View,
            )
            .await
        })
        .await,
    );
    assert!(grants(&pool, &entity).await.is_empty());

    // An unscoped request shares; a scoped one may lower it but not drop it.
    write_under(&pool, None, async |tx| {
        crate::update_entity_access_channel_share_permissions(
            tx,
            &entity,
            EntityType::Document,
            &add(UpdateOperation::Add, AccessLevel::Edit),
        )
        .await
    })
    .await
    .unwrap();
    write_under(&pool, scope, async |tx| {
        crate::update_entity_access_channel_share_permissions(
            tx,
            &entity,
            EntityType::Document,
            &add(UpdateOperation::Replace, AccessLevel::View),
        )
        .await
    })
    .await
    .unwrap();
    assert_refused(
        write_under(&pool, scope, async |tx| {
            crate::update_entity_access_channel_share_permissions(
                tx,
                &entity,
                EntityType::Document,
                &add(UpdateOperation::Remove, AccessLevel::View),
            )
            .await
        })
        .await,
    );
    assert_eq!(
        grants(&pool, &entity).await,
        vec![(channel, "channel".to_owned(), AccessLevel::View)]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_someones_access_is_refused(pool: PgPool) {
    let entity = Uuid::now_v7();
    let owner = user("owner@example.com");
    let viewer = user("viewer@example.com");
    let stranger = user("stranger@example.com");
    grant(
        &pool,
        &entity,
        owner.as_ref(),
        EntityAccessSourceType::User,
        AccessLevel::Owner,
    )
    .await;
    grant(
        &pool,
        &entity,
        viewer.as_ref(),
        EntityAccessSourceType::User,
        AccessLevel::View,
    )
    .await;
    grant(
        &pool,
        &entity,
        &TEAM_ID.to_string(),
        EntityAccessSourceType::Team,
        AccessLevel::View,
    )
    .await;
    let before = grants(&pool, &entity).await;
    let scope = Some(SessionScope::NoSend);

    assert_refused(
        write_under(&pool, scope, async |tx| {
            crate::delete_user_entity_access_rows(
                tx,
                &entity,
                EntityType::Document,
                std::slice::from_ref(&viewer),
            )
            .await
        })
        .await,
    );
    assert_refused(
        write_under(&pool, scope, async |tx| {
            crate::remove_non_owner_user_entity_access(
                tx,
                &entity,
                EntityType::Document,
                owner.as_ref(),
            )
            .await
        })
        .await,
    );
    assert_refused(
        write_under(&pool, scope, async |tx| {
            crate::team_share::delete_direct(tx.as_mut(), &entity, EntityType::Document, TEAM_ID)
                .await
        })
        .await,
    );
    assert_eq!(grants(&pool, &entity).await, before);

    // Removing access nobody holds changes nothing.
    write_under(&pool, scope, async |tx| {
        crate::delete_user_entity_access_rows(
            tx,
            &entity,
            EntityType::Document,
            std::slice::from_ref(&stranger),
        )
        .await
    })
    .await
    .unwrap();
    assert_eq!(grants(&pool, &entity).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn direct_and_participant_grants_are_refused(pool: PgPool) -> anyhow::Result<()> {
    let call = Uuid::now_v7();
    let participant = user("participant@example.com");
    sqlx::query!(
        "INSERT INTO \"SharePermission\" (id) VALUES ($1)",
        call.to_string()
    )
    .execute(&pool)
    .await?;
    sqlx::query!("INSERT INTO calls (id, room_name, created_by, share_permission_id) VALUES ($1, 'test-room', 'macro|owner@example.com', $2)", call, call.to_string()).execute(&pool).await?;
    sqlx::query!(
        "INSERT INTO call_participants (call_id, user_id) VALUES ($1, $2)",
        call,
        participant.as_ref()
    )
    .execute(&pool)
    .await?;
    let outcome = scope_attribution(scoped(SessionScope::NoSend), async {
        crate::ensure_call_participant_comment_access(
            &mut *pool.acquire().await?,
            &call,
            participant.clone(),
        )
        .await
    })
    .await;
    assert_refused(outcome);

    let document = Uuid::now_v7();
    let outcome = scope_attribution(scoped(SessionScope::NoSend), async {
        let mut tx = pool.begin().await?;
        crate::direct_share::set(
            &mut tx,
            &document,
            EntityType::Document,
            &participant,
            Some(AccessLevel::View),
            false,
        )
        .await?;
        tx.commit().await?;
        anyhow::Ok(())
    })
    .await;
    assert!(outcome.is_err());
    assert!(grants(&pool, &call).await.is_empty());
    assert!(grants(&pool, &document).await.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("upsert_test_data"))
)]
async fn filing_in_a_shared_folder_is_refused(pool: PgPool) {
    let owner = fixture_owner(&pool).await;
    let document = Uuid::now_v7();
    grant(
        &pool,
        &document,
        &owner,
        EntityAccessSourceType::User,
        AccessLevel::Owner,
    )
    .await;
    // The owner's own folders add nobody.
    for folder in [ROOT_PROJECT_ID, EMPTY_PROJECT_ID] {
        write_under(&pool, None, async |tx| {
            crate::insert_entity_access_row(
                tx,
                &folder,
                EntityType::Project,
                &owner,
                EntityAccessSourceType::User,
                AccessLevel::Owner,
            )
            .await
        })
        .await
        .unwrap();
        write_under(&pool, Some(SessionScope::NoSend), async |tx| {
            crate::project_grants::refuse_filing(tx, &document, EntityType::Document, &folder).await
        })
        .await
        .unwrap();
    }
    // Sharing the root folder with a team shares what is filed in it.
    write_under(&pool, None, async |tx| {
        crate::team_share::upsert_direct(
            tx.as_mut(),
            &ROOT_PROJECT_ID,
            EntityType::Project,
            TEAM_ID,
            AccessLevel::View,
        )
        .await
    })
    .await
    .unwrap();
    let before = grants(&pool, &document).await;
    for scope in [SessionScope::Generation, SessionScope::NoSend] {
        assert_refused(
            write_under(&pool, Some(scope), async |tx| {
                crate::project_grants::refuse_filing(
                    tx,
                    &document,
                    EntityType::Document,
                    &ROOT_PROJECT_ID,
                )
                .await
            })
            .await,
        );
        assert_refused(
            write_under(&pool, Some(scope), async |tx| {
                crate::project_grants::inherit_project_grants(
                    tx,
                    &document,
                    EntityType::Document,
                    &ROOT_PROJECT_ID,
                )
                .await
            })
            .await,
        );
    }
    assert_eq!(grants(&pool, &document).await, before);

    // A document the team already sees is filed there freely.
    write_under(&pool, None, async |tx| {
        crate::team_share::upsert_direct(
            tx.as_mut(),
            &document,
            EntityType::Document,
            TEAM_ID,
            AccessLevel::Edit,
        )
        .await
    })
    .await
    .unwrap();
    write_under(&pool, Some(SessionScope::NoSend), async |tx| {
        crate::project_grants::inherit_project_grants(
            tx,
            &document,
            EntityType::Document,
            &ROOT_PROJECT_ID,
        )
        .await
    })
    .await
    .unwrap();
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("upsert_test_data"))
)]
async fn a_folder_brings_its_contents_into_a_shared_folder(pool: PgPool) {
    let share = |entity: Uuid, entity_type: EntityType| {
        let pool = pool.clone();
        async move {
            write_under(&pool, None, async |tx| {
                crate::team_share::upsert_direct(
                    tx.as_mut(),
                    &entity,
                    entity_type,
                    TEAM_ID,
                    AccessLevel::View,
                )
                .await
            })
            .await
            .unwrap();
        }
    };
    let file_child_folder = || {
        write_under(&pool, Some(SessionScope::NoSend), async |tx| {
            crate::project_grants::refuse_filing(
                tx,
                &CHILD_PROJECT_ID,
                EntityType::Project,
                &EMPTY_PROJECT_ID,
            )
            .await
        })
    };
    share(EMPTY_PROJECT_ID, EntityType::Project).await;
    // The team sees the folder but not what is in it.
    share(CHILD_PROJECT_ID, EntityType::Project).await;
    assert_refused(file_child_folder().await);

    share(CHILD_DOCUMENT_ID, EntityType::Document).await;
    share(CHILD_CHAT_ID, EntityType::Chat).await;
    file_child_folder().await.unwrap();
}
