//! Templates: each one's ops build an empty database into what it promises,
//! a database and its template commit together, and the starter is the
//! Getting started template, given once.

use models_databases::EntityKind;
use models_databases::views::{LaneKey, ViewLayout};

use super::*;
use crate::domain::models::NewDatabase;
use crate::domain::starter::{DatabaseStarterService, StarterDatabase};
use crate::domain::templates::{TEMPLATES, TemplateIcon, TemplateId};

/// A table as a template built it, every part named rather than by id.
#[derive(Debug, PartialEq)]
struct BuiltTable<'a> {
    name: &'a str,
    columns: Vec<BuiltColumn<'a>>,
    views: Vec<BuiltView<'a>>,
    rows: usize,
}

#[derive(Debug, PartialEq)]
struct BuiltColumn<'a> {
    name: &'a str,
    kind: ColumnKind,
    options: Vec<&'a str>,
}

#[derive(Debug, PartialEq)]
enum BuiltView<'a> {
    Table {
        name: &'a str,
    },
    Board {
        name: &'a str,
        group_by: &'a str,
        title: &'a str,
        lanes: Vec<&'a str>,
        card_fields: Vec<&'a str>,
    },
}

fn option_label(option: &PropertyOption) -> &str {
    match &option.value {
        PropertyOptionValue::String(label) => label,
        other => panic!("templates only make text options, got {other:?}"),
    }
}

/// The database's tables as the template built them, in tab order.
fn built<'a>(detail: &'a DatabaseDetail, world: &Shared) -> Vec<BuiltTable<'a>> {
    let world = world.lock().unwrap();
    detail
        .tables
        .iter()
        .map(|table| {
            let column_named = |id: ColumnId| {
                table
                    .columns
                    .iter()
                    .find(|column| column.column.id == id)
                    .expect("a view names a column of its table")
            };
            BuiltTable {
                name: &table.table.name,
                columns: table
                    .columns
                    .iter()
                    .map(|column| BuiltColumn {
                        name: column.name(),
                        kind: catalog::column_kind(&column.column, &column.definition)
                            .expect("templates make columns of nameable types"),
                        options: column
                            .definition
                            .property_options
                            .iter()
                            .map(option_label)
                            .collect(),
                    })
                    .collect(),
                views: table
                    .views
                    .iter()
                    .map(|view| match &view.layout {
                        ViewLayout::Table { .. } => BuiltView::Table { name: &view.name },
                        ViewLayout::Board {
                            group_by,
                            title,
                            lanes,
                            card_fields,
                            ..
                        } => {
                            let grouping = column_named(*group_by);
                            BuiltView::Board {
                                name: &view.name,
                                group_by: grouping.name(),
                                title: column_named(*title).name(),
                                lanes: lanes
                                    .iter()
                                    .map(|lane| match lane.key {
                                        LaneKey::Option(option) => grouping
                                            .definition
                                            .property_options
                                            .iter()
                                            .find(|stored| stored.id == option.into_uuid())
                                            .map(option_label)
                                            .expect("a lane names an option of its column"),
                                        ref other => panic!("an option lane, got {other:?}"),
                                    })
                                    .collect(),
                                card_fields: card_fields
                                    .iter()
                                    .map(|field| column_named(*field).name())
                                    .collect(),
                            }
                        }
                    })
                    .collect(),
                rows: world.rows.get(&table.table.id).map_or(0, Vec::len),
            }
        })
        .collect()
}

async fn create_from(template: TemplateId, name: &str) -> (Shared, Service, DatabaseDetail) {
    let world: Shared = Arc::default();
    let service = service(&world);
    let database = service
        .create_database(CreateDatabase {
            name: name.into(),
            owner_id: user(OWNER),
            acting_bot: None,
            template: Some(template),
        })
        .await
        .unwrap();
    let detail = service
        .get_database(receipt::<ViewAccessLevel>(
            database.id,
            OWNER,
            AccessLevel::Owner,
        ))
        .await
        .unwrap();
    (world, service, detail)
}

fn table_id(detail: &DatabaseDetail, name: &str) -> TableId {
    detail
        .tables
        .iter()
        .find(|table| table.table.name == name)
        .map(|table| table.table.id)
        .unwrap()
}

