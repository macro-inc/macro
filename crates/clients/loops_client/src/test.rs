use super::*;

#[test]
fn normalize_email_lowercases() {
    assert_eq!(normalize_email("Evan@Macro.COM"), "evan@macro.com");
}

#[test]
fn normalize_email_strips_plus_tag() {
    assert_eq!(normalize_email("evan+mobile@macro.com"), "evan@macro.com");
}

#[test]
fn normalize_email_agrees_across_signup_paths() {
    // The bug this guards: lead capture stripped `+` tags and the user webhook
    // did not, so one person landed on two Loops contacts and the nurture
    // sequence never saw their registration.
    assert_eq!(
        normalize_email("Evan+Test@Macro.com"),
        normalize_email("evan@macro.com")
    );
}

#[test]
fn normalize_email_leaves_malformed_input_alone() {
    assert_eq!(normalize_email("not-an-email"), "not-an-email");
}

#[test]
fn normalize_email_only_strips_the_local_part() {
    assert_eq!(normalize_email("evan@ma+cro.com"), "evan@ma+cro.com");
}

#[test]
fn idempotency_digest_fits_the_loops_header_limit() {
    // A `MacroUserId` embeds an email, so an untruncated key can run well past
    // the 100 characters Loops accepts.
    let long_key = format!("user-registered-{}@macro.com", "a".repeat(300));
    assert_eq!(idempotency_digest(&long_key).len(), 64);
}

#[test]
fn idempotency_digest_is_stable_and_distinct() {
    assert_eq!(
        idempotency_digest("mobile-lead-a"),
        idempotency_digest("mobile-lead-a")
    );
    assert_ne!(
        idempotency_digest("mobile-lead-a"),
        idempotency_digest("mobile-lead-b")
    );
}
