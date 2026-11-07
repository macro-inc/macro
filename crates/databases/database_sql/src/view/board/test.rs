use models_databases::views::{
    CardPosition, Lane, LaneKey, SortDirection, SortKey, ViewLayout, ViewProblem, ViewQuery,
};
use models_databases::{OptionId, RowId};
use uuid::Uuid;

use super::*;
use crate::fold::Cell;
use crate::run::{OutcomeColumn, OutcomeKind};
use crate::test_support::*;

const FIRST: RowId = RowId::from_uuid(Uuid::from_u128(0x101));
const SECOND: RowId = RowId::from_uuid(Uuid::from_u128(0x102));
const THIRD: RowId = RowId::from_uuid(Uuid::from_u128(0x103));
const FOURTH: RowId = RowId::from_uuid(Uuid::from_u128(0x104));
const FIFTH: RowId = RowId::from_uuid(Uuid::from_u128(0x105));
const SIXTH: RowId = RowId::from_uuid(Uuid::from_u128(0x106));
const NOT_AN_OPTION: OptionId = OptionId::from_uuid(Uuid::from_u128(0x999));

/// The rows a view's read found, in its order: each row's status cell.
fn outcome(rows: &[(RowId, Option<Cell>)]) -> Outcome {
    Outcome {
        columns: vec![
            OutcomeColumn {
                name: "summary".into(),
                column: Some(SUMMARY),
                kind: OutcomeKind::Text,
                table: None,
            },
            OutcomeColumn {
                name: "status".into(),
                column: Some(STATUS),
                kind: OutcomeKind::Select,
                table: None,
            },
        ],
        rows: rows
            .iter()
            .map(|(_, status)| vec![Some(Cell::Text("card".into())), status.clone()])
            .collect(),
        row_ids: rows.iter().map(|(row, _)| *row).collect(),
        read_tables: vec![ISSUES],
        ..Outcome::default()
    }
}

#[test]
fn cards_sit_in_their_lanes_in_hand_arranged_order() {
    let view = issues_view(
        ViewQuery::default(),
        ViewLayout::Board {
            group_by: STATUS_PLACEMENT,
            title: SUMMARY_PLACEMENT,
            lanes: vec![Lane {
                key: LaneKey::Option(DOING),
                hidden: false,
            }],
            card_fields: vec![SUMMARY_PLACEMENT],
            hide_empty_lanes: true,
        },
    );
    let outcome = Outcome {
        columns: vec![
            OutcomeColumn {
                name: "summary".into(),
                column: Some(SUMMARY),
                kind: OutcomeKind::Text,
                table: None,
            },
            OutcomeColumn {
                name: "status".into(),
                column: Some(STATUS),
                kind: OutcomeKind::Select,
                table: None,
            },
        ],
        rows: vec![
            vec![
                Some(Cell::Text("Fix login".into())),
                Some(Cell::Options(vec![TODO])),
            ],
            vec![
                Some(Cell::Text("Write docs".into())),
                Some(Cell::Options(vec![DOING])),
            ],
            vec![Some(Cell::Text("Triage".into())), None],
            vec![
                Some(Cell::Text("Ship it".into())),
                Some(Cell::Options(vec![DOING])),
            ],
            vec![
                Some(Cell::Text("Plan".into())),
                Some(Cell::Options(vec![TODO])),
            ],
            vec![
                Some(Cell::Text("Orphan".into())),
                Some(Cell::Options(vec![NOT_AN_OPTION])),
            ],
        ],
        row_ids: vec![FIRST, SECOND, THIRD, FOURTH, FIFTH, SIXTH],
        read_tables: vec![ISSUES],
        ..Outcome::default()
    };
    let positions = vec![
        CardPosition {
            row: FOURTH,
            lane: LaneKey::Option(DOING),
            position: "80".parse().unwrap(),
        },
        CardPosition {
            row: FIFTH,
            lane: LaneKey::Option(TODO),
            position: "8180".parse().unwrap(),
        },
        // Placed when it was in Doing; it has since moved to Todo.
        CardPosition {
            row: FIRST,
            lane: LaneKey::Option(DOING),
            position: "7f80".parse().unwrap(),
        },
    ];

    assert_eq!(
        board(&view, &issues_catalog(), &outcome, &positions),
        Ok(Board {
            lanes: vec![
                BoardLane {
                    key: LaneKey::Option(DOING),
                    hidden: false,
                    cards: vec![FOURTH, SECOND],
                },
                BoardLane {
                    key: LaneKey::None,
                    hidden: false,
                    cards: vec![THIRD, SIXTH],
                },
                BoardLane {
                    key: LaneKey::Option(TODO),
                    hidden: false,
                    cards: vec![FIFTH, FIRST],
                },
                BoardLane {
                    key: LaneKey::Option(WONT_DO),
                    hidden: true,
                    cards: vec![],
                },
            ],
        })
    );
}

