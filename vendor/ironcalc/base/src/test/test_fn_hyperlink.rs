#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;
use crate::types::Link;
use crate::Model;

fn external(target: &str) -> Link {
    Link::External {
        target: target.to_string(),
        tooltip: None,
    }
}

/// Returns the dynamic link in the cell, if any
fn dynamic_link(model: &Model, row: i32, column: i32) -> Option<Link> {
    model
        .get_links_list(0)
        .unwrap()
        .into_iter()
        .find(|entry| entry.row == row && entry.column == column && entry.dynamic)
        .map(|entry| entry.link)
}

#[test]
fn without_friendly_name_displays_the_location() {
    let mut model = new_empty_model();
    model._set("A1", "=HYPERLINK(\"https://www.ironcalc.com/\")");
    model.evaluate();

    assert_eq!(model._get_text("A1"), "https://www.ironcalc.com/");
    assert_eq!(
        dynamic_link(&model, 1, 1),
        Some(external("https://www.ironcalc.com/"))
    );
    // dynamic links are not editable: they are not part of the worksheet links
    assert_eq!(model.get_cell_link(0, 1, 1), Ok(None));
    assert!(model.get_links(0).unwrap().is_empty());
}

#[test]
fn friendly_name_is_displayed() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=HYPERLINK(\"https://www.ironcalc.com/\", \"IronCalc\")",
    );
    // the friendly name can be a number or come from a reference
    model._set("A2", "=HYPERLINK(\"https://www.ironcalc.com/\", 42)");
    model._set("A3", "=HYPERLINK(\"https://www.ironcalc.com/\", B3)");
    model._set("B3", "Click here");
    model.evaluate();

    assert_eq!(model._get_text("A1"), "IronCalc");
    assert_eq!(model._get_text("A2"), "42");
    assert_eq!(model._get_text("A3"), "Click here");
    for row in 1..=3 {
        assert_eq!(
            dynamic_link(&model, row, 1),
            Some(external("https://www.ironcalc.com/"))
        );
    }
}

#[test]
fn location_can_come_from_a_reference() {
    let mut model = new_empty_model();
    model._set("B1", "https://www.ironcalc.com/");
    model._set("A1", "=HYPERLINK(B1, \"IronCalc\")");
    model.evaluate();

    assert_eq!(model._get_text("A1"), "IronCalc");
    assert_eq!(
        dynamic_link(&model, 1, 1),
        Some(external("https://www.ironcalc.com/"))
    );
}

#[test]
fn a_hash_prefix_is_an_internal_link() {
    let mut model = new_empty_model();
    model._set("A1", "=HYPERLINK(\"#Sheet1!A5\", \"Jump to A5\")");
    model.evaluate();

    assert_eq!(model._get_text("A1"), "Jump to A5");
    assert_eq!(
        dynamic_link(&model, 1, 1),
        Some(Link::Internal {
            location: "Sheet1!A5".to_string(),
            tooltip: None,
        })
    );
}

#[test]
fn dynamic_links_are_rebuilt_on_every_evaluation() {
    let mut model = new_empty_model();
    model
        .set_user_input(
            0,
            1,
            1,
            "=HYPERLINK(\"https://www.ironcalc.com/\")".to_string(),
        )
        .unwrap();
    model.evaluate();
    assert_eq!(
        dynamic_link(&model, 1, 1),
        Some(external("https://www.ironcalc.com/"))
    );

    // replacing the formula removes the dynamic link
    model.set_user_input(0, 1, 1, "Hello".to_string()).unwrap();
    model.evaluate();
    assert_eq!(dynamic_link(&model, 1, 1), None);
}

#[test]
fn dynamic_links_are_in_the_links_list() {
    let mut model = new_empty_model();
    model._set("A1", "=HYPERLINK(\"https://www.ironcalc.com/\")");
    model.evaluate();
    // an explicit worksheet link on another cell
    model
        .set_cell_link(0, 2, 2, external("https://www.example.com"))
        .unwrap();

    let links = model.get_links_list(0).unwrap();
    assert_eq!(links.len(), 2);
    assert_eq!((links[0].row, links[0].column), (1, 1));
    assert!(links[0].dynamic);
    assert_eq!(links[0].link, external("https://www.ironcalc.com/"));
    assert_eq!((links[1].row, links[1].column), (2, 2));
    assert!(!links[1].dynamic);
    // but the raw worksheet links only contain the explicit one
    assert_eq!(model.get_links(0).unwrap().len(), 1);
}

#[test]
fn an_explicit_link_takes_precedence() {
    let mut model = new_empty_model();
    model._set("A1", "=HYPERLINK(\"https://www.ironcalc.com/\")");
    model.evaluate();
    model
        .set_cell_link(0, 1, 1, external("https://www.example.com"))
        .unwrap();

    assert_eq!(
        model.get_cell_link(0, 1, 1),
        Ok(Some(external("https://www.example.com")))
    );
    let links = model.get_links_list(0).unwrap();
    assert_eq!(links.len(), 1);
    assert!(!links[0].dynamic);
}

#[test]
fn errors() {
    let mut model = new_empty_model();
    // wrong number of arguments
    model._set("A1", "=HYPERLINK()");
    model._set("A2", "=HYPERLINK(\"a\", \"b\", \"c\")");
    // an error in the location propagates and creates no link
    model._set("A3", "=HYPERLINK(1/0)");
    // an error in the friendly name propagates and creates no link either:
    // a cell displaying an error is not clickable
    model._set("A4", "=HYPERLINK(\"https://www.ironcalc.com/\", 1/0)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), "#ERROR!");
    assert_eq!(model._get_text("A2"), "#ERROR!");
    assert_eq!(model._get_text("A3"), "#DIV/0!");
    assert_eq!(dynamic_link(&model, 3, 1), None);
    assert_eq!(model._get_text("A4"), "#DIV/0!");
    assert_eq!(dynamic_link(&model, 4, 1), None);
}

#[test]
fn fixing_an_erroring_friendly_name_attaches_the_link() {
    let mut model = new_empty_model();
    model._set("A1", "=HYPERLINK(\"https://www.ironcalc.com/\", B1)");
    model._set("B1", "=1/0");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#DIV/0!");
    assert_eq!(dynamic_link(&model, 1, 1), None);

    // once the friendly name stops erroring the link comes back
    model
        .set_user_input(0, 1, 2, "Click here".to_string())
        .unwrap();
    model.evaluate();
    assert_eq!(model._get_text("A1"), "Click here");
    assert_eq!(
        dynamic_link(&model, 1, 1),
        Some(external("https://www.ironcalc.com/"))
    );
}
