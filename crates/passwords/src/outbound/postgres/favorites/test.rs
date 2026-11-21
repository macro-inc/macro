use super::*;
use crate::outbound::postgres::test::{another_team, folder_fixture};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn preferences_seed_once_and_follow_item_and_membership_lifecycle(pool: PgPool) {
    let (repository, owner, mut record) = folder_fixture(pool.clone()).await;
    let team = record.metadata.team_id;
    let (_, viewer) = another_team(&pool).await;
    sqlx::query!(
        "DELETE FROM team_user WHERE user_id=$1",
        viewer.user_id.as_ref()
    )
    .execute(&pool)
    .await
    .expect("move fixture member");
    sqlx::query!(
        "INSERT INTO team_user(user_id,team_id,team_role) VALUES($1,$2,'member')",
        viewer.user_id.as_ref(),
        team.0
    )
    .execute(&pool)
    .await
    .expect("viewer membership");
    record.metadata.id = ItemId(Uuid::now_v7());
    record.metadata.favorite = true;
    record.revision = 0;
    repository
        .save(&record, None)
        .await
        .expect("initial favorite atomically seeded");
    let item = record.metadata.id;
    assert_eq!(
        repository
            .favorites(&owner, team, &[item])
            .await
            .expect("owner"),
        vec![item]
    );
    assert!(
        repository
            .favorites(&viewer, team, &[item])
            .await
            .expect("viewer")
            .is_empty()
    );
    let before = repository.get(team, item).await.expect("snapshot");
    let lease = repository.lock(team, item).await.expect("credential lease");
    repository
        .set_favorite(&viewer, team, item, true)
        .await
        .expect("star during credential lease");
    repository
        .set_favorite(&viewer, team, item, true)
        .await
        .expect("idempotent");
    repository
        .set_favorite(&owner, team, item, false)
        .await
        .expect("own removal");
    let after = repository.get(team, item).await.expect("snapshot");
    assert_eq!(before.revision, after.revision);
    assert_eq!(before.metadata.version, after.metadata.version);
    assert_eq!(before.metadata.updated_at, after.metadata.updated_at);
    lease.release().await.expect("release");
    repository
        .save(&after, Some(after.metadata.version))
        .await
        .expect("credential save");
    assert!(
        repository
            .favorites(&owner, team, &[item])
            .await
            .expect("not reseeded")
            .is_empty()
    );
    sqlx::query!(
        "DELETE FROM team_user WHERE user_id=$1 AND team_id=$2",
        viewer.user_id.as_ref(),
        team.0
    )
    .execute(&pool)
    .await
    .expect("remove member");
    assert!(
        repository
            .favorites(&viewer, team, &[item])
            .await
            .expect("cascade")
            .is_empty()
    );
    assert!(matches!(
        repository.set_favorite(&viewer, team, item, true).await,
        Err(Error::NotFound)
    ));
    repository
        .set_favorite(&owner, team, item, true)
        .await
        .expect("star");
    let mut deleting = repository.get(team, item).await.expect("snapshot");
    deleting.deleting = true;
    repository
        .save(&deleting, Some(deleting.metadata.version))
        .await
        .expect("soft delete");
    assert!(
        repository
            .favorites(&owner, team, &[item])
            .await
            .expect("soft cleanup")
            .is_empty()
    );
    assert!(matches!(
        repository.set_favorite(&owner, team, item, true).await,
        Err(Error::NotFound)
    ));
    let mut second = record.clone();
    second.metadata.id = ItemId(Uuid::now_v7());
    repository.save(&second, None).await.expect("second item");
    sqlx::query!(
        "DELETE FROM password_item_entities WHERE team_id=$1 AND id=$2",
        team.0,
        second.metadata.id.0
    )
    .execute(&pool)
    .await
    .expect("physical delete");
    assert!(
        repository
            .favorites(&owner, team, &[second.metadata.id])
            .await
            .expect("FK cleanup")
            .is_empty()
    );
    let mut third = record.clone();
    third.metadata.id = ItemId(Uuid::now_v7());
    repository.save(&third, None).await.expect("third item");
    repository
        .delete(team, third.metadata.id)
        .await
        .expect("retire item");
    assert!(
        repository
            .favorites(&owner, team, &[third.metadata.id])
            .await
            .expect("retirement cleanup")
            .is_empty()
    );
}
