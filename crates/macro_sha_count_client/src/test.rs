use super::reference_counts;

#[test]
fn each_listing_of_a_sha_is_one_reference() {
    let shas = ["b", "a", "b", "c", "b"].map(String::from).to_vec();
    assert_eq!(
        reference_counts(shas),
        vec![("a".into(), 1), ("b".into(), 3), ("c".into(), 1)]
    );
}

#[test]
fn no_shas_release_nothing() {
    assert!(reference_counts(Vec::new()).is_empty());
}
