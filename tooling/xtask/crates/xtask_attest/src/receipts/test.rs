use super::*;

fn receipts() -> (tempfile::TempDir, Receipts) {
    let dir = tempfile::tempdir().expect("a directory");
    let receipts = Receipts::open(dir.path().join("receipts")).expect("opens");
    (dir, receipts)
}

#[test]
fn finds_a_pass_only_for_the_tree_and_definition_it_ran_on() {
    let (_dir, receipts) = receipts();
    receipts
        .record("web-app/cycles", "aaaa", "1111", true, "c0ffee")
        .expect("records");

    let found = receipts
        .find("web-app/cycles", "aaaa", "1111")
        .expect("a receipt");

    assert!(found.passed);
    assert_eq!(found.commit, "c0ffee");
    assert!(receipts.find("web-app/cycles", "aaaa", "2222").is_none());
    assert!(receipts.find("web-app/cycles", "bbbb", "1111").is_none());
    assert!(
        receipts
            .find("web-app/biome-check", "aaaa", "1111")
            .is_none()
    );
}

#[test]
fn a_later_run_on_the_same_tree_replaces_the_earlier_one() {
    let (_dir, receipts) = receipts();
    receipts
        .record("infra/check", "aaaa", "1111", true, "c0ffee")
        .expect("records");
    receipts
        .record("infra/check", "aaaa", "1111", false, "c0ffee")
        .expect("records");

    assert!(
        !receipts
            .find("infra/check", "aaaa", "1111")
            .expect("a receipt")
            .passed
    );
    assert_eq!(receipts.of("infra/check").len(), 1);
}

#[test]
fn lists_one_checks_receipts_and_not_a_check_whose_name_starts_alike() {
    let (_dir, receipts) = receipts();
    receipts
        .record("infra/check", "aaaa", "1111", true, "c0ffee")
        .expect("records");
    receipts
        .record("infra/check", "aaaa", "2222", true, "decade")
        .expect("records");
    receipts
        .record("infra/check-more", "aaaa", "1111", true, "c0ffee")
        .expect("records");

    let trees: Vec<String> = receipts
        .of("infra/check")
        .into_iter()
        .map(|receipt| receipt.tree)
        .collect();

    assert_eq!(trees.len(), 2);
    assert!(trees.contains(&"1111".to_owned()) && trees.contains(&"2222".to_owned()));
}

#[test]
fn forgets_a_receipt_too_old_to_matter() {
    let (_dir, receipts) = receipts();
    let old = Receipt {
        check: "infra/check".to_owned(),
        fingerprint: "aaaa".to_owned(),
        tree: "0000".to_owned(),
        passed: true,
        commit: "c0ffee".to_owned(),
        at: 1,
    };
    std::fs::write(
        receipts.path("infra/check", "aaaa", "0000"),
        serde_json::to_string(&old).expect("serializes"),
    )
    .expect("writes");

    receipts
        .record("infra/check", "aaaa", "1111", true, "c0ffee")
        .expect("records");

    assert!(receipts.find("infra/check", "aaaa", "0000").is_none());
    assert!(receipts.find("infra/check", "aaaa", "1111").is_some());
}
