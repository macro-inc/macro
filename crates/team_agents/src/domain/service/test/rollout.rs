use super::*;

#[tokio::test]
async fn every_admin_operation_is_closed_without_flags_and_agent_self_service_remains_open() {
    let (service, journal) = build(Setup {
        flags: None,
        ..Setup::default()
    });
    assert!(matches!(
        service.sizes(receipt(TEAM_ID)).await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert!(matches!(
        service
            .quote(receipt(TEAM_ID), ComputerSize::Standard)
            .await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert!(matches!(
        service.create(receipt(TEAM_ID), request()).await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert!(matches!(
        service.list(receipt(TEAM_ID)).await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert!(matches!(
        service.retry(receipt(TEAM_ID), &user(AGENT)).await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert!(matches!(
        service.delete(receipt(TEAM_ID), &user(AGENT)).await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert!(matches!(
        service.voice(receipt(TEAM_ID), &user(AGENT)).await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert!(matches!(
        service
            .set_voice(
                receipt(TEAM_ID),
                &user(AGENT),
                crate::domain::voice::AgentVoice {
                    model: "aura-2-arcas-en".to_owned(),
                }
            )
            .await,
        Err(TeamAgentError::NotEnabled)
    ));
    assert_eq!(journal.steps(), Vec::<&str>::new());

    // Missing self accounts retain their ordinary domain result, not a rollout denial.
    assert!(matches!(
        service.me(&user(AGENT)).await,
        Err(TeamAgentError::NotAnAgent)
    ));
    assert!(matches!(
        service.list_email(&user(AGENT), 10).await,
        Err(TeamAgentError::NotAnAgent)
    ));
}

struct CountingFlags {
    calls: Arc<Mutex<Vec<MacroUserIdStr<'static>>>>,
}

impl FeatureFlags for CountingFlags {
    async fn load(&self, caller: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, rootcause::Report> {
        self.calls
            .lock()
            .expect("lock")
            .push(caller.clone().into_owned());
        Ok(FlagSnapshot::new([(
            TEAM_AGENTS_FLAG.to_owned(),
            FlagValue::Boolean(true),
        )]))
    }
}

#[tokio::test]
async fn each_admin_operation_loads_once_and_self_operations_load_no_flags() {
    let (base, _) = build(Setup::default());
    let calls = Arc::new(Mutex::new(vec![]));
    let service = TeamAgentServiceImpl::new(
        base.repository,
        base.membership,
        base.api_keys,
        base.mailboxes,
        base.computers,
        base.repos,
        Some(CountingFlags {
            calls: calls.clone(),
        }),
        base.gateway_url,
        base.anthropic_base_url,
        base.included_email_domain,
    );
    service.sizes(receipt(TEAM_ID)).await.expect("sizes");
    assert_eq!(calls.lock().expect("lock").len(), 1);
    service
        .quote(receipt(TEAM_ID), ComputerSize::Standard)
        .await
        .expect("quote");
    assert_eq!(calls.lock().expect("lock").len(), 2);
    let agent = service
        .create(receipt(TEAM_ID), request())
        .await
        .expect("create");
    assert_eq!(calls.lock().expect("lock").len(), 3);
    service.list(receipt(TEAM_ID)).await.expect("list");
    assert_eq!(calls.lock().expect("lock").len(), 4);
    assert!(matches!(
        service.retry(receipt(TEAM_ID), &agent.user_id).await,
        Err(TeamAgentError::RetryUnavailable(_))
    ));
    assert_eq!(calls.lock().expect("lock").len(), 5);
    assert!(matches!(
        service.delete(receipt(TEAM_ID), &agent.user_id).await,
        Err(TeamAgentError::RetryUnavailable(_))
    ));
    assert_eq!(*calls.lock().expect("lock"), vec![user(ADMIN); 6]);

    service.me(&agent.user_id).await.expect("self profile");
    service
        .list_email(&agent.user_id, 10)
        .await
        .expect("self mail");
    assert!(matches!(
        service
            .get_email(
                &agent.user_id,
                &MailMessageId::parse("message-1".to_owned()).expect("message")
            )
            .await,
        Err(TeamAgentError::EmailUnavailable)
    ));
    service
        .send_email(
            &agent.user_id,
            SendEmail {
                to: vec!["user@example.com".to_owned()],
                subject: "Test".to_owned(),
                text: "Hello".to_owned(),
                html: None,
            },
        )
        .await
        .expect("send mail");
    assert_eq!(calls.lock().expect("lock").len(), 6);
}
