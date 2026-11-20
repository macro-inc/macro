use super::is_test_only;

fn test_only(attribute: &str) -> bool {
    let item: syn::ItemMod = syn::parse_str(&format!("{attribute} mod m;")).unwrap();
    is_test_only(&item.attrs)
}

/// A module is left out only when nothing but a test build compiles it.
#[test]
fn a_module_is_test_only_when_its_cfg_needs_test() {
    assert!(test_only("#[cfg(test)]"));
    assert!(test_only(r#"#[cfg(all(test, feature = "x"))]"#));
    assert!(test_only(r#"#[cfg(all(test, not(feature = "x")))]"#));
    assert!(test_only("#[cfg(any(test, all(test, unix)))]"));

    assert!(!test_only(r#"#[cfg(any(test, feature = "x"))]"#));
    assert!(!test_only("#[cfg(not(test))]"));
    assert!(!test_only(r#"#[cfg(feature = "x")]"#));
    assert!(!test_only("#[allow(dead_code)]"));
}
