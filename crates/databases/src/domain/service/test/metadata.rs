//! A database's own facts for a domain that names something after it, read
//! whether or not the database is in the trash.

use super::*;
use crate::domain::ports::DatabaseMetadataReads;

#[tokio::test]
async fn metadata_names_the_database_as_it_is_now_in_the_trash_or_not() {
    let seeded = seeded().await;
    let (svc, db) = (seeded.service, seeded.database_id);
    svc.rename_database(edit(db), "Q4 offsite".into())
        .await
        .unwrap();

    let live = svc
        .database_metadata(receipt::<ViewAccessLevel>(db, OWNER, AccessLevel::View))
        .await
        .unwrap();
    assert_eq!(live.id, db);
    assert_eq!(live.name, "Q4 offsite");
    assert_eq!(live.trashed_at, None);

    svc.trash_database(receipt::<OwnerAccessLevel>(db, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    let trashed = svc
        .database_metadata(receipt::<ViewAccessLevel>(db, OWNER, AccessLevel::View))
        .await
        .unwrap();
    assert_eq!(trashed.name, "Q4 offsite");
    assert!(trashed.trashed_at.is_some());
}

#[tokio::test]
async fn metadata_of_a_missing_database_or_another_entity_is_not_found() {
    let seeded = seeded().await;
    let missing = svc_error(
        seeded
            .service
            .database_metadata(receipt::<ViewAccessLevel>(
                DatabaseId::new(),
                OWNER,
                AccessLevel::View,
            ))
            .await,
    );
    assert!(matches!(missing, DatabaseError::NotFound), "{missing:?}");

    let not_a_database = EntityAccessReceipt::<ViewAccessLevel>::try_new_authenticated_user(
        user(OWNER),
        Entity {
            entity_id: seeded.database_id.to_string(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap();
    let refused = svc_error(seeded.service.database_metadata(not_a_database).await);
    assert!(matches!(refused, DatabaseError::NotFound), "{refused:?}");
}

fn svc_error(result: Result<Database, DatabaseError>) -> DatabaseError {
    result.expect_err("the read is refused")
}
