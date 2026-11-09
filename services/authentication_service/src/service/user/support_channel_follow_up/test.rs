use super::*;

fn at(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(1_800_000_000 + seconds, 0).unwrap()
}

/// Finished setup alone, with a connected work inbox.
fn finished() -> Signals {
    Signals {
        finished_setup: true,
        paid: false,
        opened_checkout: false,
        on_phone: false,
        gmail_attempted: false,
        inbox_connected: true,
        domain: "acme.com".to_owned(),
        work_domain: true,
        mail_provider: MailProvider::Other,
        team: None,
        tools: Vec::new(),
    }
}

fn tool(slug: &str, name: &str) -> Tool {
    Tool {
        slug: slug.to_owned(),
        name: name.to_owned(),
    }
}

#[test]
fn looks_30_seconds_after_setup_or_at_five_minutes() {
    assert!(!due(at(0), None, at(299)));
    assert!(due(at(0), None, at(300)));
    assert!(!due(at(0), Some(at(90)), at(119)));
    assert!(due(at(0), Some(at(90)), at(120)));
}

#[test]
fn sends_the_first_message_that_fits() {
    let in_setup = Signals {
        finished_setup: false,
        inbox_connected: false,
        mail_provider: MailProvider::Microsoft,
        team: Some("Acme".to_owned()),
        ..finished()
    };
    let no_inbox = Signals {
        inbox_connected: false,
        ..finished()
    };
    let cases = [
        // In setup, only what is holding them counts.
        (in_setup.clone(), None),
        (
            Signals {
                on_phone: true,
                ..in_setup.clone()
            },
            Some(Path::Phone),
        ),
        (
            Signals {
                opened_checkout: true,
                on_phone: true,
                ..in_setup.clone()
            },
            Some(Path::Pricing),
        ),
        (
            Signals {
                gmail_attempted: true,
                opened_checkout: true,
                ..in_setup.clone()
            },
            Some(Path::GmailTrouble),
        ),
        (
            Signals {
                paid: true,
                gmail_attempted: true,
                ..in_setup
            },
            Some(Path::Pro),
        ),
        // Finished, without an inbox.
        (
            Signals {
                mail_provider: MailProvider::Microsoft,
                ..no_inbox.clone()
            },
            Some(Path::Outlook),
        ),
        (
            Signals {
                mail_provider: MailProvider::Google,
                ..no_inbox.clone()
            },
            Some(Path::GoogleWorkInbox("acme.com")),
        ),
        (
            Signals {
                mail_provider: MailProvider::Google,
                work_domain: false,
                ..no_inbox
            },
            Some(Path::Personal),
        ),
        // Finished, with an inbox.
        (
            Signals {
                gmail_attempted: true,
                ..finished()
            },
            Some(Path::SoloWork),
        ),
        (
            Signals {
                team: Some("Acme".to_owned()),
                tools: vec![tool("notion", "Notion")],
                ..finished()
            },
            Some(Path::Team("Acme")),
        ),
        (
            Signals {
                tools: vec![tool("notion", "Notion")],
                ..finished()
            },
            Some(Path::Notion),
        ),
        (
            Signals {
                on_phone: true,
                ..finished()
            },
            Some(Path::SoloWork),
        ),
    ];
    for (signals, path) in &cases {
        assert_eq!(&choose(signals), path, "{signals:?}");
    }
}

#[test]
fn importable_tools_come_first_then_github_then_others() {
    assert_eq!(
        tool_path(&[
            tool("figma", "Figma"),
            tool("github", "GitHub"),
            tool("linear", "Linear")
        ]),
        Some(Path::Linear)
    );
    assert_eq!(
        tool_path(&[tool("figma", "Figma"), tool("github", "GitHub")]),
        Some(Path::Github)
    );
    assert_eq!(
        tool_path(&[
            tool("hubspot", "**HubSpot**"),
            tool("figma", "Figma"),
            tool("drive", "Google Drive"),
            tool("posthog", "PostHog"),
        ]),
        Some(Path::OtherTools(vec!["Figma", "Google Drive"]))
    );
    assert_eq!(tool_path(&[tool("hubspot", "**HubSpot**")]), None);
}

#[test]
fn reads_the_mail_provider_from_its_mail_servers() {
    let provider = |host: &str| MailProvider::from_exchanges(&[host.to_owned()]);
    assert_eq!(provider("aspmx.l.google.com."), MailProvider::Google);
    assert_eq!(
        provider("acme-com.mail.protection.outlook.com."),
        MailProvider::Microsoft
    );
    assert_eq!(provider("mail.notgoogle.com."), MailProvider::Other);
}

#[test]
fn leaves_markup_and_long_names_out() {
    assert_eq!(plain_name("  Acme & Co.  "), Some("Acme & Co."));
    assert_eq!(plain_name("**Acme**"), None);
    assert_eq!(plain_name(&"a".repeat(41)), None);
}