#[test]
fn unpositioned_cards_follow_positioned_ones_by_row_id() {
    let view = issues_view(
        ViewQuery::default(),
        ViewLayout::Board {
            group_by: STATUS_PLACEMENT,
            title: SUMMARY_PLACEMENT,
            lanes: vec![],
            card_fields: vec![SUMMARY_PLACEMENT],
            hide_empty_lanes: false,
        },
    );
    let rows = outcome(&[
        (THIRD, Some(Cell::Options(vec![TODO]))),
        (SECOND, Some(Cell::Options(vec![TODO]))),
        (FIRST, Some(Cell::Options(vec![TODO]))),
        (FOURTH, Some(Cell::Options(vec![TODO]))),
    ]);
    let positions = vec![
        CardPosition {
            row: FOURTH,
            lane: LaneKey::Option(TODO),
            position: "8180".parse().unwrap(),
        },
        CardPosition {
            row: THIRD,
            lane: LaneKey::Option(TODO),
            position: "80".parse().unwrap(),
        },
    ];

    let board = board(&view, &issues_catalog(), &rows, &positions).unwrap();

    assert_eq!(
        board.lanes[1],
        BoardLane {
            key: LaneKey::Option(TODO),
            hidden: false,
            cards: vec![THIRD, FOURTH, FIRST, SECOND],
        }
    );
}

#[test]
fn a_sorted_view_keeps_the_read_order_in_every_lane() {
    let view = issues_view(
        ViewQuery {
            filter: None,
            sort: vec![SortKey {
                column: SUMMARY_PLACEMENT,
                direction: SortDirection::Descending,
            }],
        },
        ViewLayout::Board {
            group_by: STATUS_PLACEMENT,
            title: SUMMARY_PLACEMENT,
            lanes: vec![],
            card_fields: vec![SUMMARY_PLACEMENT],
            hide_empty_lanes: false,
        },
    );
    let rows = outcome(&[
        (THIRD, Some(Cell::Options(vec![TODO]))),
        (FIRST, Some(Cell::Options(vec![DOING]))),
        (SECOND, Some(Cell::Options(vec![TODO]))),
    ]);
    let positions = vec![CardPosition {
        row: SECOND,
        lane: LaneKey::Option(TODO),
        position: "80".parse().unwrap(),
    }];

    assert_eq!(
        board(&view, &issues_catalog(), &rows, &positions),
        Ok(Board {
            lanes: vec![
                BoardLane {
                    key: LaneKey::None,
                    hidden: false,
                    cards: vec![],
                },
                BoardLane {
                    key: LaneKey::Option(TODO),
                    hidden: false,
                    cards: vec![THIRD, SECOND],
                },
                BoardLane {
                    key: LaneKey::Option(DOING),
                    hidden: false,
                    cards: vec![FIRST],
                },
                BoardLane {
                    key: LaneKey::Option(WONT_DO),
                    hidden: false,
                    cards: vec![],
                },
            ],
        })
    );
}

/// A lane and whether it is hidden.
type ShownLane = (LaneKey, bool);

