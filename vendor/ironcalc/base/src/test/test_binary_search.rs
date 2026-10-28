use crate::functions::binary_search::*;

#[test]
fn test_binary_search() {
    let t = vec![1, 2, 3, 40, 55, 155];
    assert_eq!(binary_search_or_smaller(&40, &t), Some(3));
    assert_eq!(binary_search_or_greater(&40, &t), Some(3));
    assert_eq!(binary_search_or_smaller(&45, &t), Some(3));
    assert_eq!(binary_search_or_greater(&45, &t), Some(4));
}

#[test]
fn test_binary_search_descending() {
    let t = vec![100, 33, 23, 14, 5, -155];
    assert_eq!(binary_search_descending_or_smaller(&23, &t), Some(2));
    assert_eq!(binary_search_descending_or_greater(&23, &t), Some(2));
    assert_eq!(binary_search_descending_or_smaller(&25, &t), Some(2));
    assert_eq!(binary_search_descending_or_greater(&25, &t), Some(1));
}

#[test]
fn test_binary_search_multiple() {
    let t = vec![1, 2, 3, 40, 40, 40, 40, 55, 155];
    assert_eq!(binary_search_or_smaller(&40, &t), Some(3));
    assert_eq!(binary_search_or_smaller(&39, &t), Some(2));
    assert_eq!(binary_search_or_greater(&40, &t), Some(3));
    assert_eq!(binary_search_or_greater(&41, &t), Some(7));
}
