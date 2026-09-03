use super::*;

#[test]
fn persona_cannot_bypass_a_harness_that_requires_prompts() {
    assert!(validate_permission_bypass(false, Some(true)).is_err());
    for choice in [None, Some(false)] {
        assert!(validate_permission_bypass(false, choice).is_ok());
    }
    for choice in [None, Some(false), Some(true)] {
        assert!(validate_permission_bypass(true, choice).is_ok());
    }
}
