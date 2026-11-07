use models_databases::views::{Lane, LaneKey, NewView, RequestedLayout, ViewLayout, ViewQuery};
use models_databases::{ColumnId, DatabaseOp, OptionId, RowId, TableId, ViewChange};
use serde_json::json;
use uuid::Uuid;

use super::{layout, ops};
use crate::domain::models::ViewId;

const TABLE: TableId = TableId::from_uuid(Uuid::from_u128(0x7ab1));
const BOARD: ViewId = ViewId::from_uuid(Uuid::from_u128(0xb0a));
const NAME: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xc01a));
const STATUS: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xc01b));
const GOING: OptionId = OptionId::from_uuid(Uuid::from_u128(0x0b1));
const SAM: RowId = RowId::from_uuid(Uuid::from_u128(0x5a11));

#[test]
fn a_board_stored_before_titles_and_people_is_titled_by_the_first_column() {
    let stored = json!({
        "kind": "board",
        "groupBy": STATUS,
        "lanes": [{"option": GOING, "hidden": true}, {"option": null}],
        "cardFields": [NAME],
        "hideEmptyLanes": false,
    });

    assert_eq!(
        layout(stored, BOARD, Some(NAME)).unwrap(),
        ViewLayout::Board {
            group_by: STATUS,
            title: NAME,
            lanes: vec![
                Lane {
                    key: LaneKey::Option(GOING),
                    hidden: true,
                },
                Lane {
                    key: LaneKey::None,
                    hidden: false,
                },
            ],
            card_fields: vec![NAME],
            hide_empty_lanes: false,
        }
    );
}

#[test]
fn a_board_stored_today_reads_as_it_was_written() {
    let written = ViewLayout::Board {
        group_by: STATUS,
        title: STATUS,
        lanes: vec![Lane {
            key: LaneKey::User("macro|sam@macro.com".try_into().unwrap()),
            hidden: false,
        }],
        card_fields: vec![],
        hide_empty_lanes: true,
    };

    assert_eq!(
        layout(serde_json::to_value(&written).unwrap(), BOARD, Some(NAME)).unwrap(),
        written
    );
}

#[test]
fn a_journaled_card_move_and_board_from_before_people_read_in_todays_shape() {
    let stored = json!([
        {
            "kind": "view",
            "table": TABLE,
            "view": BOARD,
            "change": {"kind": "move_card", "row": SAM, "lane": GOING, "before": null, "after": null},
        },
        {
            "kind": "view",
            "table": TABLE,
            "view": BOARD,
            "change": {"kind": "move_card", "row": SAM, "lane": null},
        },
        {
            "kind": "view",
            "table": TABLE,
            "view": BOARD,
            "change": {
                "kind": "create",
                "view": {
                    "name": "By status",
                    "layout": {
                        "kind": "board",
                        "groupBy": STATUS,
                        "title": NAME,
                        "lanes": [{"option": GOING, "hidden": true}],
                        "cardFields": [],
                        "hideEmptyLanes": false,
                    },
                },
            },
        },
    ]);

    assert_eq!(
        ops(1, stored).unwrap(),
        vec![
            DatabaseOp::View {
                table: TABLE,
                view: BOARD,
                change: ViewChange::MoveCard {
                    row: SAM,
                    lane: LaneKey::Option(GOING),
                    before: None,
                    after: None,
                },
            },
            DatabaseOp::View {
                table: TABLE,
                view: BOARD,
                change: ViewChange::MoveCard {
                    row: SAM,
                    lane: LaneKey::None,
                    before: None,
                    after: None,
                },
            },
            DatabaseOp::View {
                table: TABLE,
                view: BOARD,
                change: ViewChange::Create {
                    view: NewView {
                        name: "By status".into(),
                        query: ViewQuery::default(),
                        layout: RequestedLayout::Board {
                            group_by: STATUS,
                            title: Some(NAME),
                            lanes: vec![Lane {
                                key: LaneKey::Option(GOING),
                                hidden: true,
                            }],
                            card_fields: vec![],
                            hide_empty_lanes: false,
                        },
                    },
                },
            },
        ]
    );
}

#[test]
fn journal_payload_version_is_checked_before_interpreting_json() {
    for version in [0, 2, i32::MAX] {
        assert!(matches!(
            ops(version, json!([])),
            Err(super::PgDatabasesRepoError::UnsupportedJournalPayloadVersion(found)) if found == version
        ));
        assert!(matches!(
            super::inverse(version, json!(null)),
            Err(super::PgDatabasesRepoError::UnsupportedJournalPayloadVersion(found)) if found == version
        ));
    }
}

#[test]
fn version_one_preserves_the_existing_inverse_json_contract() {
    let inverse = crate::domain::journal::ChangeInverse::default();
    assert_eq!(
        super::inverse(1, serde_json::to_value(&inverse).unwrap()).unwrap(),
        inverse
    );
    let mut legacy = serde_json::to_value(&inverse).unwrap();
    legacy.as_object_mut().unwrap().remove("formatVersion");
    assert_eq!(super::inverse(1, legacy).unwrap().format_version, 0);
}