const SELECT: ColumnKind = ColumnKind::Select { multi: false };
const PERSON: ColumnKind = ColumnKind::Entity {
    target: EntityKind::User,
    multi: false,
};

#[test]
fn the_templates_are_listed_in_picker_order_each_under_its_own_slug() {
    let listed: Vec<(TemplateId, &str, TemplateIcon)> = TEMPLATES
        .iter()
        .map(|template| (template.id, template.name, template.icon))
        .collect();
    assert_eq!(
        listed,
        vec![
            (
                TemplateId::ProjectTracker,
                "Project tracker",
                TemplateIcon::Kanban
            ),
            (
                TemplateId::EventPlanner,
                "Event planner",
                TemplateIcon::Confetti
            ),
            (
                TemplateId::ContentCalendar,
                "Content calendar",
                TemplateIcon::Calendar
            ),
            (TemplateId::ReadingList, "Reading list", TemplateIcon::Books),
            (
                TemplateId::TripPlanner,
                "Trip planner",
                TemplateIcon::MapTrifold
            ),
            (
                TemplateId::HabitTracker,
                "Habit tracker",
                TemplateIcon::Checks
            ),
            (
                TemplateId::RecipeCollection,
                "Recipe collection",
                TemplateIcon::ForkKnife
            ),
            (
                TemplateId::GettingStarted,
                "Getting started",
                TemplateIcon::Sparkle
            ),
        ]
    );
    for template in &TEMPLATES {
        assert_eq!(template.id.template().id, template.id);
    }
    assert_eq!(
        serde_json::to_value(TEMPLATES[0]).unwrap(),
        serde_json::json!({
            "id": "project_tracker",
            "name": "Project tracker",
            "description": "Tasks with a status, an owner, a due date and a priority, on a board by status.",
            "icon": "kanban",
        })
    );
}

#[tokio::test]
async fn the_project_tracker_builds_tasks_with_a_board_by_status() {
    let (world, _, detail) = create_from(TemplateId::ProjectTracker, "Launch").await;
    assert_eq!(detail.database.name, "Launch");
    assert_eq!(
        built(&detail, &world),
        vec![BuiltTable {
            name: "Tasks",
            columns: vec![
                BuiltColumn {
                    name: "Name",
                    kind: ColumnKind::Text,
                    options: vec![],
                },
                BuiltColumn {
                    name: "Status",
                    kind: SELECT,
                    options: vec!["To do", "In progress", "Done"],
                },
                BuiltColumn {
                    name: "Owner",
                    kind: PERSON,
                    options: vec![],
                },
                BuiltColumn {
                    name: "Due",
                    kind: ColumnKind::Date,
                    options: vec![],
                },
                BuiltColumn {
                    name: "Priority",
                    kind: SELECT,
                    options: vec!["High", "Medium", "Low"],
                },
            ],
            views: vec![
                BuiltView::Board {
                    name: "By status",
                    group_by: "Status",
                    title: "Name",
                    lanes: vec!["To do", "In progress", "Done"],
                    card_fields: vec!["Owner", "Due", "Priority"],
                },
                BuiltView::Table { name: "Open tasks" },
            ],
            rows: 4,
        }]
    );
}

