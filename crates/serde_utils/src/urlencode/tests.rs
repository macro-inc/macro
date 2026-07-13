use super::*;
use url::Url;

#[test]
fn it_should_deserialize_double_encoded_url() {
    static TWOX_ENCODED: &str = "a=https%253A%252F%252Fexample.com";

    #[derive(Deserialize)]
    struct Temp {
        a: UrlEncoded<Url>,
    }

    let t: Temp = serde_urlencoded::from_str(TWOX_ENCODED).unwrap();
    let inner = t.a.0;
    assert_eq!(inner, "https://example.com".parse().unwrap())
}

#[test]
fn it_should_deserialize_single_encoded_url() {
    static TWOX_ENCODED: &str = "a=https%3A%2F%2Fexample.com";

    #[derive(Deserialize)]
    struct Temp {
        a: UrlEncoded<Url>,
    }

    let t: Temp = serde_urlencoded::from_str(TWOX_ENCODED).unwrap();
    let inner = t.a.0;
    assert_eq!(inner, "https://example.com".parse().unwrap())
}
