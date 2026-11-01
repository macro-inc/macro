use super::*;

fn step(subject: &str, body: &str, as_reply: bool) -> Step {
    Step {
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
fn rendered_steps_carry_subjects_footer_and_unsubscribe_link() {
    let steps = [
        step("Hello {{firstName}}", "Body one", false),
        step("ignored", "Body two", true),
        step("Re: Second thread", "Body three", false),
        step("", "Body four", true),
    ];
    let rendered = render_steps(
        &steps,
        "Sent by {{name}}",
        &recipient(Some("Ada\r\nLovelace")),
        "https://u/x",
    );
    let subjects: Vec<&str> = rendered.iter().map(|s| s.subject.as_str()).collect();
    assert_eq!(
        subjects,
        [
            "Hello Ada Lovelace",
            "Re: Hello Ada Lovelace",
            "Re: Second thread",
            "Re: Second thread"
        ]
    );
    assert_eq!(
        rendered[1].body,
        "Body two\n\nSent by Ada\r\nLovelace\nUnsubscribe: https://u/x"
    );
    assert!(rendered[1].as_reply && !rendered[2].as_reply);

    let bare = render_steps(&steps[..1], "  ", &recipient(None), "https://u/x");
    assert_eq!(bare[0].body, "Body one\n\nUnsubscribe: https://u/x");
}

#[test]
fn subjects_with_and_without_a_thread() {
    assert_eq!(reply_subject("Hello"), "Re: Hello");
    assert_eq!(reply_subject("RE: Hello"), "RE: Hello");
    assert_eq!(standalone_subject("Re:  Hello"), "Hello");
    assert_eq!(standalone_subject("Résumé"), "Résumé");
}

#[test]
fn validation_table() {
    let ok = || vec![step("Hi", "Body", false), step("", "Again", true)];
    let with = |edit: fn(&mut Vec<Step>)| {
        let mut steps = ok();
        edit(&mut steps);
        steps
    };
    let cases: Vec<(&str, &str, Vec<Step>, Option<(Problem, Option<usize>)>)> = vec![
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
            Some((Problem::TooManySteps, None)),
        ),
        (
            "first step replies",
            "Name",
            with(|s| s[0].as_reply = true),
            Some((Problem::FirstStepIsReply, Some(1))),
        ),
        (
            "two-line subject",
            "Name",
            with(|s| s[0].subject = "a\nb".into()),
            Some((Problem::SubjectSingleLine, Some(1))),
        ),
        (
            "long subject",
            "Name",
            with(|s| s[0].subject = "s".repeat(MAX_SUBJECT + 1)),
            Some((Problem::SubjectTooLong, Some(1))),
        ),
        (
            "long body",
            "Name",
            with(|s| s[1].body = "b".repeat(MAX_BODY + 1)),
            Some((Problem::BodyTooLong, Some(2))),
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
            "delay out of range",
            "Name",
            with(|s| s[1].delay_days = MAX_DELAY_DAYS + 1),
            Some((Problem::DelayRange, Some(2))),
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
    ];
    for (name, expected) in cases {
        assert_eq!(sanitize_name(name).as_deref(), expected, "{name:?}");
    }
    assert_eq!(sanitize_name(&"x".repeat(150)).map(|n| n.len()), Some(100));
}