#[tokio::test]
async fn the_event_planner_builds_parties_and_an_rsvp_board_of_invites() {
    let (world, _, detail) = create_from(TemplateId::EventPlanner, "Events").await;
    let parties = table_id(&detail, "Parties");
    assert_eq!(
        built(&detail, &world),
        vec![
            BuiltTable {
                name: "Parties",
                columns: vec![
                    BuiltColumn {
                        name: "Name",
                        kind: ColumnKind::Text,
                        options: vec![],
                    },
                    BuiltColumn {
                        name: "Location",
                        kind: ColumnKind::Text,
                        options: vec![],
                    },
                    BuiltColumn {
                        name: "Host",
                        kind: PERSON,
                        options: vec![],
                    },
                    BuiltColumn {
                        name: "Date",
                        kind: ColumnKind::Date,
                        options: vec![],
                    },
                ],
                views: vec![BuiltView::Table { name: "By date" }],
                rows: 2,
            },
            BuiltTable {
                name: "Invites",
                columns: vec![
                    BuiltColumn {
                        name: "Guest Name",
                        kind: ColumnKind::Text,
                        options: vec![],
                    },
                    BuiltColumn {
                        name: "Email",
                        kind: ColumnKind::Text,
                        options: vec![],
                    },
                    BuiltColumn {
                        name: "RSVP",
                        kind: SELECT,
                        options: vec!["Invited", "Going", "Maybe", "Declined"],
                    },
                    BuiltColumn {
                        name: "Plus Ones",
                        kind: ColumnKind::Number,
                        options: vec![],
                    },
                    BuiltColumn {
                        name: "Party",
                        kind: ColumnKind::Relation {
                            database: detail.database.id,
                            table: parties,
                        },
                        options: vec![],
                    },
                ],
                views: vec![
                    BuiltView::Board {
                        name: "RSVPs",
                        group_by: "RSVP",
                        title: "Guest Name",
                        lanes: vec!["Invited", "Going", "Maybe", "Declined"],
                        card_fields: vec!["Email", "Plus Ones"],
                    },
                    BuiltView::Table {
                        name: "Awaiting reply",
                    },
                ],
                rows: 4,
            },
        ]
    );
}

#[tokio::test]
async fn the_content_calendar_builds_posts_with_a_board_by_status() {
    let (world, _, detail) = create_from(TemplateId::ContentCalendar, "Content").await;
    assert_eq!(
        built(&detail, &world),
        vec![BuiltTable {
            name: "Posts",
            columns: vec![
                BuiltColumn {
                    name: "Title",
                    kind: ColumnKind::Text,
                    options: vec![],
                },
                BuiltColumn {
                    name: "Status",
                    kind: SELECT,
                    options: vec!["Idea", "Drafting", "Scheduled", "Published"],
                },
                BuiltColumn {
                    name: "Channel",
                    kind: SELECT,
                    options: vec!["Blog", "Newsletter", "LinkedIn", "X"],
                },
                BuiltColumn {
                    name: "Publish date",
                    kind: ColumnKind::Date,
                    options: vec![],
                },
                BuiltColumn {
                    name: "Author",
                    kind: PERSON,
                    options: vec![],
                },
            ],
            views: vec![
                BuiltView::Board {
                    name: "By status",
                    group_by: "Status",
                    title: "Title",
                    lanes: vec!["Idea", "Drafting", "Scheduled", "Published"],
                    card_fields: vec!["Channel", "Publish date", "Author"],
                },
                BuiltView::Table {
                    name: "Publishing queue",
                },
            ],
            rows: 4,
        }]
    );
}

#[tokio::test]
async fn the_reading_list_builds_books() {
    let (world, _, detail) = create_from(TemplateId::ReadingList, "Books").await;
    assert_eq!(
        built(&detail, &world),
        vec![BuiltTable {
            name: "Books",
            columns: vec![
                BuiltColumn {
                    name: "Title",
                    kind: ColumnKind::Text,
                    options: vec![],
                },
                BuiltColumn {
                    name: "Author",
                    kind: ColumnKind::Text,
                    options: vec![],
                },
                BuiltColumn {
                    name: "Status",
                    kind: SELECT,
                    options: vec!["Want to read", "Reading", "Finished"],
                },
                BuiltColumn {
                    name: "Rating",
                    kind: ColumnKind::Number,
                    options: vec![],
                },
                BuiltColumn {
                    name: "Link",
                    kind: ColumnKind::Link,
                    options: vec![],
                },
            ],
            views: vec![
                BuiltView::Table { name: "To read" },
                BuiltView::Board {
                    name: "By status",
                    group_by: "Status",
                    title: "Title",
                    lanes: vec!["Want to read", "Reading", "Finished"],
                    card_fields: vec!["Author", "Rating"],
                },
            ],
            rows: 3,
        }]
    );
}

