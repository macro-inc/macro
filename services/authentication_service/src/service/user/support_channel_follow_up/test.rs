use super::*;
use crate::service::user::support_channel_welcome::{
    AuthorizedSupportChannelMessages, post_support_channel_welcome,
};
use channels::{
    domain::{
        models::{ChannelType, CreateChannelRequest},
        ports::ChannelService,
        service::{ChannelServiceImpl, NoopChannelEventDispatcher},
    },
    outbound::{
        pg_channel_reference_share_permissions::PgChannelReferenceSharePermissions,
        pg_channels_repo::PgChannelsRepo,
    },
};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use messages::{
    domain::{ports::NoMessageEventPublisher, service::MessageService},
    outbound::{
        entity_access_audience::EntityAccessMessageReferences, pg_message_repo::PgMessageRepository,
    },
};

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
        mid_attempt: false,
        inbox_connected: true,
        domain: "acme.com".to_owned(),
        work_domain: true,
        mail_provider: MailProvider::Other,
        outlook_offered: true,
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
fn something_the_user_started_is_under_way_for_five_minutes() {
    assert!(!under_way(None, at(0)));
    assert!(under_way(Some(at(0)), at(299)));
    assert!(!under_way(Some(at(0)), at(300)));
}

#[test]
fn any_post_besides_the_welcome_starts_the_conversation() {
    let welcome = Uuid::from_u128(1);
    let follow_up = Uuid::from_u128(2);
    let reply = Uuid::from_u128(3);

    assert!(!conversation_started([(welcome, 0)], follow_up));
    assert!(!conversation_started(
        [(follow_up, 0), (welcome, 0)],
        follow_up
    ));
    assert!(conversation_started([(welcome, 1)], follow_up));
    assert!(conversation_started([(reply, 0), (welcome, 0)], follow_up));
    assert!(conversation_started(
        [(reply, 0), (follow_up, 0), (welcome, 0)],
        follow_up
    ));
}

