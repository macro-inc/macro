use super::*;

fn step(subject: &str, body: &str, as_reply: bool) -> Step {
    Step {
        id: uuid::Uuid::now_v7(),
        delay_days: 0,
        subject: subject.to_owned(),
        body: body.to_owned(),
        as_reply,
    }
}

fn recipient(name: Option<&str>) -> Recipient {
    Recipient {
        email: "ada@example.com".to_owned(),
        name: name.map(str::to_owned),
    }
}

#[test]
fn personalization_table() {
    let cases = [
        ("Hi {{firstName}}", Some("Ada Lovelace"), "Hi Ada"),
        ("Hi {{ firstName }}", Some("Lovelace, Ada B"), "Hi Ada"),
        ("Hi {{firstName}}", Some("Ada Lovelace, PhD"), "Hi Ada"),
        (
            "Hi {{firstName}}",
            Some("Martin Luther King, Jr."),
            "Hi Martin",
        ),
        ("Hi {{firstName}}", Some("Jane Doe, Acme Corp"), "Hi Jane"),
        ("Hi {{firstName}}", Some("Bob Jones (Acme, Inc.)"), "Hi Bob"),
        (
            "Hi {{firstName}}",
            Some("The Analytical Co,"),
            "Hi The Analytical Co",
        ),
        ("Hi {{firstName}}", None, "Hi there"),
        ("Hi {{name}}", Some("  "), "Hi there"),
        ("To {{email}}", None, "To ada@example.com"),
        ("{{name}}", Some("<b>Ada</b> *x* 🎉"), "<b>Ada</b> *x* 🎉"),
    ];
    for (template, name, expected) in cases {
        assert_eq!(
            personalize(template, &recipient(name)),
            expected,
            "{template}"
        );
    }
}

#[test]
fn a_step_renders_with_its_thread_subject_footer_and_unsubscribe_link() {
    let steps = [
        step("Hello {{firstName}}", "Body one", false),
        step("ignored", "Body two", true),
        step("Re: Second thread", "Body three", false),
        step("", "Body four", true),
    ];
    let ada = recipient(Some("Ada\r\nLovelace"));
    let rendered: Vec<Rendered> = (0..steps.len())
        .map(|index| render(&steps, index, "Sent by {{name}}", &ada, "https://u/x"))
        .collect();
    let subjects: Vec<&str> = rendered.iter().map(|r| r.subject.as_str()).collect();
    assert_eq!(
        subjects,
        [
            "Hello Ada Lovelace",
            "Hello Ada Lovelace",
            "Re: Second thread",
            "Re: Second thread"
        ]
    );
    assert_eq!(
        rendered[1].body,
        "Body two\n\nSent by Ada\r\nLovelace\nUnsubscribe: https://u/x"
    );
    let bare = render(&steps, 0, "  ", &recipient(None), "https://u/x");
    assert_eq!(bare.body, "Body one\n\nUnsubscribe: https://u/x");
    // A reply sent in the thread answers what went out.
    assert_eq!(reply_subject("Hello"), "Re: Hello");
    assert_eq!(reply_subject("RE: Hello"), "RE: Hello");
}

/// A case: label, sequence name, steps, and the expected problem with its step.
type Case = (
    &'static str,
    &'static str,
    Vec<Step>,
    Option<(Problem, Option<usize>)>,
);

#[test]
fn validation_table() {
    let ok = || vec![step("Hi", "Body", false), step("", "Again", true)];
    let with = |edit: fn(&mut Vec<Step>)| {
        let mut steps = ok();
        edit(&mut steps);
        steps
    };
    let cases: Vec<Case> = vec![
        ("valid", "Name", ok(), None),
        ("blank name", " ", ok(), Some((Problem::NameRequired, None))),
        (
            "no steps",
            "Name",
            vec![],
            Some((Problem::StepsRequired, None)),
        ),
        (
            "too many steps",
            "Name",
            vec![step("Hi", "Body", false); MAX_STEPS + 1],
            Some((Problem::OverLimit, None)),
        ),
        (
            "long subject",
            "Name",
            with(|s| s[0].subject = "s".repeat(MAX_SUBJECT + 1)),
            Some((Problem::OverLimit, Some(1))),
        ),
        (
            "long body",
            "Name",
            with(|s| s[1].body = "b".repeat(MAX_BODY + 1)),
            Some((Problem::OverLimit, Some(2))),
        ),
        (
            "missing subject",
            "Name",
            with(|s| s[0].subject = " ".into()),
            Some((Problem::SubjectRequired, Some(1))),
        ),
        (
            "blank body",
            "Name",
            with(|s| s[1].body = "\n".into()),
            Some((Problem::BodyRequired, Some(2))),
        ),
        (
            "unknown token",
            "Name",
            with(|s| s[1].body = "Hi {{company}}".into()),
            Some((Problem::UnknownToken, Some(2))),
        ),
    ];
    for (name, title, steps, expected) in cases {
        let result = check_complete(title, "", &steps)
            .err()
            .map(|e| (e.problem, e.position));
        assert_eq!(result, expected, "{name}");
    }
    // A draft may be incomplete but not malformed.
    assert!(check_limits("", "", &[step("", "", false)]).is_ok());
    assert!(check_limits("Name", "{{nope}}", &ok()).is_err());
}

#[test]
fn unknown_tokens_report_typos() {
    assert_eq!(
        unknown_tokens("Hi {{company}} and {{firstName}}"),
        ["{{company}}"]
    );
    assert_eq!(
        unknown_tokens("Hi {{first Name}}"),
        ["{{first Name}}", "Hi {{first Name}}"]
    );
    assert_eq!(unknown_tokens("Hi name}}"), ["Hi name}}"]);
    assert!(unknown_tokens("Hi {{ email }}").is_empty());
}

#[test]
fn names_are_sanitized_before_personalization() {
    let cases = [
        ("Ada Lovelace", Some("Ada Lovelace")),
        ("Ada\u{202e}ecalevol", Some("Adaecalevol")),
        ("Ada\r\nBcc: x", Some("AdaBcc: x")),
        ("Win a prize https://evil.example", None),
        ("ada@example.com", None),
        ("   ", None),
        ("[Reset password](evil.example/x)", None),
        ("**Urgent**", None),
        ("\u{200b}", None),
        ("Ada\u{feff} Lovelace", Some("Ada Lovelace")),
        ("Ada 👩\u{200d}💻", Some("Ada 👩\u{200d}💻")),
    ];
    for (name, expected) in cases {
        assert_eq!(sanitize_name(name).as_deref(), expected, "{name:?}");
    }
    assert_eq!(sanitize_name(&"x".repeat(150)).map(|n| n.len()), Some(100));
}

#[test]
fn stored_text_keeps_only_line_breaks_and_tabs_and_subjects_one_line() {
    assert_eq!(clean_text("a\u{0}b\r\n\tc\u{7}"), "ab\r\n\tc");
    assert_eq!(clean_subject("a\r\nb\u{0}"), "a b");
}
