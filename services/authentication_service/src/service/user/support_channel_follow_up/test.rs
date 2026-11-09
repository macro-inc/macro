use super::*;

fn at(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(1_800_000_000 + seconds, 0).unwrap()
}

/// Someone who finished setup alone with a work email and connected Gmail.
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

fn in_setup() -> Signals {
    Signals {
        finished_setup: false,
        inbox_connected: false,
        ..finished()
    }
}

fn tool(slug: &str, name: &str) -> Tool {
    Tool {
        slug: slug.to_owned(),
        name: name.to_owned(),
    }
}

#[test]
fn looks_shortly_after_setup_finishes_and_otherwise_at_five_minutes() {
    let welcomed = at(0);

    assert_eq!(due(welcomed, None, at(299)), None);
    assert_eq!(due(welcomed, None, at(300)), Some(Trigger::StillInSetup));

    let finished_setup = Some(at(90));
    assert_eq!(due(welcomed, finished_setup, at(119)), None);
    assert_eq!(
        due(welcomed, finished_setup, at(120)),
        Some(Trigger::FinishedSetup)
    );

    // Finishing setup before the welcome posted doesn't hold it back.
    assert_eq!(
        due(at(60), Some(at(10)), at(60)),
        Some(Trigger::FinishedSetup)
    );
}

#[test]
fn someone_still_in_setup_only_hears_about_what_is_holding_them() {
    assert_eq!(choose(&in_setup()), None);
    assert_eq!(
        choose(&Signals {
            on_phone: true,
            ..in_setup()
        }),
        Some(Path::Phone)
    );
    assert_eq!(
        choose(&Signals {
            opened_checkout: true,
            on_phone: true,
            ..in_setup()
        }),
        Some(Path::Pricing)
    );
    assert_eq!(
        choose(&Signals {
            gmail_attempted: true,
            opened_checkout: true,
            ..in_setup()
        }),
        Some(Path::GmailTrouble)
    );
    assert_eq!(
        choose(&Signals {
            paid: true,
            gmail_attempted: true,
            ..in_setup()
        }),
        Some(Path::Pro)
    );
    // Setup results only count once setup is finished.
    assert_eq!(
        choose(&Signals {
            mail_provider: MailProvider::Microsoft,
            team: Some(TeamSignal { name: None }),
            ..in_setup()
        }),
        None
    );
}

#[test]
fn a_finished_user_gets_the_first_message_that_fits() {
    let no_inbox = Signals {
        inbox_connected: false,
        ..finished()
    };
    assert_eq!(
        choose(&Signals {
            mail_provider: MailProvider::Microsoft,
            ..no_inbox.clone()
        }),
        Some(Path::Outlook)
    );
    assert_eq!(
        choose(&Signals {
            mail_provider: MailProvider::Google,
            ..no_inbox.clone()
        }),
        Some(Path::GoogleWorkInbox("acme.com"))
    );
    // A personal Gmail without an inbox gets the message for the rest of their
    // signup, not an email nudge.
    assert_eq!(
        choose(&Signals {
            mail_provider: MailProvider::Google,
            work_domain: false,
            domain: "gmail.com".to_owned(),
            ..no_inbox.clone()
        }),
        Some(Path::Personal)
    );
    // A connect that never landed beats the provider.
    assert_eq!(
        choose(&Signals {
            gmail_attempted: true,
            mail_provider: MailProvider::Google,
            ..no_inbox
        }),
        Some(Path::GmailTrouble)
    );
    // Once the inbox is in, a Gmail attempt no longer matters.
    assert_eq!(
        choose(&Signals {
            gmail_attempted: true,
            ..finished()
        }),
        Some(Path::SoloWork)
    );

    assert_eq!(
        choose(&Signals {
            opened_checkout: true,
            team: Some(TeamSignal {
                name: Some("Acme".to_owned())
            }),
            ..finished()
        }),
        Some(Path::Pricing)
    );
    assert_eq!(
        choose(&Signals {
            team: Some(TeamSignal {
                name: Some("Acme".to_owned())
            }),
            tools: vec![tool("notion", "Notion")],
            ..finished()
        }),
        Some(Path::Team(Some("Acme")))
    );
    assert_eq!(
        choose(&Signals {
            tools: vec![tool("notion", "Notion")],
            ..finished()
        }),
        Some(Path::Notion)
    );
    // The phone only matters to someone who never did setup on a computer.
    assert_eq!(
        choose(&Signals {
            on_phone: true,
            ..finished()
        }),
        Some(Path::SoloWork)
    );
    assert_eq!(
        choose(&Signals {
            work_domain: false,
            domain: "gmail.com".to_owned(),
            ..finished()
        }),
        Some(Path::Personal)
    );
}

