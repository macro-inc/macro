use super::*;

#[test]
fn accepts_safe_price_identifiers() {
    for value in [
        "price_123",
        "price_AZaz09",
        "price_computer_large",
        "price__",
        "price_a234567890123456789012345678901234567890123456789012345678901234",
    ] {
        let price = StripePriceId::parse(value).unwrap();
        assert_eq!(price.as_str(), value);
        assert_eq!(price.to_string(), value);
        assert_eq!(price.into_inner(), value);
    }
}

#[test]
fn rejects_invalid_price_identifiers() {
    for value in [
        "",
        "price",
        "prod_123",
        "Price_123",
        " price_123",
        "price_",
        "price_with-hyphens",
        "price_é",
        "price_abc def",
        "price_abc\n",
        "price_abc\r",
        "price_abc\t",
        "price_abc\0",
        "price_abc/def",
        "price_a2345678901234567890123456789012345678901234567890123456789012345",
    ] {
        assert_eq!(
            StripePriceId::parse(value),
            Err(StripePriceIdParseError::InvalidPrefix),
            "{value:?}"
        );
    }
}

#[cfg(feature = "serde")]
#[test]
fn serde_validates_input_and_preserves_the_string_wire_format() {
    let json = r#""price_computer_large""#;
    let price: StripePriceId = serde_json::from_str(json).unwrap();
    assert_eq!(price.as_str(), "price_computer_large");
    assert_eq!(serde_json::to_string(&price).unwrap(), json);
    for json in [
        r#""""#,
        r#""prod_123""#,
        r#""price_""#,
        r#""price_abc def""#,
        r#""price_abc\n""#,
        r#""price_abc\r""#,
        r#""price_abc\t""#,
        r#""price_abc\u0000""#,
        r#""price_abc/def""#,
        r#""price_é""#,
        r#""price_with-hyphens""#,
        r#""price_a2345678901234567890123456789012345678901234567890123456789012345""#,
    ] {
        assert!(
            serde_json::from_str::<StripePriceId>(json).is_err(),
            "{json}"
        );
    }
}

#[cfg(feature = "schema")]
#[test]
fn schema_is_a_plain_string() {
    assert_eq!(
        serde_json::to_value(<StripePriceId as utoipa::PartialSchema>::schema()).unwrap()["type"],
        "string"
    );
}
