//! Date-range columns over the fakes: a range cell is stored as a property
//! range, a backwards range is refused, and a timeline view spans one range
//! column, which then cannot go while the timeline needs it.

use chrono::TimeZone;
use models_databases::DateRange;
use models_databases::views::{NewView, RequestedLayout, ViewLayout, ViewQuery};

use super::*;

async fn apply(seeded: &Seeded, ops: Vec<DatabaseOp>) -> Result<Vec<OpResult>, DatabaseError> {
    seeded
        .service
        .apply_ops(edit(seeded.database_id), viewer(OWNER), ops.into())
        .await
}

fn refusal(result: Result<Vec<OpResult>, DatabaseError>) -> String {
    match result {
        Err(DatabaseError::InvalidOp(refusal)) => refusal.reason,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

/// Seeded with a `Stay` date-range column, answering its id.
async fn with_stay(seeded: &Seeded) -> ColumnId {
    let stay = ColumnId::new();
    apply(
        seeded,
        vec![DatabaseOp::Column {
            table: seeded.table_id,
            column: stay,
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Stay".into(),
                    kind: ColumnKind::DateRange,
                    options: vec![],
                    infer_type: false,
                },
                after: None,
            },
        }],
    )
    .await
    .unwrap();
    stay
}

fn write_stay(seeded: &Seeded, stay: ColumnId, range: DateRange) -> Vec<DatabaseOp> {
    vec![DatabaseOp::Rows {
        table: seeded.table_id,
        change: RowsChange::Update {
            changes: RowChanges::Uniform {
                rows: vec![seeded.row_id],
                cells: vec![CellWrite {
                    column: stay,
                    value: CellValue::DateRange(range),
                }],
            },
        },
    }]
}

#[tokio::test]
async fn a_range_cell_is_stored_as_a_property_range_and_a_backwards_one_is_refused() {
    let seeded = seeded().await;
    let stay = with_stay(&seeded).await;
    let definition = seeded
        .world
        .lock()
        .unwrap()
        .columns
        .iter()
        .find(|column| column.id == stay)
        .unwrap()
        .property_definition_id;
    let march = DateRange {
        start: Utc.with_ymd_and_hms(2026, 3, 2, 0, 0, 0).unwrap(),
        end: Utc.with_ymd_and_hms(2026, 3, 6, 0, 0, 0).unwrap(),
    };

    apply(&seeded, write_stay(&seeded, stay, march))
        .await
        .unwrap();
    assert_eq!(
        seeded.world.lock().unwrap().cells[&seeded.row_id][&definition],
        PropertyValue::DateRange(
            models_properties::shared::DateRange::new(march.start, march.end).unwrap()
        )
    );

    let backwards = refusal(
        apply(
            &seeded,
            write_stay(
                &seeded,
                stay,
                DateRange {
                    start: march.end,
                    end: march.start,
                },
            ),
        )
        .await,
    );
    assert_eq!(backwards, "a date range cannot end before it starts");
}

#[tokio::test]
async fn a_timeline_spans_a_range_column_which_cannot_be_removed_while_it_does() {
    let seeded = seeded().await;
    let stay = with_stay(&seeded).await;
    let create = |range: ColumnId, color_by: ColumnId| {
        vec![DatabaseOp::View {
            table: seeded.table_id,
            view: ViewId::new(),
            change: ViewChange::Create {
                view: NewView {
                    name: "Schedule".into(),
                    query: ViewQuery::default(),
                    layout: RequestedLayout::Timeline {
                        range,
                        title: None,
                        group_by: Some(seeded.status_column.id),
                        bar_fields: vec![seeded.plus_ones_column.id],
                        color_by: Some(color_by),
                    },
                },
            },
        }]
    };

    let not_a_range = refusal(
        apply(
            &seeded,
            create(seeded.plus_ones_column.id, seeded.status_column.id),
        )
        .await,
    );
    assert_eq!(
        not_a_range,
        "a timeline spans a date-range column; \"Plus ones\" is not one"
    );

    let uncolored = refusal(apply(&seeded, create(stay, seeded.plus_ones_column.id)).await);
    assert_eq!(
        uncolored,
        "a timeline is colored by a select or tag column; \"Plus ones\" is neither"
    );

    let results = apply(&seeded, create(stay, seeded.status_column.id))
        .await
        .unwrap();
    let [
        OpResult::View {
            change: ViewResult::Created { view },
            ..
        },
    ] = results.as_slice()
    else {
        panic!("expected a created view, got {results:?}");
    };
    // Left out, the title is the table's first column.
    assert_eq!(
        view.layout,
        ViewLayout::Timeline {
            range: stay,
            title: seeded.name_column.id,
            group_by: Some(seeded.status_column.id),
            bar_fields: vec![seeded.plus_ones_column.id],
            color_by: Some(seeded.status_column.id),
        }
    );

    let removed = refusal(
        apply(
            &seeded,
            vec![DatabaseOp::Column {
                table: seeded.table_id,
                column: stay,
                change: ColumnChange::Delete,
            }],
        )
        .await,
    );
    assert_eq!(
        removed,
        SchemaError::TimelineSpansRemovedColumn {
            timeline: "Schedule".into(),
        }
        .to_string()
    );

    // Its grouping and coloring column can go: the timeline stops grouping
    // and coloring by it.
    apply(
        &seeded,
        vec![DatabaseOp::Column {
            table: seeded.table_id,
            column: seeded.status_column.id,
            change: ColumnChange::Delete,
        }],
    )
    .await
    .unwrap();
    let world = seeded.world.lock().unwrap();
    let stored = world
        .views
        .iter()
        .find(|stored| stored.id == view.id)
        .unwrap();
    assert_eq!(
        stored.layout,
        ViewLayout::Timeline {
            range: stay,
            title: seeded.name_column.id,
            group_by: None,
            bar_fields: vec![seeded.plus_ones_column.id],
            color_by: None,
        }
    );
}
