use ironcalc_base::{types::CellType, Model};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut model = Model::new_empty("formulas-and-errors", "en", "UTC", "en")?;
    // A1
    model.set_user_input(0, 1, 1, "1".to_string())?;
    // A2
    model.set_user_input(0, 2, 1, "2".to_string())?;
    // A3
    model.set_user_input(0, 3, 1, "3".to_string())?;
    // B1
    model.set_user_input(0, 1, 2, "=SUM(A1:A3)".to_string())?;
    // B2
    model.set_user_input(0, 2, 2, "=B1/0".to_string())?;
    // Evaluate
    model.evaluate();

    let cells = model.get_all_cells();

    let mut cells_count = 0;
    let mut formula_count = 0;
    let mut error_count = 0;

    for cell in cells {
        if let Some(cell) = model
            .workbook
            .worksheet(cell.index)?
            .cell(cell.row, cell.column)
        {
            if cell.get_type() == CellType::ErrorValue {
                error_count += 1;
            }
            if cell.has_formula() {
                formula_count += 1;
            }

            cells_count += 1;
        }
    }

    assert_eq!(cells_count, 5);
    assert_eq!(formula_count, 2);
    assert_eq!(error_count, 1);

    Ok(())
}
