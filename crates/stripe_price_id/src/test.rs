use super::*;

#[test]
fn accepts_only_the_required_price_prefix() {
    for value in [
        "price_123",
        "price_agent_seat",
        "price_",
        "price_with-hyphens",
        "price_é",
    ] {
        let price = StripePriceId::parse(value).unwrap();
        assert_eq!(price.as_str(), value);
        assert_eq!(price.to_string(), value);
        assert_eq!(price.into_inner(), value);
    }
    for value in ["", "price", "prod_123", "Price_123", " price_123"] {
        assert_eq!(
            StripePriceId::parse(value),
            Err(StripePriceIdParseError::InvalidPrefix)
        );
    }
}

#[cfg(feature = "serde")]
#[test]
fn serde_validates_input_and_preserves_the_string_wire_format() {
    let json = r#""price_agent_seat""#;
    let price: StripePriceId = serde_json::from_str(json).unwrap();
    assert_eq!(price.as_str(), "price_agent_seat");
    assert_eq!(serde_json::to_string(&price).unwrap(), json);
    assert!(serde_json::from_str::<StripePriceId>(r#""""#).is_err());
    assert!(serde_json::from_str::<StripePriceId>(r#""prod_123""#).is_err());
}

#[cfg(feature = "schema")]
#[test]
fn schema_is_a_plain_string() {
    assert_eq!(
        serde_json::to_value(<StripePriceId as utoipa::PartialSchema>::schema()).unwrap()["type"],
        "string"
    );
}
