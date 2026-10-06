#![allow(clippy::unwrap_used)]

//! Typing or pasting an URL (or email address) in a cell automatically attaches
//! a link to it, done by `Model::set_user_input` the same way other inputs
//! change the number format of the cell.

use crate::expressions::types::Area;
use crate::test::util::new_empty_model;
use crate::types::{Color, Link};
use crate::UserModel;

fn external(target: &str) -> Link {
    Link::External {
        target: target.to_string(),
        tooltip: None,
    }
}

#[test]
fn typing_an_url_creates_a_link() {
    let mut model = UserModel::from_model(new_empty_model());
    model
        .set_user_input(0, 1, 1, "https://www.ironcalc.com/")
        .unwrap();

    assert_eq!(
        model.get_cell_link(0, 1, 1),
        Ok(Some(external("https://www.ironcalc.com/")))
    );
    // the link style is applied too
    let style = model.get_cell_style(0, 1, 1).unwrap();
    assert!(style.font.u);
    assert_eq!(style.font.color, Color::Theme(10, 0.0));
}

#[test]
fn typing_a_www_url_or_an_email_creates_a_link() {
    let mut model = UserModel::from_model(new_empty_model());

    model.set_user_input(0, 1, 1, "www.example.com").unwrap();
    assert_eq!(
        model.get_cell_link(0, 1, 1),
        Ok(Some(external("https://www.example.com")))
    );

    model.set_user_input(0, 2, 1, "hello@ironcalc.com").unwrap();
    assert_eq!(
        model.get_cell_link(0, 2, 1),
        Ok(Some(external("mailto:hello@ironcalc.com")))
    );
}

#[test]
fn ordinary_inputs_do_not_create_links() {
    let mut model = UserModel::from_model(new_empty_model());
    model.set_user_input(0, 1, 1, "Hello world").unwrap();
    model.set_user_input(0, 2, 1, "42").unwrap();
    model.set_user_input(0, 3, 1, "=1+1").unwrap();
    // a quote prefix prevents the auto-linking
    model
        .set_user_input(0, 4, 1, "'https://www.ironcalc.com/")
        .unwrap();

    assert!(model.get_links(0).unwrap().is_empty());
}

#[test]
fn typing_text_in_a_linked_cell_keeps_the_link() {
    let mut model = UserModel::from_model(new_empty_model());
    model
        .set_cell_link(0, 1, 1, external("https://www.ironcalc.com/"), None)
        .unwrap();

    model.set_user_input(0, 1, 1, "IronCalc").unwrap();
    assert_eq!(
        model.get_cell_link(0, 1, 1),
        Ok(Some(external("https://www.ironcalc.com/")))
    );
}

#[test]
fn typing_an_url_in_a_linked_cell_updates_the_target() {
    let mut model = UserModel::from_model(new_empty_model());
    model
        .set_cell_link(0, 1, 1, external("https://www.ironcalc.com/"), None)
        .unwrap();
    // the user customizes the style
    model
        .update_range_style(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 1,
            },
            "font.color",
            "#FF0000",
        )
        .unwrap();

    model.set_user_input(0, 1, 1, "www.example.com").unwrap();
    assert_eq!(
        model.get_cell_link(0, 1, 1),
        Ok(Some(external("https://www.example.com")))
    );
    // an existing link keeps the cell style
    let style = model.get_cell_style(0, 1, 1).unwrap();
    assert_eq!(style.font.color, Color::Rgb("#FF0000".to_string()));
}

#[test]
fn pasting_urls_creates_links() {
    let mut model = UserModel::from_model(new_empty_model());
    model
        .paste_csv_string(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 1,
            },
            "https://www.ironcalc.com/\tHello\nhello@ironcalc.com\t42",
        )
        .unwrap();

    assert_eq!(
        model.get_cell_link(0, 1, 1),
        Ok(Some(external("https://www.ironcalc.com/")))
    );
    assert_eq!(
        model.get_cell_link(0, 2, 1),
        Ok(Some(external("mailto:hello@ironcalc.com")))
    );
    // the other cells are not linked
    assert_eq!(model.get_links(0).unwrap().len(), 2);
}

