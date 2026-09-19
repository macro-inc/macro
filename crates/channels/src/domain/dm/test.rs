use super::*;

fn user(local: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{local}@test.com")).unwrap()
}

#[test]
fn self_pair_is_rejected() {
    let user = user("same");

    assert_eq!(DmPair::new(user.clone(), user), Err(SelfDm));
}

#[test]
fn pair_identity_is_independent_of_argument_order() {
    let a = user("a");
    let b = user("b");

    assert_eq!(
        DmPair::new(a.clone(), b.clone()).unwrap(),
        DmPair::new(b, a).unwrap()
    );
}

#[test]
fn joining_member_batch_is_a_deduplicated_star() {
    let joiner = user("joiner");
    let a = user("a");
    let b = user("b");

    let command = ensure_dms_for_joining_member(
        joiner.clone(),
        vec![
            joiner.clone(),
            a.clone(),
            b.clone(),
            a.clone(),
            joiner.clone(),
        ],
    );
    let pairs = command
        .requests
        .iter()
        .map(|request| request.pair.clone())
        .collect::<HashSet<_>>();

    assert_eq!(command.requests.len(), 2);
    assert_eq!(
        pairs,
        HashSet::from([
            DmPair::new(joiner.clone(), a).unwrap(),
            DmPair::new(joiner, b).unwrap(),
        ])
    );
}

#[test]
fn roster_batch_is_a_complete_clique() {
    let roster = vec![user("a"), user("b"), user("c"), user("d")];

    let command = ensure_dms_for_roster(roster.clone());
    let pairs = command
        .requests
        .iter()
        .map(|request| request.pair.clone())
        .collect::<HashSet<_>>();

    assert_eq!(
        command.requests.len(),
        roster.len() * (roster.len() - 1) / 2
    );
    assert_eq!(pairs.len(), command.requests.len());
}

#[test]
fn empty_and_singleton_rosters_have_no_pairs() {
    assert!(ensure_dms_for_roster(Vec::new()).requests.is_empty());
    assert!(
        ensure_dms_for_roster(vec![user("only")])
            .requests
            .is_empty()
    );
}
