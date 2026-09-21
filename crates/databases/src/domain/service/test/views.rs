//! Saved-view policy is exercised through the domain service, independently
//! of the HTTP or agent adapter that supplies the access receipt.

use super::*;
use crate::domain::views::{
    DatabaseViewDefinition, DatabaseViewService, DatabaseViewsServiceImpl, FilterOperator,
    SaveDatabaseViewCommand, SavedDatabaseView, ViewFilter, ViewLayout,
};
use saved_views::{View, ViewPatch, ViewStorage};

#[derive(Clone, Default)]
struct FakeViews(Arc<Mutex<Vec<View>>>);

fn copy(view: &View) -> View {
    serde_json::from_value(serde_json::to_value(view).unwrap()).unwrap()
}

impl ViewStorage for FakeViews {
    type Err = std::io::Error;

    async fn get_view(&self, id: Uuid) -> Result<View, Self::Err> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .find(|view| view.id == id)
            .map(copy)
            .ok_or_else(|| std::io::Error::from(std::io::ErrorKind::NotFound))
    }

    async fn create_view(&self, view: &View) -> Result<(), Self::Err> {
        self.0.lock().unwrap().push(copy(view));
        Ok(())
    }

    async fn get_views_for_user(&self, user_id: &str) -> Result<Vec<View>, Self::Err> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|view| view.user_id == user_id)
            .map(copy)
            .collect())
    }

    async fn patch_view(&self, id: Uuid, patch: ViewPatch) -> Result<(), Self::Err> {
        let mut views = self.0.lock().unwrap();
        let view = views.iter_mut().find(|view| view.id == id).unwrap();
        if let Some(name) = patch.name {
            view.name = name;
        }
        if let Some(config) = patch.config {
            view.config = config;
        }
        Ok(())
    }

    async fn delete_view(&self, _id: Uuid) -> Result<(), Self::Err> {
        unimplemented!("saving a view never deletes one")
    }
}

struct Fixture {
    world: Shared,
    service: DatabaseViewsServiceImpl<Service, FakeViews>,
    store: FakeViews,
    database_id: DatabaseId,
    table_id: TableId,
    column_id: ColumnId,
}

impl Fixture {
    async fn new(multi_select: bool) -> Self {
        let (world, service, database_id, table_id) = seeded().await;
        let column_id = {
            let mut world = world.lock().unwrap();
            let column = world
                .columns
                .iter()
                .find(|column| {
                    world.definitions[&column.property_definition_id]
                        .definition
                        .display_name
                        == "Status"
                })
                .unwrap();
            let column_id = column.id;
            let definition_id = column.property_definition_id;
            world
                .definitions
                .get_mut(&definition_id)
                .unwrap()
                .definition
                .is_multi_select = multi_select;
            world.applied.clear();
            world.published.clear();
            world.broker_events.clear();
            column_id
        };
        let store = FakeViews::default();
        Self {
            world,
            service: DatabaseViewsServiceImpl::new(Arc::new(service), store.clone()),
            store,
            database_id,
            table_id,
            column_id,
        }
    }

    fn board(&self) -> SaveDatabaseViewCommand {
        SaveDatabaseViewCommand {
            table_id: self.table_id,
            name: "By status".into(),
            view: DatabaseViewDefinition {
                layout: ViewLayout::Board,
                group_by: Some(self.column_id),
                group_order: vec![],
                card_order: None,
                filters: vec![],
                sorts: vec![],
                hidden_columns: vec![],
                column_order: vec![],
                search: String::new(),
            },
        }
    }

    async fn save(
        &self,
        command: SaveDatabaseViewCommand,
    ) -> Result<SavedDatabaseView, DatabaseError> {
        self.service
            .save_view(
                receipt::<ViewAccessLevel>(self.database_id, VIEWER, AccessLevel::View),
                viewer(VIEWER),
                command,
            )
            .await
    }
}