#[test]
fn listed_lanes_come_first_and_keep_their_hidden_flag() {
    let cases: Vec<(&str, Vec<Lane>, bool, Vec<ShownLane>)> = vec![
        (
            "nothing listed: no option first, then the column's order",
            vec![],
            false,
            vec![
                (LaneKey::None, false),
                (LaneKey::Option(TODO), false),
                (LaneKey::Option(DOING), false),
                (LaneKey::Option(WONT_DO), false),
            ],
        ),
        (
            "the no-option lane listed last stays last",
            vec![
                Lane {
                    key: LaneKey::Option(WONT_DO),
                    hidden: false,
                },
                Lane {
                    key: LaneKey::None,
                    hidden: false,
                },
            ],
            false,
            vec![
                (LaneKey::Option(WONT_DO), false),
                (LaneKey::None, false),
                (LaneKey::Option(TODO), false),
                (LaneKey::Option(DOING), false),
            ],
        ),
        (
            "a listed hidden lane is hidden even with cards",
            vec![Lane {
                key: LaneKey::Option(TODO),
                hidden: true,
            }],
            false,
            vec![
                (LaneKey::Option(TODO), true),
                (LaneKey::None, false),
                (LaneKey::Option(DOING), false),
                (LaneKey::Option(WONT_DO), false),
            ],
        ),
        (
            "hiding empty lanes hides every lane without cards, listed or not",
            vec![Lane {
                key: LaneKey::Option(DOING),
                hidden: false,
            }],
            true,
            vec![
                (LaneKey::Option(DOING), true),
                (LaneKey::None, true),
                (LaneKey::Option(TODO), false),
                (LaneKey::Option(WONT_DO), true),
            ],
        ),
    ];

    for (case, lanes, hide_empty_lanes, expected) in cases {
        let view = issues_view(
            ViewQuery::default(),
            ViewLayout::Board {
                group_by: STATUS_PLACEMENT,
                title: SUMMARY_PLACEMENT,
                lanes,
                card_fields: vec![SUMMARY_PLACEMENT],
                hide_empty_lanes,
            },
        );
        let rows = outcome(&[(FIRST, Some(Cell::Options(vec![TODO])))]);

        let board = board(&view, &issues_catalog(), &rows, &[]).unwrap();

        assert_eq!(
            board
                .lanes
                .iter()
                .map(|lane| (lane.key.clone(), lane.hidden))
                .collect::<Vec<_>>(),
            expected,
            "{case}"
        );
    }
}

#[test]
fn an_empty_options_cell_is_a_card_without_an_option() {
    let view = issues_view(
        ViewQuery::default(),
        ViewLayout::Board {
            group_by: STATUS_PLACEMENT,
            title: SUMMARY_PLACEMENT,
            lanes: vec![],
            card_fields: vec![SUMMARY_PLACEMENT],
            hide_empty_lanes: false,
        },
    );
    let rows = outcome(&[(FIRST, Some(Cell::Options(vec![])))]);

    let board = board(&view, &issues_catalog(), &rows, &[]).unwrap();

    assert_eq!(
        board.lanes[0],
        BoardLane {
            key: LaneKey::None,
            hidden: false,
            cards: vec![FIRST],
        }
    );
}

#[test]
fn only_a_board_view_of_a_visible_table_lays_out() {
    let table = issues_view(ViewQuery::default(), ViewLayout::Table { columns: vec![] });
    assert_eq!(
        board(&table, &issues_catalog(), &outcome(&[]), &[]),
        Err(ViewProblem::NotABoard)
    );

    let elsewhere = models_databases::views::DatabaseView {
        table_id: DEALS,
        ..issues_view(
            ViewQuery::default(),
            ViewLayout::Board {
                group_by: STATUS_PLACEMENT,
                title: SUMMARY_PLACEMENT,
                lanes: vec![],
                card_fields: vec![SUMMARY_PLACEMENT],
                hide_empty_lanes: false,
            },
        )
    };
    assert_eq!(
        board(&elsewhere, &issues_catalog(), &outcome(&[]), &[]),
        Err(ViewProblem::UnknownTable { table: DEALS })
    );

    let by_tags = issues_view(
        ViewQuery::default(),
        ViewLayout::Board {
            group_by: LABELS_PLACEMENT,
            title: SUMMARY_PLACEMENT,
            lanes: vec![],
            card_fields: vec![],
            hide_empty_lanes: false,
        },
    );
    assert_eq!(
        board(&by_tags, &issues_catalog(), &outcome(&[]), &[]),
        Err(ViewProblem::BoardCannotGroupBy {
            column: "labels".into(),
        })
    );
}

