use super::*;

#[test]
fn posts_a_pass_recorded_here_that_the_commit_does_not_carry_yet() {
    assert_eq!(posting(Some(true), false, false), Posting::Pass);
    assert_eq!(posting(Some(true), true, false), Posting::Standing);
}

/// A failure on these files is final for `PR CI`; posting the pass again
/// would only read as if it still counted.
#[test]
fn never_posts_over_a_failure_on_the_same_files() {
    assert_eq!(posting(Some(true), false, true), Posting::Contradicted);
    assert_eq!(posting(Some(true), true, true), Posting::Contradicted);
}

#[test]
fn withdraws_a_pass_the_commit_carries_once_the_check_fails_here() {
    assert_eq!(posting(Some(false), true, false), Posting::Withdraw);
    assert_eq!(posting(Some(false), true, true), Posting::Nothing);
    assert_eq!(posting(Some(false), false, false), Posting::Nothing);
}

#[test]
fn posts_nothing_for_files_this_machine_never_ran_the_check_on() {
    assert_eq!(posting(None, false, false), Posting::Nothing);
    assert_eq!(posting(None, true, false), Posting::Nothing);
}

#[test]
fn names_a_few_paths_and_counts_the_rest() {
    let paths: Vec<String> = ["a", "b", "c", "d", "e"]
        .iter()
        .map(|path| (*path).to_owned())
        .collect();

    assert_eq!(some_of(&paths[..2]), "a, b");
    assert_eq!(some_of(&paths), "a, b, c and 2 more");
}