#[tokio::test]
async fn getting_started_builds_ideas_on_a_board_by_stage() {
    let (world, _, detail) = create_from(TemplateId::GettingStarted, "Getting started").await;
    assert_eq!(
        built(&detail, &world),
        vec![BuiltTable {
            name: "Ideas",
            columns: vec![
                BuiltColumn {
                    name: "Name",
                    kind: ColumnKind::Text,
                    options: vec![],
                },
                BuiltColumn {
                    name: "Stage",
                    kind: SELECT,
                    options: vec!["To do", "Doing", "Done"],
                },
            ],
            views: vec![BuiltView::Board {
                name: "By stage",
                group_by: "Stage",
                title: "Name",
                lanes: vec!["To do", "Doing", "Done"],
                card_fields: vec![],
            }],
            rows: 3,
        }]
    );
    let ideas = &detail.tables[0];
    let [name, stage] = [&ideas.columns[0], &ideas.columns[1]];
    let label = |id: Uuid| {
        stage
            .definition
            .property_options
            .iter()
            .find(|option| option.id == id)
            .map(option_label)
            .unwrap()
            .to_owned()
    };
    let cells: Vec<(String, String)> = row_ids(&world, ideas.table.id)
        .into_iter()
        .map(|row| {
            let Some(PropertyValue::Str(title)) = cell(&world, row, name.definition.definition.id)
            else {
                panic!("every idea has a name");
            };
            let Some(PropertyValue::SelectOption(chosen)) =
                cell(&world, row, stage.definition.definition.id)
            else {
                panic!("every idea has a stage");
            };
            (title, label(chosen[0]))
        })
        .collect();
    assert_eq!(
        cells,
        vec![
            ("Add your first idea".to_owned(), "To do".to_owned()),
            ("Try moving a card".to_owned(), "Doing".to_owned()),
            (
                "Explore All records and the board".to_owned(),
                "Done".to_owned()
            ),
        ]
    );
}

#[tokio::test]
async fn every_template_view_adds_something_beyond_all_records() {
    for template in &TEMPLATES {
        let (_, _, detail) = create_from(template.id, template.name).await;
        for table in &detail.tables {
            for (index, view) in table.views.iter().enumerate() {
                if matches!(view.layout, ViewLayout::Table { .. }) {
                    assert_ne!(
                        view.query,
                        models_databases::views::ViewQuery::default(),
                        "{} / {} / {} duplicates All records",
                        template.name,
                        table.table.name,
                        view.name,
                    );
                }
                for other in &table.views[..index] {
                    assert!(
                        view.query != other.query || view.layout != other.layout,
                        "{} / {}: {} duplicates {}",
                        template.name,
                        table.table.name,
                        view.name,
                        other.name,
                    );
                }
            }
        }
    }
}

#[tokio::test]
async fn template_sample_rows_name_no_people() {
    for template in &TEMPLATES {
        let (world, _, detail) = create_from(template.id, template.name).await;
        for table in &detail.tables {
            let people: Vec<PropertyDefinitionId> = table
                .columns
                .iter()
                .filter(|column| column.definition.definition.data_type == DataType::Entity)
                .map(|column| column.definition.definition.id)
                .collect();
            for row in row_ids(&world, table.table.id) {
                for person in &people {
                    assert_eq!(
                        cell(&world, row, *person),
                        None,
                        "{} leaves {} empty",
                        template.name,
                        table.table.name
                    );
                }
            }
        }
    }
}

#[tokio::test]
async fn a_template_database_is_owned_by_its_creator_and_announced_once() {
    let (world, service, detail) = create_from(TemplateId::ReadingList, "  Books ").await;
    assert_eq!(detail.database.name, "Books");
    assert_eq!(detail.database.owner_id, OWNER);
    assert_eq!(detail.grant, AccessLevel::Owner);
    assert!(
        service
            .list_databases(viewer(STRANGER))
            .await
            .unwrap()
            .is_empty()
    );
    let events = world.lock().unwrap().broker_events.clone();
    let types: Vec<&str> = events
        .iter()
        .map(|event| event["event_type"].as_str().unwrap())
        .collect();
    assert_eq!(types, ["database.created", "database.tables_changed"]);
}

