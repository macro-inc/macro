#![allow(clippy::unwrap_used)]
use crate::types::Color;

use crate::test::util::new_empty_model;
use crate::types::Fill;
use crate::UserModel;

#[test]
fn simple_pasting() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    let mut style = model.get_cell_style(0, 1, 1).unwrap();
    style.fill = Fill {
        color: Color::Rgb("#FF5577".to_string()),
    };
    let styles = vec![vec![style.clone()]];

    model.set_selected_cell(5, 4).unwrap();
    model.set_selected_range(5, 4, 10, 9).unwrap();
    model.on_paste_styles(&styles).unwrap();

    for row in 5..10 {
        for column in 4..9 {
            let cell_style = model.get_cell_style(0, row, column).unwrap();
            assert_eq!(cell_style, style);
        }
    }

    model.undo().unwrap();
    let base_style = model.get_cell_style(0, 100, 100).unwrap();

    for row in 5..10 {
        for column in 4..9 {
            let cell_style = model.get_cell_style(0, row, column).unwrap();
            assert_eq!(cell_style, base_style);
        }
    }

    model.redo().unwrap();

    for row in 5..10 {
        for column in 4..9 {
            let cell_style = model.get_cell_style(0, row, column).unwrap();
            assert_eq!(cell_style, style);
        }
    }
}
