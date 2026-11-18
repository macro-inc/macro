use super::*;
use lexical_model::*;

#[test]
fn unknown_names_do_not_parse_foreign_payloads() -> Result<(), Error> {
    for name in [
        "group-a.format-text",
        "group-b.format",
        "group-b.format-text.extra",
    ] {
        assert!(decode(name, "not JSON")?.is_none());
    }
    Ok(())
}

#[test]
fn known_names_require_canonical_enum_strings() -> Result<(), Error> {
    for json in [
        "null",
        "0",
        "true",
        "[]",
        "{}",
        r#"{"format":"bold"}"#,
        r#""Bold""#,
        r#""unknown""#,
        r#""bold" false"#,
    ] {
        assert!(decode("group-b.format-text", json).is_err(), "{json}");
    }
    for json in [
        "null",
        "1",
        "false",
        "[]",
        "{}",
        r#"{"format":"center"}"#,
        r#""Center""#,
        r#""unset""#,
        r#""raw""#,
    ] {
        assert!(decode("group-b.format-element", json).is_err(), "{json}");
    }
    assert!(matches!(
        decode("group-b.format-element", r#""""#)?,
        Some(Command::FormatElement(ElementFormat::Unset))
    ));
    Ok(())
}