#[test]
fn sends_the_first_message_that_fits() {
    let in_setup = Signals {
        finished_setup: false,
        inbox_connected: false,
        mail_provider: MailProvider::Microsoft,
        team: Some(TeamTie::Brought("Acme".to_owned())),
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
                ..in_setup.clone()
            },
            Some(Path::Paid),
        ),
        // In the middle of connecting Gmail or checking out, it waits.
        (
            Signals {
                gmail_attempted: true,
                opened_checkout: true,
                on_phone: true,
                mid_attempt: true,
                ..in_setup
            },
            None,
        ),
        (
            Signals {
                opened_checkout: true,
                mid_attempt: true,
                ..finished()
            },
            None,
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
                mail_provider: MailProvider::Microsoft,
                outlook_offered: false,
                ..no_inbox.clone()
            },
            Some(Path::SoloWork),
        ),
        (
            Signals {
                mail_provider: MailProvider::Google,
                ..no_inbox.clone()
            },
            Some(Path::GoogleInbox(Some("acme.com"))),
        ),
        (
            Signals {
                mail_provider: MailProvider::Google,
                work_domain: false,
                ..no_inbox.clone()
            },
            Some(Path::GoogleInbox(None)),
        ),
        // Someone who started connecting Gmail is asked about that instead.
        (
            Signals {
                mail_provider: MailProvider::Google,
                gmail_attempted: true,
                ..no_inbox
            },
            Some(Path::GmailTrouble),
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
                team: Some(TeamTie::Brought("Acme".to_owned())),
                tools: vec![tool("notion", "Notion")],
                ..finished()
            },
            Some(Path::Team("Acme")),
        ),
        // Someone who joined a team is never asked whether they are alone.
        (
            Signals {
                team: Some(TeamTie::Joined("Acme".to_owned())),
                ..finished()
            },
            Some(Path::Teammate("Acme")),
        ),
        (
            Signals {
                team: Some(TeamTie::Joined("Acme".to_owned())),
                tools: vec![tool("notion", "Notion")],
                ..finished()
            },
            Some(Path::Notion),
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
    // Slack connects as `slack_v2`.
    assert_eq!(
        tool_path(&[tool("figma", "Figma"), tool("slack_v2", "Slack")]),
        Some(Path::Slack)
    );
    assert_eq!(
        tool_path(&[
            tool("slack_v2", "Slack"),
            tool("github", "GitHub"),
            tool("notion", "Notion")
        ]),
        Some(Path::SeveralImports(vec![
            Importable::Notion,
            Importable::Slack
        ]))
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

#[test]
fn lists_names_the_way_a_sentence_reads() {
    assert_eq!(listed(&["Notion"]), "Notion");
    assert_eq!(listed(&["Notion", "Linear"]), "Notion and Linear");
    assert_eq!(
        listed(&["Notion", "Linear", "Slack"]),
        "Notion, Linear and Slack"
    );
}

/// The real channel, welcome and message service: the follow-up posts once
/// however often it is retried, and a reply from the user is seen.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn posts_once_after_the_welcome_and_sees_a_reply(db: PgPool) {
    let access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        db.clone(),
    )));
    let messages: Arc<dyn MessageServiceApi> = Arc::new(
        MessageService::new(
            PgMessageRepository::new(db.clone()),
            NoMessageEventPublisher,
        )
        .with_references(EntityAccessMessageReferences((*access).clone())),
    );
    let channels = ChannelServiceImpl::with_dependencies(
        PgChannelsRepo::new(db.clone()),
        NoopChannelEventDispatcher,
        PgChannelReferenceSharePermissions::new(db.clone(), access.clone()),
    );

    let user = MacroUserIdStr::try_from_email("new.user@example.com").unwrap();
    let welcomer = MacroUserIdStr::try_from_email("julia@macro.com").unwrap();
    let follow_up_sender = MacroUserIdStr::try_from_email(SENDER_EMAIL).unwrap();
    for person in [&user, &welcomer, &follow_up_sender] {
        let macro_user_id = macro_uuid::generate_uuid_v7();
        sqlx::query!(
            "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
            macro_user_id,
            person.email_str(),
        )
        .execute(&db)
        .await
        .unwrap();
        sqlx::query!(
            r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
            person.as_ref(),
            person.email_str(),
            macro_user_id,
        )
        .execute(&db)
        .await
        .unwrap();
    }

    let channel = channels
        .create_system_channel(
            user.clone(),
            CreateChannelRequest {
                name: Some("Macro Support x new.user".to_owned()),
                channel_type: ChannelType::Private,
                team_id: None,
                auto_join_team: false,
                participants: [welcomer, follow_up_sender].into(),
            },
        )
        .await
        .unwrap();
    post_support_channel_welcome(
        &AuthorizedSupportChannelMessages::new(messages.clone(), access.clone()),
        &channel.id,
        user.clone(),
    )
    .await
    .unwrap();

    let sender = FollowUpSender {
        messages: messages.clone(),
        access: access.clone(),
    };
    let channel_id = Uuid::parse_str(&channel.id).unwrap();
    let message_id = macro_uuid::generate_uuid_v7();
    assert!(
        !sender
            .has_conversation(channel_id, message_id)
            .await
            .unwrap()
    );

    let content = message(&user_mention(&user).unwrap(), &Path::Personal);
    sender
        .post(channel_id, message_id, &user, content.clone())
        .await
        .unwrap();
    sender
        .post(channel_id, message_id, &user, content.clone())
        .await
        .unwrap();
    let posted = sqlx::query_scalar!(
        "SELECT content FROM comms_messages WHERE parent_entity_id = $1 ORDER BY created_at",
        channel.id,
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(posted.len(), 2);
    assert_eq!(posted[1], content);
    assert!(
        !sender
            .has_conversation(channel_id, message_id)
            .await
            .unwrap()
    );

    let reply = access
        .generate_entity_access_receipt::<MessageWrite>(
            &user,
            None,
            &channel.id,
            EntityType::Channel,
        )
        .await
        .unwrap();
    messages
        .post(
            reply,
            PostMessage {
                id: None,
                attribution: MessageAttribution::Unprompted,
                notification_policy: PostMessageNotificationPolicy::MentionsOnly,
                content: "Email, mostly.".to_owned(),
                thread_id: None,
                anchor: None,
                mentions: Vec::new(),
                attachments: Vec::new(),
                nonce: None,
            },
        )
        .await
        .unwrap();
    assert!(
        sender
            .has_conversation(channel_id, message_id)
            .await
            .unwrap()
    );
}
