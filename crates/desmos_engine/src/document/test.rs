use super::*;

#[test]
fn empty_source_is_a_blank_graph() {
    let doc = GraphDocument::from_json("").unwrap();
    assert_eq!(doc.version, 1);
    assert_eq!(doc.expressions.len(), 1);
}

#[test]
fn assignment_grows_a_slider() {
    let mut doc = GraphDocument::default();
    doc.set_latex("1", "a=2".into()).unwrap();
    assert!(doc.expressions[0].slider.is_some());
    doc.set_slider("1", 4.5).unwrap();
    assert_eq!(doc.expressions[0].latex, "a=4.5");
}

#[test]
fn needed_sliders_for_line() {
    let mut doc = GraphDocument::default();
    doc.set_latex("1", "y=mx+b".into()).unwrap();
    assert_eq!(doc.needed_sliders(), vec!["b", "m"]);
}

#[test]
fn function_name_is_not_a_needed_slider() {
    let mut doc = GraphDocument::default();
    let second = doc.add_expression();
    doc.set_latex("1", "f(x)=x^2".into()).unwrap();
    doc.set_latex(&second, "y=f(x)".into()).unwrap();
    assert!(doc.needed_sliders().is_empty());
}
