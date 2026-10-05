use super::*;

fn key(text: &str) -> Position {
    text.parse().unwrap()
}

fn keys(texts: &[&str]) -> Vec<Position> {
    texts.iter().map(|text| key(text)).collect()
}

#[test]
fn an_empty_list_starts_in_the_middle_of_the_key_space() {
    assert_eq!(key_between(None, None), Ok(key("80")));
}

#[test]
fn appending_and_prepending_step_one_byte_at_a_time() {
    assert_eq!(key_between(Some(&key("80")), None), Ok(key("8180")));
    assert_eq!(key_between(Some(&key("8180")), None), Ok(key("8280")));
    assert_eq!(key_between(Some(&key("ff80")), None), Ok(key("ff8180")));
    assert_eq!(key_between(None, Some(&key("80"))), Ok(key("7f80")));
}

#[test]
fn a_key_between_neighbours_sorts_strictly_between_them() {
    assert_eq!(
        key_between(Some(&key("80")), Some(&key("8180"))),
        Ok(key("817f80"))
    );
    assert_eq!(
        key_between(Some(&key("8180")), Some(&key("8280"))),
        Ok(key("818180"))
    );

    let mut lower = key("80");
    let upper = key("8180");
    for _ in 0..500 {
        let between = key_between(Some(&lower), Some(&upper)).unwrap();
        assert!(
            lower < between && between < upper,
            "{lower} < {between} < {upper}"
        );
        lower = between;
    }
}

#[test]
fn bounds_that_are_not_in_order_are_refused() {
    assert_eq!(
        key_between(Some(&key("8180")), Some(&key("8180"))),
        Err(PositionError::OutOfOrder {
            before: "8180".into(),
            after: "8180".into(),
        })
    );
    assert_eq!(
        key_between(Some(&key("8280")), Some(&key("8180"))),
        Err(PositionError::OutOfOrder {
            before: "8280".into(),
            after: "8180".into(),
        })
    );
}

#[test]
fn a_string_that_is_not_a_key_is_refused() {
    for written in ["", "zz", "81", "000000000001", "808", "8A80"] {
        assert_eq!(
            written.parse::<Position>(),
            Err(PositionError::NotAKey(written.into())),
            "{written:?}"
        );
        assert_eq!(
            Position::try_from(written.to_string()),
            Err(PositionError::NotAKey(written.into())),
            "{written:?}"
        );
    }
}

#[test]
fn many_keys_at_once_bisect_their_range() {
    assert_eq!(
        keys_between(None, None, 5),
        Ok(keys(&["7e80", "7f80", "80", "817f80", "8180"]))
    );
    assert_eq!(
        keys_between(Some(&key("8180")), Some(&key("8280")), 3),
        Ok(keys(&["81817f80", "818180", "818280"]))
    );
    assert_eq!(keys_between(Some(&key("80")), None, 0), Ok(vec![]));

    let minted = keys_between(None, None, 100_000).unwrap();
    let mut sorted = minted.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted, minted);
    assert!(minted.iter().all(|key| key.as_str().len() <= 34));
}

#[test]
fn positions_order_as_their_stored_bytes() {
    let mut minted = keys_between(None, None, 1_000).unwrap();
    minted.push(key_between(None, Some(&minted[0])).unwrap());
    minted.push(key_between(Some(&minted[999]), None).unwrap());
    minted.push(key_between(Some(&minted[10]), Some(&minted[11])).unwrap());
    assert!(
        minted
            .iter()
            .map(|key| key.as_str().len())
            .collect::<std::collections::HashSet<_>>()
            .len()
            > 1,
        "the keys should differ in length"
    );
    for left in &minted {
        for right in &minted {
            assert_eq!(
                left.cmp(right),
                left.as_str().as_bytes().cmp(right.as_str().as_bytes()),
                "{left} against {right}"
            );
        }
    }
}

#[test]
fn a_position_is_its_key_string_on_the_wire() {
    let position = key("817f80");
    assert_eq!(
        serde_json::to_value(&position).unwrap(),
        serde_json::json!("817f80")
    );
    assert_eq!(
        serde_json::from_value::<Position>(serde_json::json!("817f80")).unwrap(),
        position
    );
    assert!(serde_json::from_value::<Position>(serde_json::json!("81")).is_err());
}
