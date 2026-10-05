#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_sheet_markup() {
    let mut model = new_empty_model();
    model._set("A1", "Item");
    model._set("B1", "Cost");
    model._set("A2", "Rent");
    model._set("B2", "$600");
    model._set("A3", "Electricity");
    model._set("B3", "$200");
    model._set("A4", "Total");
    model._set("B4", "=SUM(B2:B3)");

    let mut style = model.get_style_for_cell(0, 1, 1).unwrap();
    style.font.b = true;
    model.set_cell_style(0, 1, 1, &style).unwrap();
    model.set_cell_style(0, 1, 2, &style).unwrap();
    model.set_cell_style(0, 4, 1, &style).unwrap();

    assert_eq!(
        model.get_sheet_markup(0),
        Ok("**Item**|**Cost**\nRent|$600\nElectricity|$200\n**Total**|=SUM(B2:B3)".to_string()),
    )
}