#[test]
fn undo_removes_the_auto_created_link_and_style() {
    let mut model = UserModel::from_model(new_empty_model());
    model
        .set_user_input(0, 1, 1, "https://www.ironcalc.com/")
        .unwrap();

    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 1), Ok("".to_string()));
    assert_eq!(model.get_cell_link(0, 1, 1), Ok(None));
    let style = model.get_cell_style(0, 1, 1).unwrap();
    assert!(!style.font.u);
    assert_eq!(style.font.color, Color::None);

    // redo brings the link and the style back
    model.redo().unwrap();
    assert_eq!(
        model.get_cell_link(0, 1, 1),
        Ok(Some(external("https://www.ironcalc.com/")))
    );
    let style = model.get_cell_style(0, 1, 1).unwrap();
    assert!(style.font.u);
    assert_eq!(style.font.color, Color::Theme(10, 0.0));
}

#[test]
fn undo_of_an_url_typed_over_content_restores_everything() {
    let mut model = UserModel::from_model(new_empty_model());
    model.set_user_input(0, 1, 1, "hello").unwrap();

    model.set_user_input(0, 1, 1, "www.example.com").unwrap();
    model.undo().unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 1, 1),
        Ok("hello".to_string())
    );
    assert_eq!(model.get_cell_link(0, 1, 1), Ok(None));
    let style = model.get_cell_style(0, 1, 1).unwrap();
    assert!(!style.font.u);
    assert_eq!(style.font.color, Color::None);
}

#[test]
fn undo_of_an_url_typed_over_a_linked_cell_restores_the_target() {
    let mut model = UserModel::from_model(new_empty_model());
    model
        .set_cell_link(0, 1, 1, external("https://www.ironcalc.com/"), None)
        .unwrap();

    // typing an URL over a linked cell replaces the target...
    model.set_user_input(0, 1, 1, "www.example.com").unwrap();
    assert_eq!(
        model.get_cell_link(0, 1, 1),
        Ok(Some(external("https://www.example.com")))
    );
    // ...and undo restores the previous one
    model.undo().unwrap();
    assert_eq!(
        model.get_cell_link(0, 1, 1),
        Ok(Some(external("https://www.ironcalc.com/")))
    );
}

#[test]
fn undo_of_pasted_urls_removes_the_links() {
    let mut model = UserModel::from_model(new_empty_model());
    model
        .paste_csv_string(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 1,
            },
            "https://www.ironcalc.com/\tHello",
        )
        .unwrap();
    assert_eq!(model.get_links(0).unwrap().len(), 1);

    model.undo().unwrap();
    assert!(model.get_links(0).unwrap().is_empty());
    let style = model.get_cell_style(0, 1, 1).unwrap();
    assert!(!style.font.u);
}

#[test]
fn undo_of_a_paste_over_a_linked_cell_restores_the_link() {
    let mut model = UserModel::from_model(new_empty_model());
    model
        .set_cell_link(
            0,
            1,
            1,
            external("https://www.ironcalc.com/"),
            Some("IronCalc"),
        )
        .unwrap();

    // pasting plain text over the linked cell removes the link
    model
        .paste_csv_string(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 1,
            },
            "Hello",
        )
        .unwrap();
    assert_eq!(model.get_cell_link(0, 1, 1), Ok(None));

    model.undo().unwrap();
    assert_eq!(
        model.get_cell_link(0, 1, 1),
        Ok(Some(external("https://www.ironcalc.com/")))
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 1),
        Ok("IronCalc".to_string())
    );
}

#[test]
fn undo_of_an_auto_link_is_sent_to_peers() {
    let mut model = UserModel::from_model(new_empty_model());
    let mut peer = UserModel::from_model(new_empty_model());

    model
        .set_user_input(0, 1, 1, "https://www.ironcalc.com/")
        .unwrap();
    peer.apply_external_diffs(&model.flush_send_queue())
        .unwrap();
    assert_eq!(
        peer.get_cell_link(0, 1, 1),
        Ok(Some(external("https://www.ironcalc.com/")))
    );

    model.undo().unwrap();
    peer.apply_external_diffs(&model.flush_send_queue())
        .unwrap();
    assert_eq!(peer.get_cell_link(0, 1, 1), Ok(None));
    let style = peer.get_cell_style(0, 1, 1).unwrap();
    assert!(!style.font.u);
}

#[test]
fn auto_links_are_sent_to_other_models() {
    let mut model = UserModel::from_model(new_empty_model());
    model
        .set_user_input(0, 1, 1, "https://www.ironcalc.com/")
        .unwrap();

    let send_queue = model.flush_send_queue();
    let mut model2 = UserModel::from_model(new_empty_model());
    model2.apply_external_diffs(&send_queue).unwrap();

    assert_eq!(
        model2.get_cell_link(0, 1, 1),
        Ok(Some(external("https://www.ironcalc.com/")))
    );
}
