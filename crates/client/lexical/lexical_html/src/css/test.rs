use super::*;

#[test]
fn absent_theme_classes_do_not_create_a_class_attribute() {
    let mut element = HtmlElement::new("span");
    add_class_names(&mut element, &[None, Some(" \t\n")]);
    assert_eq!(element.get_attribute("class"), None);
    element.set_attribute("class", "");
    add_class_names(&mut element, &[None, Some("")]);
    assert_eq!(element.get_attribute("class").as_deref(), Some(""));
    add_class_names(&mut element, &[Some("one two one")]);
    assert_eq!(element.get_attribute("class").as_deref(), Some("one two"));
}