#[tokio::test]
async fn a_refused_op_creates_no_database() {
    let world: Shared = Arc::default();
    let service = service(&world);
    let table = TableId::new();
    let new = NewDatabase {
        database: Database {
            id: DatabaseId::new(),
            name: "Broken".into(),
            owner_id: OWNER.into(),
            created_at: Utc::now(),
            trashed_at: None,
        },
        starter: false,
    };
    let refused = service
        .create_with_ops(
            &new,
            &viewer(OWNER),
            &OpBatch::from(vec![
                DatabaseOp::Table {
                    table,
                    change: TableChange::Create {
                        name: "Tasks".into(),
                    },
                },
                DatabaseOp::Column {
                    table: TableId::new(),
                    column: ColumnId::new(),
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Name".into(),
                            kind: ColumnKind::Text,
                            options: vec![],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
            ]),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(refused, DatabaseError::InvalidOp(OpRefusal { op: 1, .. })),
        "{refused:?}"
    );
    let world = world.lock().unwrap();
    assert!(world.databases.is_empty());
    assert!(world.tables.is_empty());
    assert!(world.grants.is_empty());
    assert!(world.broker_events.is_empty());
}

#[tokio::test]
async fn a_write_the_store_refuses_takes_the_new_database_with_it() {
    let world: Shared = Arc::default();
    world.lock().unwrap().table_write_not_found = true;
    let service = service(&world);
    let refused = service
        .create_database(CreateDatabase {
            name: "Launch".into(),
            owner_id: user(OWNER),
            acting_bot: None,
            template: Some(TemplateId::ProjectTracker),
        })
        .await
        .unwrap_err();
    assert!(matches!(refused, DatabaseError::NotFound), "{refused:?}");
    let world = world.lock().unwrap();
    assert!(world.databases.is_empty());
    assert!(world.tables.is_empty());
    assert!(world.definitions.is_empty());
    assert!(world.grants.is_empty());
    assert!(world.broker_events.is_empty());
}

#[tokio::test]
async fn the_starter_is_getting_started_given_once() {
    let world: Shared = Arc::default();
    let service = service(&world);
    let first = service.ensure_starter(viewer(OWNER)).await.unwrap();
    let database_id = first.database_id.expect("the first request creates it");
    let detail = service
        .get_database(receipt::<ViewAccessLevel>(
            database_id,
            OWNER,
            AccessLevel::Owner,
        ))
        .await
        .unwrap();
    assert_eq!(detail.database.name, "Getting started");
    let ideas = &detail.tables[0];
    assert_eq!(
        first,
        StarterDatabase {
            database_id: Some(database_id),
            table_id: Some(ideas.table.id),
            view_id: Some(ideas.views[0].id),
            created: true,
        }
    );
    assert_eq!(ideas.views[0].name, "By stage");

    let again = service.ensure_starter(viewer(OWNER)).await.unwrap();
    assert_eq!(
        again,
        StarterDatabase {
            database_id: Some(database_id),
            table_id: None,
            view_id: None,
            created: false,
        }
    );
    assert_eq!(world.lock().unwrap().databases.len(), 1);

    service
        .trash_database(receipt::<OwnerAccessLevel>(
            database_id,
            OWNER,
            AccessLevel::Owner,
        ))
        .await
        .unwrap();
    assert_eq!(
        service.ensure_starter(viewer(OWNER)).await.unwrap(),
        StarterDatabase {
            database_id: None,
            table_id: None,
            view_id: None,
            created: false,
        }
    );
    assert_eq!(world.lock().unwrap().databases.len(), 1);
}

#[tokio::test]
async fn a_user_with_a_database_is_never_given_a_starter() {
    let world: Shared = Arc::default();
    let service = service(&world);
    let own = service
        .create_database(CreateDatabase {
            name: "Mine".into(),
            owner_id: user(OWNER),
            acting_bot: None,
            template: None,
        })
        .await
        .unwrap();
    let none = StarterDatabase {
        database_id: None,
        table_id: None,
        view_id: None,
        created: false,
    };
    assert_eq!(service.ensure_starter(viewer(OWNER)).await.unwrap(), none);
    service
        .delete_database_permanently(receipt::<OwnerAccessLevel>(
            own.id,
            OWNER,
            AccessLevel::Owner,
        ))
        .await
        .unwrap();
    assert_eq!(service.ensure_starter(viewer(OWNER)).await.unwrap(), none);
    assert!(world.lock().unwrap().databases.is_empty());
}
