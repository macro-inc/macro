use super::*;
use std::collections::HashSet;

fn test_user_ids() -> Vec<MacroUserIdStr<'static>> {
    (0..12)
        .map(|i| MacroUserIdStr::try_from(format!("macro|user{i}@test.com")).unwrap())
        .collect()
}

#[test]
fn test_group_generate() {
    let users = test_user_ids();
    let n = users.len();
    let connections = Group::new(&users).generate();

    assert_eq!(connections.len(), n * (n - 1) / 2);

    // no self-links
    assert!(connections.iter().all(|(a, b)| a != b));

    // all pairs are unique
    let unique: HashSet<_> = connections.iter().collect();
    assert_eq!(unique.len(), connections.len());

    // spot-check a few expected pairs (generate normalises order: a.as_ref() <= b.as_ref())
    let pair = |a: &str, b: &str| -> (MacroUserIdStr<'static>, MacroUserIdStr<'static>) {
        let a = MacroUserIdStr::try_from(a.to_owned()).unwrap();
        let b = MacroUserIdStr::try_from(b.to_owned()).unwrap();
        if a.as_ref() <= b.as_ref() {
            (a, b)
        } else {
            (b, a)
        }
    };
    assert!(connections.contains(&pair("macro|user0@test.com", "macro|user1@test.com")));
    assert!(connections.contains(&pair("macro|user0@test.com", "macro|user2@test.com")));
    assert!(connections.contains(&pair("macro|user10@test.com", "macro|user11@test.com")));
}

#[test]
fn test_group_deduplicates() {
    let id = MacroUserIdStr::try_from("macro|dup@test.com".to_owned()).unwrap();
    let connections = Group::new(&[id.clone(), id]).generate();
    assert!(
        connections.is_empty(),
        "duplicate user should not produce self-edges"
    );
}
