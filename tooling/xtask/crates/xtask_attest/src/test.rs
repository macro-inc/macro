use super::*;

const NOTHING: Said = Said {
    passed_on_head: false,
    failed_on_head: false,
    failed_elsewhere: false,
};
const PASSED: Said = Said {
    passed_on_head: true,
    ..NOTHING
};

#[test]
fn posts_a_pass_recorded_here_that_the_commit_does_not_carry_yet() {
    assert_eq!(posting(Some(true), NOTHING), Posting::Pass);
    assert_eq!(posting(Some(true), PASSED), Posting::Standing);
}

/// A failure on this tree is final for `PR CI`; posting the pass again would
/// only read as if it still counted.
#[test]
fn never_posts_over_a_failure_on_the_same_tree() {
    let failed_here = Said {
        failed_on_head: true,
        ..NOTHING
    };
    let failed_before = Said {
        failed_elsewhere: true,
        ..NOTHING
    };

    assert_eq!(posting(Some(true), failed_here), Posting::Contradicted);
    assert_eq!(posting(Some(true), failed_before), Posting::Contradicted);
    assert_eq!(
        posting(
            Some(true),
            Said {
                passed_on_head: true,
                ..failed_here
            }
        ),
        Posting::Contradicted
    );
}

/// `PR CI` reads the head only. A pass it carries over a failure that sits
/// on another commit with the same files would still skip the job.
#[test]
fn withdraws_a_pass_the_head_carries_once_the_tree_has_failed_anywhere() {
    let audited_on_an_earlier_commit = Said {
        failed_elsewhere: true,
        ..PASSED
    };

    assert_eq!(posting(Some(false), PASSED), Posting::Withdraw);
    assert_eq!(
        posting(Some(true), audited_on_an_earlier_commit),
        Posting::Withdraw
    );
    assert_eq!(
        posting(None, audited_on_an_earlier_commit),
        Posting::Withdraw
    );
}

#[test]
fn posts_nothing_for_a_tree_the_check_failed_or_never_ran_on_here() {
    assert_eq!(posting(Some(false), NOTHING), Posting::Nothing);
    assert_eq!(posting(None, NOTHING), Posting::Nothing);
    assert_eq!(posting(None, PASSED), Posting::Nothing);
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
