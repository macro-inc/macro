use super::compute_body_replyless;

#[test]
fn test_extract_message_reply_outlook_test_1() {
    let full_email = include_str!("testdata/outlook-test-1/full.html");
    let expected_reply = include_str!("testdata/outlook-test-1/body_replyless.html");

    test_email_extraction(full_email, expected_reply, "outlook-test-1");
}

#[test]
fn test_extract_message_reply_outlook_test_2() {
    let full_email = include_str!("testdata/outlook-test-2/full.html");
    let expected_reply = include_str!("testdata/outlook-test-2/body_replyless.html");

    test_email_extraction(full_email, expected_reply, "outlook-test-2");
}

#[test]
fn test_extract_message_reply_test_1() {
    let full_email = include_str!("testdata/test-1/full.html");
    let expected_reply = include_str!("testdata/test-1/body_replyless.html");

    test_email_extraction(full_email, expected_reply, "test-1");
}

#[test]
fn test_extract_message_reply_test_2() {
    let full_email = include_str!("testdata/test-2/full.html");
    let expected_reply = include_str!("testdata/test-2/body_replyless.html");

    test_email_extraction(full_email, expected_reply, "test-2");
}

#[test]
fn test_extract_message_reply_test_3() {
    let full_email = include_str!("testdata/test-3/full.html");
    let expected_reply = include_str!("testdata/test-3/body_replyless.html");

    test_email_extraction(full_email, expected_reply, "test-3");
}

/// gmail selectors WITHOUT a gmail_attr div within them should not be split off
#[test]
fn test_extract_message_reply_test_4() {
    let full_email = include_str!("testdata/test-4/full.html");
    let expected_reply = include_str!("testdata/test-4/body_replyless.html");

    test_email_extraction(full_email, expected_reply, "test-4");
}

/// the entire email (including style tags before the body) should be used if no splitter
/// is found on the email
#[test]
fn test_extract_message_reply_test_5() {
    let full_email = include_str!("testdata/test-5/full.html");
    let expected_reply = include_str!("testdata/test-5/body_replyless.html");

    test_email_extraction(full_email, expected_reply, "test-5");
}

fn test_email_extraction(full_email: &str, expected_reply: &str, test_name: &str) {
    let body_replyless = compute_body_replyless(None, Some(full_email), None);

    assert_eq!(
        body_replyless
            .unwrap()
            .replace(" ", "")
            .replace("\n", "")
            .trim(),
        expected_reply.replace(" ", "").replace("\n", "").trim(),
        "Test '{}' failed: extracted reply doesn't match expected",
        test_name
    );
}
