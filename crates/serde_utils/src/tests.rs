use cool_asserts::assert_matches;
use url::Url;

use super::*;

#[derive(Debug, Serialize, Deserialize)]
struct Bar {
    hello: String,
    world: usize,
    url: Url,
}

#[derive(Debug, Serialize, Deserialize)]
struct Foo {
    a: JsonEncoded<Bar>,
    b: usize,
}

static TEST_STR: &str = "a=%7B%22hello%22%3A%22test%22%2C%22world%22%3A42%2C%22url%22%3A%22https%3A%2F%2Fexample.com%2F%22%7D&b=24";

#[test]
fn it_should_deserialize() {
    let a: Foo = serde_urlencoded::from_str(TEST_STR).unwrap();
    assert_eq!(a.b, 24);
    let bar = a.a.decode().unwrap();

    assert_matches!(bar, Bar { hello, world: 42, url} => {
        assert_eq!(hello, "test");
        assert_eq!(url, "https://example.com".parse().unwrap())
    })
}

#[test]
fn it_should_serialize() {
    let encoded = JsonEncoded::new(&Bar {
        hello: "test".to_string(),
        world: 42,
        url: "https://example.com".parse().unwrap(),
    })
    .unwrap();

    let a = serde_urlencoded::to_string(Foo { a: encoded, b: 24 }).unwrap();
    assert_eq!(a, TEST_STR)
}
