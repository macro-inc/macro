use super::restore_source_url;

#[test]
fn restored_source_url_stays_inside_its_attribute() {
    let html = r#"<img src="https://static-file-service.example/file/1" alt="logo">"#;

    let restored = restore_source_url(
        html,
        "https://static-file-service.example/file/1",
        r#"https://images.example/a "quoted".png?w=1&h=2"#,
    );

    assert_eq!(
        restored,
        r#"<img src="https://images.example/a &quot;quoted&quot;.png?w=1&amp;h=2" alt="logo">"#
    );
}