#[tokio::test]
async fn unavailable_database_never_reaches_saved_view_storage() {
    let fixture = Fixture::new(false).await;
    fixture.world.lock().unwrap().databases[0].trashed_at = Some(Utc::now());
    assert!(matches!(
        fixture.save(fixture.board()).await,
        Err(DatabaseError::NotFound)
    ));
    assert!(fixture.store.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn view_only_user_can_save_and_update_their_own_board_without_changing_records() {
    let fixture = Fixture::new(false).await;
    let other = View::new(
        OWNER.into(),
        "By status".into(),
        serde_json::json!({
            "kind": "database-view", "version": 1,
            "databaseId": fixture.database_id, "tableId": fixture.table_id,
            "view": {"layout": "table"},
        }),
    );
    let other_id = other.id;
    fixture.store.0.lock().unwrap().push(other);
    let mut command = fixture.board();
    command.view.filters.push(ViewFilter {
        column_id: fixture.column_id,
        operator: FilterOperator::Equals,
        value: "Going".into(),
    });
    let saved = fixture.save(command).await.unwrap();
    assert!(saved.created);
    assert_eq!(saved.config["kind"], "database-view");
    assert_eq!(saved.config["version"], 1);
    assert_eq!(saved.config["view"]["layout"], "board");
    assert_eq!(
        saved.config["view"]["groupBy"],
        fixture.column_id.to_string()
    );
    assert!(Uuid::parse_str(saved.config["view"]["filters"][0]["id"].as_str().unwrap()).is_ok());
    assert_eq!(saved.config["view"]["filters"][0]["operator"], "equals");

    let mut command = fixture.board();
    command.name = " by STATUS ".into();
    command.view.search = "Ada".into();
    let updated = fixture.save(command).await.unwrap();
    assert!(!updated.created);
    assert_eq!(updated.view_id, saved.view_id);
    let views = fixture.store.0.lock().unwrap();
    assert_eq!(views.len(), 2);
    assert_eq!(
        views
            .iter()
            .find(|view| view.id == other_id)
            .unwrap()
            .config["view"]["layout"],
        "table"
    );
    let own = views.iter().find(|view| view.id == saved.view_id).unwrap();
    assert_eq!(own.user_id, VIEWER);
    assert_eq!(own.name, "by STATUS");
    assert_eq!(own.config["view"]["search"], "Ada");
    let world = fixture.world.lock().unwrap();
    assert!(world.applied.is_empty());
    assert!(world.published.is_empty());
    assert!(world.broker_events.is_empty());
    assert_eq!(world.columns.len(), 3);
}

#[tokio::test]
async fn invalid_table_column_grouping_and_filter_never_persist() {
    let fixture = Fixture::new(false).await;
    let mut wrong_table = fixture.board();
    wrong_table.table_id = Uuid::now_v7();
    let mut wrong_column = fixture.board();
    wrong_column.view.hidden_columns.push(Uuid::now_v7());
    let mut missing_group = fixture.board();
    missing_group.view.group_by = None;
    let mut invalid_filter = fixture.board();
    invalid_filter.view.filters.push(ViewFilter {
        column_id: fixture.column_id,
        operator: FilterOperator::Gt,
        value: "1".into(),
    });
    for command in [wrong_table, wrong_column, missing_group, invalid_filter] {
        assert!(fixture.save(command).await.is_err());
    }
    assert!(fixture.store.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn multiselect_board_preserves_lane_order_and_rejects_duplicate_keys() {
    let fixture = Fixture::new(true).await;
    let mut command = fixture.board();
    command.view.group_order = vec![r#"value:"Going""#.into(), "empty".into()];
    let saved = fixture.save(command).await.unwrap();
    assert_eq!(
        saved.config["view"]["groupOrder"],
        serde_json::json!([r#"value:"Going""#, "empty"])
    );
    let mut command = fixture.board();
    command.view.group_order = vec!["empty".into(), "empty".into()];
    assert!(fixture.save(command).await.is_err());
    assert_eq!(fixture.store.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn manual_card_positions_survive_updates_and_can_be_cleared_explicitly() {
    let fixture = Fixture::new(false).await;
    let first = Uuid::now_v7();
    let second = Uuid::now_v7();
    let order = std::collections::BTreeMap::from([
        (r#"value:"Going""#.into(), vec![second, first]),
        ("empty".into(), vec![first, second]),
    ]);
    let mut command = fixture.board();
    command.view.card_order = Some(order.clone());
    let created = fixture.save(command).await.unwrap();
    assert_eq!(
        created.config["view"]["cardOrder"],
        serde_json::json!(order)
    );

    let mut command = fixture.board();
    command.view.search = "Ada".into();
    let updated = fixture.save(command).await.unwrap();
    assert_eq!(updated.view_id, created.view_id);
    assert_eq!(
        updated.config["view"]["cardOrder"],
        serde_json::json!(order)
    );

    let mut command = fixture.board();
    command.view.card_order = Some(Default::default());
    let cleared = fixture.save(command).await.unwrap();
    assert_eq!(cleared.config["view"]["cardOrder"], serde_json::json!({}));

    let mut command = fixture.board();
    command.view.card_order = Some(order);
    fixture.save(command).await.unwrap();
    let mut command = fixture.board();
    command.view.layout = ViewLayout::Table;
    command.view.group_by = None;
    let regrouped = fixture.save(command).await.unwrap();
    assert!(regrouped.config["view"].get("cardOrder").is_none());
    assert_eq!(fixture.store.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn malformed_lane_keys_and_duplicate_card_positions_never_persist() {
    let fixture = Fixture::new(false).await;
    let row = Uuid::now_v7();
    for order in [
        std::collections::BTreeMap::from([("not-a-lane".into(), vec![row])]),
        std::collections::BTreeMap::from([("empty".into(), vec![row, row])]),
    ] {
        let mut command = fixture.board();
        command.view.card_order = Some(order);
        assert!(fixture.save(command).await.is_err());
    }
    assert!(fixture.store.0.lock().unwrap().is_empty());
}
