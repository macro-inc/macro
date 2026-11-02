use super::*;

#[test]
fn only_explicit_supported_capabilities_opt_in() {
    for version in [None, Some(""), Some("soup-mail-v2"), Some("soup-mail-v6")] {
        assert!(!MailCacheProfile::from_advertised(version).is_current());
    }
    assert!(MailCacheProfile::from_advertised(Some("soup-mail-v5")).is_current());
}
