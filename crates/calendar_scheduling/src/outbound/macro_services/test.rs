use super::*;

const URL: &str = "https://macro.com/app/meet/join/0123456789abcdef0123456789abcdef";

#[test]
fn an_idempotent_replay_keeps_the_link_already_on_the_event() {
    let description = format!(r#"<p>Join Macro call: <a href="{URL}">{URL}</a></p>"#);
    assert!(carries_url(None, Some(&description), URL));
    assert_eq!(
        first_macro_call_url(Some("Office"), Some(&description)).as_deref(),
        Some(URL)
    );
    assert!(!carries_url(Some("Office"), Some("notes"), URL));
}
