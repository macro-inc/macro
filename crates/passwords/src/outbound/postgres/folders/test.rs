use super::*;
use crate::outbound::postgres::test::{another_team, folder_fixture};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn subtree_delete_unfiles_items_and_rejects_stale_folder_and_revision(pool: PgPool) {
    let (repository, _, mut record) = folder_fixture(pool).await;
    let team = record.metadata.team_id;
    let root = Folder {
        id: Uuid::now_v7(),
        team_id: team,
        name: "Root".into(),
        parent_id: None,
    };
    let child = Folder {
        id: Uuid::now_v7(),
        team_id: team,
        name: "Child".into(),
        parent_id: Some(root.id),
    };
    repository.save_folder(&root).await.expect("root");
    repository.save_folder(&child).await.expect("child");
    record.metadata.folder_id = Some(child.id);
    repository.save(&record, Some(1)).await.expect("file item");
    let stale = repository
        .get(team, record.metadata.id)
        .await
        .expect("stale snapshot");
    let other = Folder {
        id: Uuid::now_v7(),
        team_id: team,
        name: "Other".into(),
        parent_id: None,
    };
    repository.save_folder(&other).await.expect("other");
    repository
        .delete_folder(team, root.id)
        .await
        .expect("delete subtree");
    let unfiled = repository
        .get(team, record.metadata.id)
        .await
        .expect("retained item");
    assert!(unfiled.metadata.folder_id.is_none());
    assert!(!unfiled.deleting);
    assert_eq!(unfiled.metadata.version, stale.metadata.version);
    assert!(unfiled.revision > stale.revision);
    assert_eq!(repository.folders(team).await.expect("folders").len(), 1);
    assert!(matches!(
        repository.save(&stale, Some(1)).await,
        Err(Error::FolderMissing)
    ));
    let mut stale_revision = stale;
    stale_revision.metadata.folder_id = None;
    assert!(matches!(
        repository.save(&stale_revision, Some(1)).await,
        Err(Error::Conflict)
    ));
    repository
        .save(&unfiled, Some(1))
        .await
        .expect("fresh revision retry");
    assert!(matches!(
        repository.rename_folder(team, root.id, "Recreated").await,
        Err(Error::NotFound)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn depth_eight_allowed_nine_rejected_and_moves_preserve_rename(pool: PgPool) {
    let (repository, _, record) = folder_fixture(pool).await;
    let team = record.metadata.team_id;
    let mut parent = None;
    let mut chain = Vec::new();
    for depth in 1..=8 {
        let folder = Folder {
            id: Uuid::now_v7(),
            team_id: team,
            name: format!("Depth {depth}"),
            parent_id: parent,
        };
        repository.save_folder(&folder).await.expect("depth <=8");
        parent = Some(folder.id);
        chain.push(folder);
    }
    let ninth = Folder {
        id: Uuid::now_v7(),
        team_id: team,
        name: "Ninth".into(),
        parent_id: parent,
    };
    assert!(matches!(
        repository.save_folder(&ninth).await,
        Err(Error::Invalid)
    ));
    assert!(matches!(
        repository.move_folder(team, chain[0].id, parent).await,
        Err(Error::Invalid)
    ));
    let other = Folder {
        id: Uuid::now_v7(),
        team_id: team,
        name: "Other".into(),
        parent_id: None,
    };
    repository.save_folder(&other).await.expect("root");
    assert!(matches!(
        repository
            .move_folder(team, chain[0].id, Some(other.id))
            .await,
        Err(Error::Invalid)
    ));
    repository
        .move_folder(team, chain[7].id, None)
        .await
        .expect("leaf to root");
    repository
        .move_folder(team, chain[7].id, Some(chain[6].id))
        .await
        .expect("exact depth eight move");
    assert!(matches!(
        repository.move_folder(team, other.id, parent).await,
        Err(Error::Invalid)
    ));
    let (renamed, moved) = tokio::join!(
        repository.rename_folder(team, other.id, "Renamed"),
        repository.move_folder(team, other.id, Some(chain[0].id))
    );
    renamed.expect("rename");
    moved.expect("move");
    let stored = repository
        .folders(team)
        .await
        .expect("folders")
        .into_iter()
        .find(|f| f.id == other.id)
        .expect("stored");
    assert_eq!(stored.name, "Renamed");
    assert_eq!(stored.parent_id, Some(chain[0].id));
    repository
        .purge_team_metadata(team)
        .await
        .expect("nested team purge");
    assert!(repository.folders(team).await.expect("empty").is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn opposite_moves_cannot_create_cycle_and_folder_cap_is_enforced(pool: PgPool) {
    let (repository, _, record) = folder_fixture(pool).await;
    let team = record.metadata.team_id;
    let first = Folder {
        id: Uuid::now_v7(),
        team_id: team,
        name: "First".into(),
        parent_id: None,
    };
    let second = Folder {
        id: Uuid::now_v7(),
        team_id: team,
        name: "Second".into(),
        parent_id: None,
    };
    repository.save_folder(&first).await.expect("first");
    repository.save_folder(&second).await.expect("second");
    let (left, right) = tokio::join!(
        repository.move_folder(team, first.id, Some(second.id)),
        repository.move_folder(team, second.id, Some(first.id))
    );
    assert_eq!(usize::from(left.is_ok()) + usize::from(right.is_ok()), 1);
    assert!(matches!(left, Err(Error::Invalid)) || matches!(right, Err(Error::Invalid)));
    sqlx::query!("INSERT INTO password_folders(team_id,id,name) SELECT $1,('70000000-0000-7000-8000-'||lpad(i::text,12,'0'))::uuid,'Fixture' FROM generate_series(1,498) i",team.0)
        .execute(&repository.pool).await.expect("fill cap");
    let overflow = Folder {
        id: Uuid::now_v7(),
        team_id: team,
        name: "Overflow".into(),
        parent_id: None,
    };
    assert!(matches!(
        repository.save_folder(&overflow).await,
        Err(Error::Invalid)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_commit_barrier_prevents_stale_rename_and_save_resurrection(pool: PgPool) {
    let (repository, _, mut record) = folder_fixture(pool).await;
    let team = record.metadata.team_id;
    let folder = Folder {
        id: Uuid::now_v7(),
        team_id: team,
        name: "Removed".into(),
        parent_id: None,
    };
    repository.save_folder(&folder).await.expect("folder");
    record.metadata.folder_id = Some(folder.id);
    let (deleted, after_delete) = tokio::sync::oneshot::channel();
    let deleting = async {
        repository
            .delete_folder(team, folder.id)
            .await
            .expect("delete");
        deleted.send(()).expect("commit barrier");
    };
    let stale = async {
        after_delete.await.expect("committed delete");
        assert!(matches!(
            repository.save(&record, Some(1)).await,
            Err(Error::FolderMissing)
        ));
        assert!(matches!(
            repository.rename_folder(team, folder.id, "Stale").await,
            Err(Error::NotFound)
        ));
    };
    tokio::join!(deleting, stale);
    assert!(repository.folders(team).await.expect("folders").is_empty());
    assert!(
        repository
            .get(team, record.metadata.id)
            .await
            .expect("item")
            .metadata
            .folder_id
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cross_team_parent_and_contended_tree_lock_are_rejected(pool: PgPool) {
    let (repository, _, record) = folder_fixture(pool).await;
    let team = record.metadata.team_id;
    let (foreign, _) = another_team(&repository.pool).await;
    let parent = Folder {
        id: Uuid::now_v7(),
        team_id: foreign,
        name: "Foreign".into(),
        parent_id: None,
    };
    repository.save_folder(&parent).await.expect("foreign root");
    let mut child = Folder {
        id: Uuid::now_v7(),
        team_id: team,
        name: "Child".into(),
        parent_id: Some(parent.id),
    };
    assert!(matches!(
        repository.save_folder(&child).await,
        Err(Error::Invalid)
    ));
    child.parent_id = None;
    let held = repository
        .folder_transaction(team)
        .await
        .expect("held tree lock");
    assert!(matches!(
        repository.save_folder(&child).await,
        Err(Error::Busy)
    ));
    held.commit().await.expect("release barrier");
    repository
        .save_folder(&child)
        .await
        .expect("retry after contention");
}
