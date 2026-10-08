#![allow(clippy::unwrap_used)]

use crate::expressions::types::{Area, CellReferenceIndex};
use crate::test::util::new_empty_model;

#[test]
fn test_move_formula() {
    let mut model = new_empty_model();

    let source = &CellReferenceIndex {
        sheet: 0,
        column: 1,
        row: 1,
    };
    let value = "=A2+3";
    let target = &CellReferenceIndex {
        sheet: 0,
        column: 10,
        row: 10,
    };

    // if we move just one point formula does ot change
    let area = &Area {
        sheet: 0,
        row: 1,
        column: 1,
        width: 1,
        height: 1,
    };
    let t = model.move_cell_value_to_area(value, source, target, area);
    assert!(t.is_ok());
    assert_eq!(t.unwrap(), "=A2+3");

    // if we move a 2x2 square formula does change
    let area = &Area {
        sheet: 0,
        row: 1,
        column: 1,
        width: 2,
        height: 2,
    };
    let t = model.move_cell_value_to_area(value, source, target, area);
    assert!(t.is_ok());
    assert_eq!(t.unwrap(), "=J11+3");
}

#[test]
fn test_move_formula_wrong_args() {
    let mut model = new_empty_model();
    let t = model.add_sheet("Sheet2");
    assert!(t.is_ok());

    let source = &CellReferenceIndex {
        sheet: 0,
        column: 5,
        row: 5,
    };
    let value = "=A2+3";
    let target = &CellReferenceIndex {
        sheet: 0,
        column: 10,
        row: 10,
    };

    // different sheet
    {
        let area = &Area {
            sheet: 1,
            row: 5,
            column: 5,
            width: 1,
            height: 1,
        };
        let t = model.move_cell_value_to_area(value, source, target, area);
        assert_eq!(
            t,
            Err("Source and area are in different sheets".to_string())
        );
    }

    // not in area
    {
        let area = &Area {
            sheet: 0,
            row: 6,
            column: 4,
            width: 5,
            height: 5,
        };
        let t = model.move_cell_value_to_area(value, source, target, area);
        assert_eq!(t, Err("Source is outside the area".to_string()));
    }

    {
        let area = &Area {
            sheet: 0,
            row: 1,
            column: 4,
            width: 5,
            height: 2,
        };
        let t = model.move_cell_value_to_area(value, source, target, area);
        assert_eq!(t, Err("Source is outside the area".to_string()));
    }

    {
        let area = &Area {
            sheet: 0,
            row: 1,
            column: 6,
            width: 20,
            height: 5,
        };
        let t = model.move_cell_value_to_area(value, source, target, area);
        assert_eq!(t, Err("Source is outside the area".to_string()));
    }

    // Invalid sheet indexes
    assert_eq!(
        model.move_cell_value_to_area(
            value,
            &CellReferenceIndex {
                sheet: 0,
                row: 1,
                column: 4,
            },
            &CellReferenceIndex {
                sheet: 16,
                row: 1,
                column: 1,
            },
            &Area {
                sheet: 0,
                row: 1,
                column: 4,
                width: 5,
                height: 2,
            }
        ),
        Err("Could not find target worksheet: Invalid sheet index".to_string())
    );
    assert_eq!(
        model.move_cell_value_to_area(
            value,
            &CellReferenceIndex {
                sheet: 3,
                column: 1,
                row: 1,
            },
            target,
            &Area {
                sheet: 3,
                row: 1,
                column: 1,
                width: 5,
                height: 5,
            },
        ),
        Err("Could not find source worksheet: Invalid sheet index".to_string())
    );
}

#[test]
fn test_move_formula_rectangle() {
    let mut model = new_empty_model();

    let value = "=B2+C2";
    let target = &CellReferenceIndex {
        sheet: 0,
        column: 10,
        row: 10,
    };

    // if we move just one point formula does not change
    let area = &Area {
        sheet: 0,
        row: 1,
        column: 1,
        width: 2,
        height: 20,
    };
    assert!(model
        .move_cell_value_to_area(
            value,
            &CellReferenceIndex {
                sheet: 0,
                column: 3,
                row: 1,
            },
            target,
            area
        )
        .is_err());
    assert!(model
        .move_cell_value_to_area(
            value,
            &CellReferenceIndex {
                sheet: 0,
                column: 2,
                row: 1,
            },
            target,
            area
        )
        .is_ok());
    assert!(model
        .move_cell_value_to_area(
            value,
            &CellReferenceIndex {
                sheet: 0,
                column: 1,
                row: 20,
            },
            target,
            area
        )
        .is_ok());
    assert!(model
        .move_cell_value_to_area(
            value,
            &CellReferenceIndex {
                sheet: 0,
                column: 1,
                row: 21,
            },
            target,
            area
        )
        .is_err());
}

#[test]
fn test_move_sign_prefixed_formulas() {
    let mut model = new_empty_model();

    let source = &CellReferenceIndex {
        sheet: 0,
        column: 1,
        row: 1,
    };
    let value = "-A2+3";
    let target = &CellReferenceIndex {
        sheet: 0,
        column: 10,
        row: 10,
    };

    let area = &Area {
        sheet: 0,
        row: 1,
        column: 1,
        width: 1,
        height: 1,
    };
    let t = model.move_cell_value_to_area(value, source, target, area);
    assert!(t.is_ok());
    assert_eq!(t.unwrap(), "=-A2+3");

    let area = &Area {
        sheet: 0,
        row: 1,
        column: 1,
        width: 2,
        height: 2,
    };
    let t = model.move_cell_value_to_area(value, source, target, area);
    assert!(t.is_ok());
    assert_eq!(t.unwrap(), "=-J11+3");
}
