use super::*;

#[test]
fn an_upstream_failure_is_an_unreachable_connected_app() {
    let error = egress_error(EgressError::Upstream(rootcause::report!(
        "Transport channel closed"
    )));

    assert!(matches!(error, CodeModeError::ConnectedAppUnreachable));
}

#[test]
fn an_upstream_rate_limit_is_a_rate_limited_connected_app() {
    let error = egress_error(EgressError::RateLimited {
        retry_after: Some(std::time::Duration::from_secs(1)),
    });

    assert!(matches!(
        error,
        CodeModeError::ConnectedAppRateLimited {
            retry_after: Some(_)
        }
    ));
}

fn grant() -> SessionGrant {
    SessionGrant {
        session: AgentSessionId::new(),
        owner: MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
        agent: bot_id::BotId::TEST_A,
        repo: None,
        mcp_servers: Vec::new(),
        prompter: None,
    }
}

#[test]
fn a_listing_refused_for_an_expired_grant_tells_the_program_to_offer_reconnect() {
    let stripe = McpDestination::Connected(McpServerSlug::parse("stripe").unwrap());

    let error = listing_error(&grant(), &stripe, EgressError::NeedsReconnect);

    let CodeModeError::ConnectedAppNeedsReconnect(message) = error else {
        panic!("expected a reconnect, got {error:?}");
    };
    assert!(
        message.contains(
            r#"<m-connect-app>{"appSlug":"stripe","name":"Stripe","reconnect":true}</m-connect-app>"#
        ),
        "{message}"
    );
    assert!(
        message.starts_with("The session owner's connection"),
        "{message}"
    );
}

#[test]
fn a_custom_server_refusing_its_listing_with_409_is_unreachable() {
    let custom = McpDestination::Custom(
        CustomMcpServerKey::parse("0123456789abcdef0123456789abcdef").unwrap(),
    );

    let error = listing_error(&grant(), &custom, EgressError::NeedsReconnect);

    assert!(matches!(error, CodeModeError::ConnectedAppUnreachable));
}
