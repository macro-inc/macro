use super::*;
use std::collections::HashMap;

#[test]
fn test_vec_non_empty() {
    let vec = vec![1, 2, 3];
    let result = NonEmpty::new(vec);
    assert!(result.is_ok());
    let non_empty = result.unwrap();
    assert_eq!(non_empty.len(), 3);
}

#[test]
fn test_vec_empty() {
    let vec: Vec<i32> = vec![];
    let result = NonEmpty::new(vec);
    assert!(result.is_err());
}

#[test]
fn test_hashmap_non_empty() {
    let mut map = HashMap::new();
    map.insert("key", "value");
    let result = NonEmpty::new(map);
    assert!(result.is_ok());
}

#[test]
fn test_hashmap_empty() {
    let map: HashMap<String, String> = HashMap::new();
    let result = NonEmpty::new(map);
    assert!(result.is_err());
}

#[test]
fn test_string_non_empty() {
    let s = String::from("hello");
    let result = NonEmpty::new(s);
    assert!(result.is_ok());
}

#[test]
fn test_string_empty() {
    let s = String::new();
    let result = NonEmpty::new(s);
    assert!(result.is_err());
}

#[test]
fn test_deref() {
    let vec = vec![1, 2, 3];
    let non_empty = NonEmpty::new(vec).unwrap();
    // Can call Vec methods directly
    assert_eq!(non_empty.len(), 3);
    assert_eq!(non_empty[0], 1);
}

#[test]
fn test_into_inner() {
    let vec = vec![1, 2, 3];
    let non_empty = NonEmpty::new(vec).unwrap();
    let inner = non_empty.into_inner();
    assert_eq!(inner, vec![1, 2, 3]);
}