#[test]
fn importable_tools_come_first_then_github_then_others_by_name() {
    assert_eq!(tool_path(&[]), None);
    assert_eq!(
        tool_path(&[
            tool("google_drive", "Google Drive"),
            tool(GITHUB, "GitHub"),
            tool("slack", "Slack"),
            tool("linear", "Linear"),
        ]),
        Some(Path::Linear)
    );
    assert_eq!(
        tool_path(&[tool("figma", "Figma"), tool(GITHUB, "GitHub")]),
        Some(Path::Github)
    );
    assert_eq!(
        tool_path(&[
            tool("figma", "Figma"),
            tool("hubspot", "**HubSpot**"),
            tool("google_drive", "Google Drive"),
            tool("posthog", "PostHog"),
        ]),
        Some(Path::OtherTools(vec!["Figma", "Google Drive"]))
    );
    assert_eq!(tool_path(&[tool("hubspot", "**HubSpot**")]), None);
}

#[test]
fn reads_the_mail_provider_from_its_mail_servers() {
    let provider = |hosts: &[&str]| {
        MailProvider::from_exchanges(
            &hosts
                .iter()
                .map(|host| (*host).to_owned())
                .collect::<Vec<_>>(),
        )
    };
    assert_eq!(
        provider(&["aspmx.l.google.com.", "alt1.aspmx.l.google.com."]),
        MailProvider::Google
    );
    assert_eq!(
        provider(&["gmail-smtp-in.l.google.com."]),
        MailProvider::Google
    );
    assert_eq!(
        provider(&["acme-com.mail.protection.outlook.com."]),
        MailProvider::Microsoft
    );
    assert_eq!(
        provider(&["hotmail-com.olc.protection.outlook.com."]),
        MailProvider::Microsoft
    );
    assert_eq!(provider(&["mx1.zoho.com."]), MailProvider::Other);
    // A look-alike host is not Google.
    assert_eq!(provider(&["mail.notgoogle.com."]), MailProvider::Other);
    assert_eq!(provider(&[]), MailProvider::Other);
}

#[test]
fn every_message_opens_the_same_way_and_stays_short() {
    let paths = [
        Path::Pro,
        Path::GmailTrouble,
        Path::Outlook,
        Path::GoogleWorkInbox("acme.com"),
        Path::Pricing,
        Path::Phone,
        Path::Team(Some("Acme Design Studio")),
        Path::Team(None),
        Path::Notion,
        Path::Linear,
        Path::Slack,
        Path::Github,
        Path::OtherTools(vec!["Figma"]),
        Path::OtherTools(vec!["Figma", "Google Drive"]),
        Path::SoloWork,
        Path::Personal,
    ];
    for path in &paths {
        let text = message("@Sam", path);
        assert!(
            text.starts_with("Hey @Sam, Chaitanya here, also on the Macro team. "),
            "{text}"
        );
        let words = text.split_whitespace().count();
        assert!((15..=40).contains(&words), "{words} words: {text}");
        assert!(text.matches('?').count() <= 2, "{text}");
        assert!(!text.contains("{"), "{text}");
    }
    assert!(message("@Sam", &Path::Team(None)).contains("Excited to have your team on Macro!"));
    assert!(
        message("@Sam", &Path::OtherTools(vec!["Figma", "Google Drive"]))
            .contains("I saw you connected Figma and Google Drive.")
    );
}

#[test]
fn leaves_markup_and_long_names_out_of_the_message() {
    assert_eq!(plain_name("  Acme & Co.  "), Some("Acme & Co."));
    assert_eq!(plain_name("**Acme**"), None);
    assert_eq!(plain_name("<m-user-mention>x</m-user-mention>"), None);
    assert_eq!(plain_name("[Acme](https://example.com)"), None);
    assert_eq!(plain_name(&"a".repeat(41)), None);
    assert_eq!(plain_name("   "), None);
}
