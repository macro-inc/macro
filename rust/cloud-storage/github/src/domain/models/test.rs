use super::*;

// ---------------------------------------------------------------------------
// MacroTaskId::from_short_uuid
// ---------------------------------------------------------------------------

#[test]
fn from_short_uuid_valid() {
    let task_id = MacroTaskId::from_short_uuid("2BuyvtY3ae").unwrap();
    assert_eq!(task_id.short_uuid, "2BuyvtY3ae");
}

#[test]
fn from_short_uuid_rejects_empty() {
    assert!(MacroTaskId::from_short_uuid("").is_none());
}

#[test]
fn from_short_uuid_rejects_invalid_chars() {
    // 'O', 'I', 'l', '0' are not in Flickr base58
    assert!(MacroTaskId::from_short_uuid("OOOOO").is_none());
    assert!(MacroTaskId::from_short_uuid("IIIlll").is_none());
    assert!(MacroTaskId::from_short_uuid("000abc").is_none());
}

#[test]
fn from_short_uuid_rejects_too_long() {
    let long = "a".repeat(25);
    assert!(MacroTaskId::from_short_uuid(&long).is_none());
}

// ---------------------------------------------------------------------------
// MacroTaskId::from_uuid / to_uuid roundtrip
// ---------------------------------------------------------------------------

#[test]
fn roundtrip_uuid_conversion() {
    let uuid = uuid::Uuid::parse_str("0d0dc589-f301-43f1-8b11-4ab448ca4bb4").unwrap();
    let task_id = MacroTaskId::from_uuid(&uuid);
    assert_eq!(task_id.short_uuid, "2BuyvtY3aeEvHx4uG8iD51");

    let recovered = task_id.to_uuid().unwrap();
    assert_eq!(uuid, recovered);
}

#[test]
fn to_task_id_string() {
    let task_id = MacroTaskId::from_short_uuid("2BuyvtY3ae").unwrap();
    assert_eq!(task_id.to_task_id_string(), "MACRO-2BuyvtY3ae");
}

#[test]
fn display_impl() {
    let task_id = MacroTaskId::from_short_uuid("abc123").unwrap();
    assert_eq!(format!("{task_id}"), "MACRO-abc123");
}

// ---------------------------------------------------------------------------
// MacroTaskId::extract_from_text
// ---------------------------------------------------------------------------

#[test]
fn extract_case_insensitive() {
    let text = "fixes MACRO-2BuyvtY3ae and also macro-abc123 and Macro-XYZ";
    let ids = MacroTaskId::extract_from_text(text);
    assert_eq!(ids.len(), 3);
    assert_eq!(ids[0].short_uuid, "2BuyvtY3ae");
    assert_eq!(ids[1].short_uuid, "abc123");
    // "XYZ" is valid base58
    assert_eq!(ids[2].short_uuid, "XYZ");
}

#[test]
fn extract_deduplicates() {
    let text = "MACRO-abc123 and macro-abc123 again MACRO-abc123";
    let ids = MacroTaskId::extract_from_text(text);
    // Same short UUID captured, only first occurrence kept
    assert_eq!(ids.len(), 1);
    assert_eq!(ids[0].short_uuid, "abc123");
}

#[test]
fn extract_no_match() {
    let text = "no task ids here, just MACR-123 or MACRO- or MACRO";
    let ids = MacroTaskId::extract_from_text(text);
    assert!(ids.is_empty());
}

#[test]
fn extract_ignores_invalid_base58_chars() {
    // '0', 'O', 'I', 'l' are not in Flickr base58
    // "MACRO-000abc" -> regex captures "000abc" but from_short_uuid rejects it
    let text = "MACRO-000abc";
    let ids = MacroTaskId::extract_from_text(text);
    assert!(ids.is_empty());
}

#[test]
fn extract_from_branch_name() {
    let text = "feature/macro-2BuyvtY3ae";
    let ids = MacroTaskId::extract_from_text(text);
    assert_eq!(ids.len(), 1);
    assert_eq!(ids[0].short_uuid, "2BuyvtY3ae");
}

#[test]
fn extract_multiple_in_sentence() {
    let text = "closes MACRO-aaa111 and MACRO-bbb222";
    let ids = MacroTaskId::extract_from_text(text);
    assert_eq!(ids.len(), 2);
    assert_eq!(ids[0].short_uuid, "aaa111");
    assert_eq!(ids[1].short_uuid, "bbb222");
}
