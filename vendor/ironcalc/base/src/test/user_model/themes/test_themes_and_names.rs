#![allow(clippy::unwrap_used)]
use crate::themes::builtin_themes;

use crate::test::user_model::util::new_empty_user_model;

#[test]
fn test_named_styles_and_themes() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "Hello").unwrap();
    model.on_apply_named_style("20% - Accent3").unwrap();
    let color = model.get_cell_style(0, 1, 1).unwrap().fill.color;
    let resolved_color = model.resolve_color(&color);
    assert_eq!(resolved_color, "#EDEDED");

    // switching to a theme should update the color to the theme's accent3 with tint 80%
    let themes = builtin_themes();
    let theme = themes
        .iter()
        .find(|theme| theme.name == "IronCalc")
        .unwrap();
    model.set_theme(theme.clone());

    let color_after_theme = model.get_cell_style(0, 1, 1).unwrap().fill.color;
    let resolved_color_after_theme = model.resolve_color(&color_after_theme);
    assert_eq!(resolved_color_after_theme, "#FCE9D9");
}
