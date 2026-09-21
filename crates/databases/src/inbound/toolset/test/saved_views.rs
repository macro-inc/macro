use super::*;
use crate::domain::views::{DatabaseViewDefinition, FilterOperator, ViewFilter, ViewLayout};
use ::saved_views::{View, ViewPatch, ViewStorage};

#[derive(Clone, Default)]
pub(super) struct FakeViews(pub Arc<Mutex<Vec<View>>>);

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
        unimplemented!("save tool never deletes views")
    }
}

fn board() -> SaveDatabaseView {
    SaveDatabaseView {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        name: "By status".into(),
        view: DatabaseViewDefinition {
            layout: ViewLayout::Board,
            group_by: Some(COLUMN_ID),
            group_order: vec![],
            filters: vec![],
            sorts: vec![],
            hidden_columns: vec![],
            column_order: vec![],
            search: String::new(),
        },
    }
}

#[tokio::test]
async fn denied_view_never_reaches_saved_view_storage() {
    let store = FakeViews::default();
    let context =
        DatabasesToolContext::new(FakeService::default(), FakeAccess::denying(), store.clone());
    assert!(
        board()
            .call(ServiceContext(context), request_context())
            .await
            .is_err()
    );
    assert!(store.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn view_only_user_can_save_and_update_their_own_board_without_changing_records() {
    let store = FakeViews::default();
    let other = View::new(
        "macro|other@example.com".into(),
        "By status".into(),
        serde_json::json!({"kind":"database-view", "version":1, "databaseId":DATABASE_ID, "tableId":TABLE_ID, "view":{"layout":"table"}}),
    );
    let other_id = other.id;
    store.0.lock().unwrap().push(other);
    let service = FakeService::default();
    let calls = service.calls.clone();
    let context = DatabasesToolContext::new(
        service,
        FakeAccess::granting(AccessLevel::View),
        store.clone(),
    );
    let mut command = board();
    command.view.filters.push(ViewFilter {
        column_id: COLUMN_ID,
        operator: FilterOperator::Equals,
        value: "Going".into(),
    });
    let saved = command
        .call(ServiceContext(context.clone()), request_context())
        .await
        .unwrap();
    assert!(saved.created);
    assert_eq!(saved.config["kind"], "database-view");
    assert_eq!(saved.config["version"], 1);
    assert_eq!(saved.config["view"]["layout"], "board");
    assert_eq!(saved.config["view"]["groupBy"], COLUMN_ID.to_string());
    assert!(Uuid::parse_str(saved.config["view"]["filters"][0]["id"].as_str().unwrap()).is_ok());
    assert_eq!(saved.config["view"]["filters"][0]["operator"], "equals");
    command.view.search = "Ada".into();
    let updated = command
        .call(ServiceContext(context), request_context())
        .await
        .unwrap();
    assert!(!updated.created);
    assert_eq!(updated.view_id, saved.view_id);
    let views = store.0.lock().unwrap();
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
    assert_eq!(own.user_id, USER);
    assert_eq!(own.config["view"]["search"], "Ada");
    assert!(calls.lock().unwrap().executed.is_empty());
    assert!(calls.lock().unwrap().created_columns.is_empty());
}

#[tokio::test]
async fn invalid_table_column_grouping_and_filter_never_persist() {
    let store = FakeViews::default();
    let context = DatabasesToolContext::new(
        FakeService::default(),
        FakeAccess::granting(AccessLevel::Owner),
        store.clone(),
    );
    let mut wrong_table = board();
    wrong_table.table_id = Uuid::now_v7();
    let mut wrong_column = board();
    wrong_column.view.hidden_columns.push(Uuid::now_v7());
    let mut missing_group = board();
    missing_group.view.group_by = None;
    let mut invalid_filter = board();
    invalid_filter.view.filters.push(ViewFilter {
        column_id: COLUMN_ID,
        operator: FilterOperator::Gt,
        value: "1".into(),
    });
    for command in [wrong_table, wrong_column, missing_group, invalid_filter] {
        assert!(
            command
                .call(ServiceContext(context.clone()), request_context())
                .await
                .is_err()
        );
    }
    assert!(store.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn multiselect_board_preserves_lane_order_and_rejects_duplicate_keys() {
    let store = FakeViews::default();
    let context = DatabasesToolContext::new(
        FakeService {
            multi_select_group: true,
            ..Default::default()
        },
        FakeAccess::granting(AccessLevel::View),
        store.clone(),
    );
    let mut command = board();
    command.view.group_order = vec![r#"value:"Going""#.into(), "empty".into()];
    let saved = command
        .call(ServiceContext(context.clone()), request_context())
        .await
        .unwrap();
    assert_eq!(
        saved.config["view"]["groupOrder"],
        serde_json::json!([r#"value:"Going""#, "empty"])
    );
    command.view.group_order.push("empty".into());
    assert!(
        command
            .call(ServiceContext(context), request_context())
            .await
            .is_err()
    );
    assert_eq!(store.0.lock().unwrap().len(), 1);
}