/// The rows a view's read found, in its order: each row's assignee cell.
fn assigned(rows: &[(RowId, Option<Cell>)]) -> Outcome {
    Outcome {
        columns: vec![
            OutcomeColumn {
                name: "summary".into(),
                column: Some(SUMMARY),
                kind: OutcomeKind::Text,
                table: None,
            },
            OutcomeColumn {
                name: "assignee".into(),
                column: Some(ASSIGNEE),
                kind: OutcomeKind::Entity,
                table: None,
            },
        ],
        rows: rows
            .iter()
            .map(|(_, assignee)| vec![Some(Cell::Text("card".into())), assignee.clone()])
            .collect(),
        row_ids: rows.iter().map(|(row, _)| *row).collect(),
        read_tables: vec![ISSUES],
        ..Outcome::default()
    }
}

#[test]
fn a_board_grouped_by_a_person_has_a_lane_per_person_its_cards_name() {
    let sam = LaneKey::User("macro|sam@macro.com".try_into().unwrap());
    let ana = LaneKey::User("macro|ana@macro.com".try_into().unwrap());
    let gone = LaneKey::User("macro|gone@macro.com".try_into().unwrap());
    let view = issues_view(
        ViewQuery::default(),
        ViewLayout::Board {
            group_by: ASSIGNEE_PLACEMENT,
            title: SUMMARY_PLACEMENT,
            lanes: vec![
                Lane {
                    key: gone.clone(),
                    hidden: false,
                },
                Lane {
                    key: sam.clone(),
                    hidden: true,
                },
            ],
            card_fields: vec![SUMMARY_PLACEMENT],
            hide_empty_lanes: false,
        },
    );
    let rows = assigned(&[
        (
            FIRST,
            Some(Cell::Entities(vec!["macro|sam@macro.com".into()])),
        ),
        (SECOND, None),
        (
            THIRD,
            Some(Cell::Entities(vec!["macro|ana@macro.com".into()])),
        ),
        (
            FOURTH,
            Some(Cell::Entities(vec!["macro|sam@macro.com".into()])),
        ),
    ]);
    let positions = vec![CardPosition {
        row: FOURTH,
        lane: sam.clone(),
        position: "80".parse().unwrap(),
    }];

    let board = board(&view, &issues_catalog(), &rows, &positions).unwrap();

    assert_eq!(
        board,
        Board {
            lanes: vec![
                BoardLane {
                    key: sam,
                    hidden: true,
                    cards: vec![FOURTH, FIRST],
                },
                BoardLane {
                    key: LaneKey::None,
                    hidden: false,
                    cards: vec![SECOND],
                },
                BoardLane {
                    key: ana,
                    hidden: false,
                    cards: vec![THIRD],
                },
            ],
        }
    );
}

#[test]
fn a_board_grouped_by_several_people_is_refused() {
    let view = issues_view(
        ViewQuery::default(),
        ViewLayout::Board {
            group_by: REVIEWERS_PLACEMENT,
            title: SUMMARY_PLACEMENT,
            lanes: vec![],
            card_fields: vec![],
            hide_empty_lanes: false,
        },
    );
    assert_eq!(
        board(&view, &issues_catalog(), &assigned(&[]), &[]),
        Err(ViewProblem::BoardCannotGroupBy {
            column: "reviewers".into(),
        })
    );
}
