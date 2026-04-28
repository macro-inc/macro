use super::*;

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
}
