use ironcalc_base::{cell::CellValue, Model};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut model = Model::new_empty("hello-world", "en", "UTC", "en")?;
    // A1
    model.set_user_input(0, 1, 1, "Hello".to_string())?;
    // B1
    model.set_user_input(0, 1, 2, "world!".to_string())?;
    // C1
    model.set_user_input(0, 1, 3, "=CONCAT(A1, \" \", B1".to_string())?;
    // evaluates
    model.evaluate();

    assert_eq!(
        model.get_cell_value_by_index(0, 1, 3),
        Ok(CellValue::String("Hello world!".to_string()))
    );
    Ok(())
}
