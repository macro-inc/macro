use super::handle::count_occurrences;

#[test]
fn test_count_occurrences() {
    let shas = vec![
        "a1b2c3".to_string(),
        "d4e5f6".to_string(),
        "a1b2c3".to_string(),
        "g7h8i9".to_string(),
        "a1b2c3".to_string(),
        "d4e5f6".to_string(),
    ];

    let mut result = count_occurrences(shas);
    result.sort();
    assert_eq!(
        result,
        vec![
            ("a1b2c3".to_string(), 3),
            ("d4e5f6".to_string(), 2),
            ("g7h8i9".to_string(), 1),
        ]
    );
}
