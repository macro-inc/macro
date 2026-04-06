use super::*;
use strum::IntoEnumIterator;

#[test]
fn serde_roundtrip_uses_extension_string() {
    for ft in FileType::iter() {
        let json = serde_json::to_string(&ft).unwrap();
        let expected = format!("\"{}\"", ft.as_str());
        assert_eq!(json, expected, "serialize mismatch for {:?}", ft);

        let deserialized: FileType = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, ft, "deserialize mismatch for {:?}", ft);
    }
}

#[test]
fn deserialize_cplusplus() {
    let ft: FileType = serde_json::from_str("\"c++\"").unwrap();
    assert_eq!(ft, FileType::CPlusPlus);
}

#[test]
fn deserialize_from_bytes() {
    let ft: FileType = serde_json::from_slice(b"\"c++\"").unwrap();
    assert_eq!(ft, FileType::CPlusPlus);

    let ft: FileType = serde_json::from_slice(b"\"rs\"").unwrap();
    assert_eq!(ft, FileType::Rs);
}

#[test]
fn deserialize_cplusplusm() {
    let ft: FileType = serde_json::from_str("\"c++m\"").unwrap();
    assert_eq!(ft, FileType::CPlusPlusm);
}

#[test]
fn deserialize_hplusplus() {
    let ft: FileType = serde_json::from_str("\"h++\"").unwrap();
    assert_eq!(ft, FileType::HPlusPlus);
}

#[test]
fn deserialize_7z() {
    let ft: FileType = serde_json::from_str("\"7z\"").unwrap();
    assert_eq!(ft, FileType::SevenZ);
}

#[cfg(feature = "utoipa")]
#[test]
fn utoipa_schema_uses_extension_strings() {
    use utoipa::OpenApi;

    #[derive(OpenApi)]
    #[openapi(components(schemas(FileType)))]
    struct TestApi;

    let spec = TestApi::openapi();
    let json = serde_json::to_value(&spec).unwrap();
    let file_type_schema = &json["components"]["schemas"]["FileType"];
    let enum_values = file_type_schema["enum"].as_array().unwrap();

    let expected: Vec<String> = FileType::iter().map(|ft| ft.as_str().to_string()).collect();
    let actual: Vec<String> = enum_values
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();

    assert_eq!(actual, expected);
}
