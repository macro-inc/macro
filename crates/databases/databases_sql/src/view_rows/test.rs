use std::sync::Mutex;

use database_sql::{catalog::Table, resolve::SelectQuery};
use databases::domain::{models::Viewer, receipt::database_receipt};
use models_databases::DatabaseId;
use uuid::Uuid;

use super::*;
use crate::test_support::{FakeAccess, FakeDatabases, Shared, VIEWER, user};

#[derive(Clone, Default)]
struct Rows(Arc<Mutex<Vec<Option<RowId>>>>);

const FIRST: RowId = RowId::from_uuid(Uuid::from_u128(101));
const SECOND: RowId = RowId::from_uuid(Uuid::from_u128(102));
const THIRD: RowId = RowId::from_uuid(Uuid::from_u128(103));

impl ViewRowsRepository for Rows {
    async fn page(
        &self,
        _: &Table,
        _: &SelectQuery,
        _: TableVersion,
        after: Option<RowId>,
        limit: u16,
    ) -> Result<Vec<RowId>, ViewRowsError> {
        assert_eq!(limit, 3);
        self.0.lock().unwrap().push(after);
        Ok(if after.is_none() {
            vec![FIRST, SECOND, THIRD]
        } else {
            vec![THIRD]
        })
    }
}

async fn receipt(world: &Shared, database: DatabaseId) -> EntityAccessReceipt<ViewAccessLevel> {
    database_receipt(
        &FakeAccess(world.clone()),
        &Viewer {
            user_id: user(VIEWER),
            acting_bot: None,
        },
        database,
    )
    .await
    .unwrap()
}

fn request(table_id: TableId, cursor: Option<String>) -> ViewRowsRequest {
    ViewRowsRequest {
        table_id,
        query: ViewQuery::default(),
        cursor,
        limit: 2,
    }
}

#[tokio::test]
async fn pages_continue_after_the_last_returned_row_and_stop_at_the_end() {
    let world = crate::service::test::world();
    let detail = world.lock().unwrap().databases[0].clone();
    let rows = Rows::default();
    let service = DatabaseViewRows::new(Arc::new(FakeDatabases(world.clone())), rows.clone());
    let first = service
        .page(
            receipt(&world, detail.database.id).await,
            request(detail.tables[0].table.id, None),
        )
        .await
        .unwrap();
    assert_eq!(first.rows, vec![FIRST, SECOND]);
    assert_eq!(first.version, TableVersion(1));
    assert!(first.next_cursor.is_some());
    let second = service
        .page(
            receipt(&world, detail.database.id).await,
            request(detail.tables[0].table.id, first.next_cursor),
        )
        .await
        .unwrap();
    assert_eq!(second.rows, vec![THIRD]);
    assert!(second.next_cursor.is_none());
    assert_eq!(*rows.0.lock().unwrap(), vec![None, Some(SECOND)]);
}

#[tokio::test]
async fn a_database_receipt_cannot_read_a_table_in_another_database() {
    let world = crate::service::test::world();
    let details = world.lock().unwrap().databases.clone();
    let rows = Rows::default();
    let service = DatabaseViewRows::new(Arc::new(FakeDatabases(world.clone())), rows.clone());
    let answer = service
        .page(
            receipt(&world, details[0].database.id).await,
            request(details[1].tables[0].table.id, None),
        )
        .await;
    assert!(matches!(
        answer,
        Err(ViewPageError::View(ViewProblem::UnknownTable { .. }))
    ));
    assert!(rows.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_cursor_rejects_a_changed_query_or_table_version() {
    let world = crate::service::test::world();
    let detail = world.lock().unwrap().databases[0].clone();
    let table_id = detail.tables[0].table.id;
    let rows = Rows::default();
    let service = DatabaseViewRows::new(Arc::new(FakeDatabases(world.clone())), rows.clone());
    let first = service
        .page(
            receipt(&world, detail.database.id).await,
            request(table_id, None),
        )
        .await
        .unwrap();
    let cursor = first.next_cursor.unwrap();
    let mut changed = request(table_id, Some(cursor.clone()));
    changed.query.sort.push(models_databases::views::SortKey {
        column: detail.tables[0].columns[0].column.id,
        direction: models_databases::views::SortDirection::Ascending,
    });
    assert!(matches!(
        service
            .page(receipt(&world, detail.database.id).await, changed)
            .await,
        Err(ViewPageError::InvalidCursor)
    ));
    world.lock().unwrap().databases[0].tables[0].table.version = TableVersion(2);
    assert!(matches!(
        service
            .page(
                receipt(&world, detail.database.id).await,
                request(table_id, Some(cursor))
            )
            .await,
        Err(ViewPageError::Read(ViewRowsError::Stale))
    ));
    assert_eq!(rows.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn cursor_restarts_when_shared_column_metadata_changes_without_a_version_bump() {
    let world = crate::service::test::world();
    let detail = world.lock().unwrap().databases[0].clone();
    let rows = Rows::default();
    let service = DatabaseViewRows::new(Arc::new(FakeDatabases(world.clone())), rows.clone());
    let first = service
        .page(
            receipt(&world, detail.database.id).await,
            request(detail.tables[0].table.id, None),
        )
        .await
        .unwrap();
    world.lock().unwrap().databases[0].tables[0].columns[0]
        .definition
        .definition
        .display_name = "renamed".into();
    assert!(matches!(
        service
            .page(
                receipt(&world, detail.database.id).await,
                request(detail.tables[0].table.id, first.next_cursor)
            )
            .await,
        Err(ViewPageError::Read(ViewRowsError::Stale))
    ));
    assert_eq!(rows.0.lock().unwrap().len(), 1);
}
