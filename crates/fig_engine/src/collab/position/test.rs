use super::*;

#[test]
fn spread_keys_sort_in_order() {
    let keys = spread(500);
    assert!(keys.windows(2).all(|w| w[0] < w[1]));
    assert!(keys.iter().all(|k| !k.ends_with('0')));
}

#[test]
fn between_fits_anywhere() {
    let keys = spread(3);
    let m = between(Some(&keys[0]), Some(&keys[1]));
    assert!(
        keys[0] < m && m < keys[1],
        "{} < {m} < {}",
        keys[0],
        keys[1]
    );
    let top = between(Some(&keys[2]), None);
    assert!(top > keys[2]);
    let bottom = between(None, Some(&keys[0]));
    assert!(bottom < keys[0]);
}

#[test]
fn repeated_inserts_stay_ordered() {
    // Always inserting just above the same key, and just below another.
    let mut lo = "a".to_string();
    let hi = "b".to_string();
    for _ in 0..200 {
        let m = between(Some(&lo), Some(&hi));
        assert!(lo < m && m < hi, "{lo} < {m} < {hi}");
        assert!(!m.ends_with('0'));
        lo = m;
    }
    let mut hi = "b".to_string();
    let lo = "a".to_string();
    for _ in 0..200 {
        let m = between(Some(&lo), Some(&hi));
        assert!(lo < m && m < hi, "{lo} < {m} < {hi}");
        hi = m;
    }
}

#[test]
fn colliding_keys_go_above() {
    let k = between(Some("V"), Some("V"));
    assert!(k.as_str() > "V");
    let k = between(Some("W"), Some("V"));
    assert!(k.as_str() > "W");
}
