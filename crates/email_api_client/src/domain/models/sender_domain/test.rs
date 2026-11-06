use super::*;

#[test]
fn accepts_lowercase_host_names() {
    for value in [
        "linear.app",
        "slack.com",
        "mail.notion.so",
        "x-1.github.io",
        "a.b",
    ] {
        assert_eq!(
            SenderDomain::new(value).map(|d| d.to_string()),
            Ok(value.to_string())
        );
    }
}

#[test]
fn rejects_values_that_could_change_a_provider_query() {
    for value in [
        "",
        "localhost",
        "Linear.app",
        "linear.app ",
        "linear app.com",
        "\"linear.app\"",
        "linear.app OR from:x.com",
        "user@example.com",
        ".linear.app",
        "linear.app.",
        "linear..app",
        "-linear.app",
        "linear-.app",
        "linéar.app",
        "linear.app)",
    ] {
        assert_eq!(
            SenderDomain::new(value),
            Err(InvalidSenderDomain),
            "{value:?}"
        );
    }
}

#[test]
fn enforces_dns_length_limits() {
    let long_label = format!("{}.com", "a".repeat(64));
    assert_eq!(SenderDomain::new(long_label), Err(InvalidSenderDomain));

    let longest_label = format!("{}.com", "a".repeat(63));
    assert!(SenderDomain::new(longest_label).is_ok());

    let label = "a".repeat(62);
    let too_long = format!("{label}.{label}.{label}.{label}.com");
    assert_eq!(too_long.len(), 255);
    assert_eq!(SenderDomain::new(too_long), Err(InvalidSenderDomain));

    let longest = format!("{label}.{label}.{label}.{}.com", "a".repeat(60));
    assert_eq!(longest.len(), 253);
    assert!(SenderDomain::new(longest).is_ok());
}
