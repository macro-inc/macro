use super::*;
use std::cell::Cell;

#[test]
fn overwritten_object_values_still_count_copied_payloads() {
    let bytes = Cell::new(0);
    let input = r#"{"first":"é😀","nested":[true,7,null],"first":"last"}"#;
    let result = value(&mut serde_json::Deserializer::from_str(input), &|n| {
        bytes.set(bytes.get() + n);
    })
    .expect("JSON input");
    assert_eq!(
        result,
        serde_json::json!({"first":"last","nested":[true,7,null]})
    );
    assert_eq!(bytes.get(), 55);
}

#[test]
fn failed_nested_value_retains_the_copied_prefix_and_the_original_error() {
    let bytes = Cell::new(0);
    let input = r#"["é😀", {"ok":7,"bad":]"#;
    let original = serde_json::from_str::<serde_json::Value>(input).expect_err("invalid input");
    let error = value(&mut serde_json::Deserializer::from_str(input), &|n| {
        bytes.set(bytes.get() + n);
    })
    .expect_err("invalid input");
    assert_eq!(error.to_string(), original.to_string());
    assert_eq!(bytes.get(), 24);
}

#[test]
fn invalid_typed_map_key_preserves_deserializer_request_and_error() {
    let original = serde_json::Value::deserialize(serde::de::value::MapDeserializer::<
        _,
        serde::de::value::Error,
    >::new([(true, 1)].into_iter()))
    .expect_err("boolean key");
    let bytes = Cell::new(0);
    let error = value(
        serde::de::value::MapDeserializer::<_, serde::de::value::Error>::new(
            [(true, 1)].into_iter(),
        ),
        &|n| bytes.set(bytes.get() + n),
    )
    .expect_err("boolean key");
    assert_eq!(error.to_string(), original.to_string());
    assert_eq!(bytes.get(), 1);
}

#[test]
fn nonfinite_input_counts_a_number_even_when_json_normalizes_it_to_null() {
    let bytes = Cell::new(0);
    let result = value(
        serde::de::value::F64Deserializer::<serde::de::value::Error>::new(f64::NAN),
        &|n| bytes.set(bytes.get() + n),
    )
    .expect("JSON null");
    assert_eq!(result, serde_json::Value::Null);
    assert_eq!(bytes.get(), 8);
}
