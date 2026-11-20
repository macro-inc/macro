use super::*;

#[test]
fn a_line_is_trimmed_bounded_and_plain() {
    assert_eq!(
        line("  Reply to the quote  ", 40).as_deref(),
        Some("Reply to the quote")
    );
    assert_eq!(line("two\nlines", 40), None);
    assert_eq!(line("hidden\u{202E}text", 40), None);
    assert_eq!(line("   ", 40), None);
    assert_eq!(line("abcdef", 5), None);
}

#[test]
fn personal_details_are_found_by_shape() {
    let address = format!("write to {}@{}.com", "sam", "example");
    assert_eq!(personal_detail(&address), Some("an email address"));
    let phone = format!("call {}-{}-{}", "415", "555", "0134");
    assert_eq!(personal_detail(&phone), Some("a phone number"));
    let street = format!("ship to {} Market Street", 12);
    assert_eq!(personal_detail(&street), Some("a street address"));
    assert_eq!(personal_detail("Follow up on the supplier quote"), None);
    let id = format!(
        "read 5eede48c-ab34-{}-{}-1e18fdb1c5f4 first",
        "8569", "9698"
    );
    assert_eq!(personal_detail(&id), None);
}
