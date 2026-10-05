//! SaveDatabaseView and DeleteDatabaseView: a typed view saved through the
//! view ops, created under a new name and replacing the view of a name the
//! table has, and a view deleted by its id.

use models_databases::views::{Lane, LaneKey, NewView, RequestedLayout, ViewLayout, ViewQuery};
use models_databases::{DatabaseOp, ViewChange};

use super::*;

fn board() -> SaveDatabaseView {
    SaveDatabaseView {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        name: "Stages".into(),
        filter: None,
        sort: vec![],
        layout: RequestedLayout::Board {
            group_by: COLUMN_ID,
            title: None,
            lanes: vec![],
            card_fields: vec![],
            hide_empty_lanes: true,
        },
    }
}

#[tokio::test]
async fn a_new_name_creates_the_view_through_an_op() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));

    let saved = board()
        .call(ServiceContext(context), request_context())
        .await
        .unwrap();

    assert_eq!(
        calls.lock().unwrap().acting_bots,
        vec![Some(bot_id::MACRO_AI_BOT_ID)]
    );
    // The tool mints the new view's id; the view saved is the one it named.
    assert!(saved.created);
    assert_ne!(saved.view.id, VIEW_ID);
    assert_eq!(
        calls.lock().unwrap().applied,
        vec![OpBatch::from(vec![DatabaseOp::View {
            table: TABLE_ID,
            view: saved.view.id,
            change: ViewChange::Create {
                view: NewView {
                    name: "Stages".into(),
                    query: ViewQuery::default(),
                    layout: RequestedLayout::Board {
                        group_by: COLUMN_ID,
                        title: None,
                        lanes: vec![],
                        card_fields: vec![],
                        hide_empty_lanes: true,
                    },
                },
            },
        }])]
    );
}

#[tokio::test]
async fn the_name_of_an_existing_view_replaces_it() {
    let at = chrono::DateTime::UNIX_EPOCH;
    let service = FakeService {
        views: vec![crate::domain::models::DatabaseView {
            id: VIEW_ID,
            database_id: DATABASE_ID,
            table_id: TABLE_ID,
            name: "stages".into(),
            position: "80".parse::<Position>().unwrap(),
            query: ViewQuery::default(),
            layout: ViewLayout::Table { columns: vec![] },
            created_at: at,
            updated_at: at,
        }],
        ..FakeService::default()
    };
    let calls = service.calls.clone();
    let context = DatabasesToolContext::new(service, FakeAccess::granting(AccessLevel::Edit));

    let saved = board()
        .call(ServiceContext(context), request_context())
        .await
        .unwrap();

    assert!(!saved.created);
    assert_eq!(
        calls.lock().unwrap().applied,
        vec![OpBatch::from(vec![DatabaseOp::View {
            table: TABLE_ID,
            view: VIEW_ID,
            change: ViewChange::Update {
                name: Some("Stages".into()),
                query: Some(ViewQuery::default()),
                layout: Some(RequestedLayout::Board {
                    group_by: COLUMN_ID,
                    title: None,
                    lanes: vec![],
                    card_fields: vec![],
                    hide_empty_lanes: true,
                }),
            },
        }])]
    );
}

#[tokio::test]
async fn a_viewer_cannot_save_a_view() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::View));

    let error = board()
        .call(ServiceContext(context), request_context())
        .await
        .unwrap_err();

    assert!(
        error.description.contains("permission to edit"),
        "{}",
        error.description
    );
    assert!(calls.lock().unwrap().applied.is_empty());
}

fn stored_view() -> crate::domain::models::DatabaseView {
    let at = chrono::DateTime::UNIX_EPOCH;
    crate::domain::models::DatabaseView {
        id: VIEW_ID,
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        name: "Stages".into(),
        position: "80".parse::<Position>().unwrap(),
        query: ViewQuery::default(),
        layout: ViewLayout::Table { columns: vec![] },
        created_at: at,
        updated_at: at,
    }
}

#[tokio::test]
async fn a_view_is_deleted_through_an_op_on_its_table() {
    let service = FakeService {
        views: vec![stored_view()],
        ..FakeService::default()
    };
    let calls = service.calls.clone();
    let context = DatabasesToolContext::new(service, FakeAccess::granting(AccessLevel::Edit));

    let deleted = DeleteDatabaseView {
        database_id: DATABASE_ID,
        view_id: VIEW_ID,
    }
    .call(ServiceContext(context), request_context())
    .await
    .unwrap();

    assert_eq!(
        deleted,
        DeletedDatabaseView {
            database_id: DATABASE_ID,
            table_id: TABLE_ID,
            view_id: VIEW_ID,
            name: "Stages".into(),
        }
    );
    assert_eq!(
        calls.lock().unwrap().applied,
        vec![OpBatch::from(vec![DatabaseOp::View {
            table: TABLE_ID,
            view: VIEW_ID,
            change: ViewChange::Delete,
        }])]
    );
}

#[tokio::test]
async fn a_view_the_database_lacks_is_not_deleted() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));

    let error = DeleteDatabaseView {
        database_id: DATABASE_ID,
        view_id: VIEW_ID,
    }
    .call(ServiceContext(context), request_context())
    .await
    .unwrap_err();

    assert_eq!(
        error.description,
        format!(
            "Database {DATABASE_ID} has no view with id {VIEW_ID}. Call DescribeDatabase for \
             its tables' views."
        )
    );
    assert!(calls.lock().unwrap().applied.is_empty());
}

#[tokio::test]
async fn a_viewer_cannot_delete_a_view() {
    let service = FakeService {
        views: vec![stored_view()],
        ..FakeService::default()
    };
    let calls = service.calls.clone();
    let context = DatabasesToolContext::new(service, FakeAccess::granting(AccessLevel::View));

    let error = DeleteDatabaseView {
        database_id: DATABASE_ID,
        view_id: VIEW_ID,
    }
    .call(ServiceContext(context), request_context())
    .await
    .unwrap_err();

    assert!(
        error.description.contains("permission to edit"),
        "{}",
        error.description
    );
    assert!(calls.lock().unwrap().applied.is_empty());
}

#[tokio::test]
async fn a_board_by_person_saves_its_title_and_person_lanes() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let layout = RequestedLayout::Board {
        group_by: COLUMN_ID,
        title: Some(COLUMN_ID),
        lanes: vec![Lane {
            key: LaneKey::User("macro|sam@macro.com".try_into().unwrap()),
            hidden: true,
        }],
        card_fields: vec![],
        hide_empty_lanes: false,
    };

    let saved = SaveDatabaseView {
        layout: layout.clone(),
        ..board()
    }
    .call(ServiceContext(context), request_context())
    .await
    .unwrap();

    assert_eq!(
        calls.lock().unwrap().applied,
        vec![OpBatch::from(vec![DatabaseOp::View {
            table: TABLE_ID,
            view: saved.view.id,
            change: ViewChange::Create {
                view: NewView {
                    name: "Stages".into(),
                    query: ViewQuery::default(),
                    layout,
                },
            },
        }])]
    );
}
