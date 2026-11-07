//! Node constructor and state behavior.
use lexical_model::*;
use macro_document_model::{nodes::*, *};
#[test]
fn booking_import_and_clone_use_explicit_host_without_serializing_it() -> Result<()> {
    let mut editor = export_builder()
        .extension_state(NodeHost(Some("localhost".into())))
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let key = tx.import_node(serde_json::json!({"type":"booking-link-mention","profileId":"a/b","slug":"30 min","url":""}).as_object().unwrap())?;
    assert_eq!(
        tx.get::<BookingLinkMentionNode>(key).unwrap().url,
        "https://dev.macro.com/app/book/a%2Fb/30%20min"
    );
    tx.get_mut::<BookingLinkMentionNode>(key)?.url.clear();
    // The next write clones through the JS constructor and repairs a falsy URL.
    let p = tx.create(Paragraph {})?;
    tx.append(p, &[key])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.commit()?;
    editor.update(|tx| {
        tx.get_mut::<BookingLinkMentionNode>(key)?.label = Maybe::Value("Book".into());
        Ok(())
    })?;
    let json = editor.state().export_json(key)?;
    assert_eq!(
        json.get("url"),
        Some(&serde_json::Value::String(
            "https://dev.macro.com/app/book/a%2Fb/30%20min".into()
        ))
    );
    assert!(!json.contains_key("host"));
    assert_eq!(
        parse_booking_url("https://macro.com/app/book/a%2Fb/30%20min"),
        Some(("a/b".into(), Some("30 min".into())))
    );
    assert!(is_macro_booking_url("https://macro.com/app/book/%FF"));
    assert_eq!(parse_booking_url("https://macro.com/app/book/%FF"), None);
    assert_eq!(parse_booking_url("https://macro.com/app/book/%ZZ"), None);
    Ok(())
}
