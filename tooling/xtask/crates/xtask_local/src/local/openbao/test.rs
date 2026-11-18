use super::readable_mode;

#[test]
fn a_private_checkout_file_becomes_readable_by_the_container_user() {
    assert_eq!(readable_mode(0o100600), 0o100644);
    assert_eq!(readable_mode(0o100700), 0o100744);
}

#[test]
fn an_already_readable_file_keeps_its_mode() {
    assert_eq!(readable_mode(0o100644), 0o100644);
    assert_eq!(readable_mode(0o100755), 0o100755);
}
