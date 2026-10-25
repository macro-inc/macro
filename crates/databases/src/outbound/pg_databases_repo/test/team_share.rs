//! A database shared with its owner's team, read and written by a teammate
//! through the service, access checks and listing that hosts use. The
//! source-id cache is process-wide, so the test mints its own user ids.

use std::sync::Arc;

use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, EntityType, OwnerAccessLevel, ViewAccessLevel,
};
use entity_access::domain::ports::EntityAccessService;
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::NoopMacroEventBroker;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_databases::{CellValue, CellWrite, DatabaseOp, OpResult, RowsChange, RowsResult};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::access_level::AccessLevel as ShareAccessLevel;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{CreateDatabase, DatabaseError, Viewer};
use crate::domain::ports::{DatabasesRepo, DatabasesService};
use crate::domain::receipt::database_receipt;
use crate::domain::sharing::DatabaseSharingService;
use crate::outbound::gateway_event_publisher::NoOpTableEventPublisher;
use crate::outbound::pg_databases_repo::PgDatabasesRepo;
use crate::wiring::build_service;
use properties::outbound::properties_pg_repo::PropertiesPgRepo;

async fn insert_user(pool: &PgPool, user_id: &str) -> Viewer {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
        macro_user_id,
        user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        user_id,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    Viewer {
        user_id: MacroUserIdStr::parse_from_str(user_id)
            .unwrap()
            .into_owned(),
        acting_bot: None,
    }
}

fn team_share(level: Option<ShareAccessLevel>) -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: Some(level),
        channel_share_permissions: None,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_teammate_reads_and_writes_a_team_shared_database_until_it_is_unshared(pool: PgPool) {
    let run = Uuid::now_v7();
    let owner = insert_user(&pool, &format!("macro|team-share-owner-{run}@macro.com")).await;
    let teammate = insert_user(&pool, &format!("macro|team-share-mate-{run}@macro.com")).await;
    let outsider = insert_user(&pool, &format!("macro|team-share-out-{run}@macro.com")).await;
    let team = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id, seat_count) VALUES ($1, 'Team', $2, 2)",
        team,
        owner.user_id.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')",
        team,
        owner.user_id.as_ref(),
        teammate.user_id.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        pool.clone(),
    )));
    let service = build_service(
        pool.clone(),
        access.clone(),
        NoOpTableEventPublisher,
        NoopMacroEventBroker,
    );
    let database = service
        .create_database(CreateDatabase {
            name: "Roadmap".to_string(),
            owner_id: owner.user_id.clone(),
            acting_bot: None,
        })
        .await
        .unwrap();
    let owns = || database_receipt::<OwnerAccessLevel, _>(access.as_ref(), &owner, database.id);

    assert!(
        database_receipt::<ViewAccessLevel, _>(access.as_ref(), &teammate, database.id)
            .await
            .is_err()
    );
    let shared = service
        .update_share_permissions(
            owns().await.unwrap(),
            team_share(Some(ShareAccessLevel::Edit)),
        )
        .await
        .unwrap();
    assert_eq!(shared.team_share_access_level, Some(ShareAccessLevel::Edit));
    assert_eq!(
        service
            .share_permissions(owns().await.unwrap())
            .await
            .unwrap()
            .team_share_access_level,
        Some(ShareAccessLevel::Edit)
    );

    let listed = service.list_databases(teammate.clone()).await.unwrap();
    assert_eq!(
        listed
            .iter()
            .map(|listed| (listed.database.id, listed.grant))
            .collect::<Vec<_>>(),
        vec![(database.id, AccessLevel::Edit)]
    );
    assert!(
        service
            .list_databases(outsider.clone())
            .await
            .unwrap()
            .is_empty()
    );
    let detail = service
        .get_database(
            database_receipt::<ViewAccessLevel, _>(access.as_ref(), &teammate, database.id)
                .await
                .unwrap(),
        )
        .await
        .unwrap();
    let table = &detail.tables[0];
    let inserted = service
        .apply_ops(
            database_receipt::<EditAccessLevel, _>(access.as_ref(), &teammate, database.id)
                .await
                .unwrap(),
            teammate.clone(),
            vec![DatabaseOp::Rows {
                table: table.table.id,
                change: RowsChange::Insert {
                    rows: vec![vec![CellWrite {
                        column: table.columns[0].column.id,
                        value: CellValue::Text("Launch".into()),
                    }]],
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    let [
        OpResult::Rows {
            change: RowsResult::Inserted { rows },
            ..
        },
    ] = inserted.as_slice()
    else {
        panic!("expected one insert, got {inserted:?}");
    };
    let row = rows[0].to_string();
    assert_eq!(
        access
            .get_access_level(Some(&teammate.user_id), &row, EntityType::DatabaseRow)
            .await
            .unwrap(),
        Some(AccessLevel::Edit)
    );
    assert_eq!(
        access
            .get_access_level(Some(&outsider.user_id), &row, EntityType::DatabaseRow)
            .await
            .unwrap(),
        None
    );

    // A team share grants no ownership, so the teammate cannot reshare it.
    assert!(
        database_receipt::<OwnerAccessLevel, _>(access.as_ref(), &teammate, database.id)
            .await
            .is_err()
    );

    let unshared = service
        .update_share_permissions(owns().await.unwrap(), team_share(None))
        .await
        .unwrap();
    assert_eq!(unshared.team_share_access_level, None);
    assert!(
        service
            .list_databases(teammate.clone())
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        access
            .get_access_level(
                Some(&teammate.user_id),
                &database.id.to_string(),
                EntityType::Database
            )
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        access
            .get_access_level(Some(&teammate.user_id), &row, EntityType::DatabaseRow)
            .await
            .unwrap(),
        None
    );
    assert!(matches!(
        service
            .update_share_permissions(
                owns().await.unwrap(),
                team_share(Some(ShareAccessLevel::Owner))
            )
            .await,
        Err(DatabaseError::InvalidSharing(_))
    ));
    // Deleting the database deletes its sharing settings.
    let permission_id = sqlx::query_scalar!(
        "SELECT share_permission_id FROM database_entities WHERE database_id = $1",
        database.id.into_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .expect("sharing made the database's permission");
    PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .delete_database(database.id)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "count!" FROM "SharePermission" WHERE id = $1"#,
            permission_id,
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
}
