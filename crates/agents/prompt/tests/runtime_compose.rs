#[test]
fn runtime_sections_preserve_order_without_static_lifetimes() {
    let private = String::from("Private preferences");
    let team = String::from("Shared context");
    assert_eq!(
        prompt::compose(&[&private, &team]),
        "Private preferences\nShared context"
    );
    assert_eq!(prompt::compose(&[]), "");
}
