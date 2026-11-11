use serde_json::json;

use super::*;

fn session_new() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 7,
        "method": "session/new",
        "params": {
            "cwd": "/home/macro/work",
            "mcpServers": [
                { "type": "http", "name": "github", "url": "https://example.test/mcp", "headers": [] },
                {
                    "type": "http",
                    "name": "macro_internal",
                    "url": "https://dev-gateway.macro.com/agent-harness-egress/mcp/internal",
                    "headers": [{ "name": "Authorization", "value": "Bearer egress-token" }]
                }
            ],
            "_meta": { "claudeCode": { "options": { "env": { "KEEP": "me" } } } }
        }
    })
}

#[test]
fn credits_point_claude_code_at_the_gateway_of_the_sessions_internal_mcp() {
    let mut frame = session_new();
    prepare_session(
        &mut frame,
        false,
        std::path::Path::new("/home/macro/work"),
        None,
    )
    .unwrap();
    assert_eq!(
        frame["params"]["_meta"]["claudeCode"]["options"]["env"],
        json!({
            "KEEP": "me",
            "ANTHROPIC_BASE_URL": "https://dev-gateway.macro.com/agent-harness-egress/anthropic",
            "ANTHROPIC_AUTH_TOKEN": "egress-token",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
        })
    );
}

#[test]
fn a_signed_in_account_replaces_the_gateway() {
    let mut frame = session_new();
    frame["method"] = json!("session/resume");
    frame["params"].as_object_mut().unwrap().remove("_meta");
    prepare_session(
        &mut frame,
        true,
        std::path::Path::new("/home/macro/work"),
        None,
    )
    .unwrap();
    assert_eq!(
        frame["params"]["_meta"],
        json!({ "claudeCode": { "options": { "env": {} } } })
    );
}

#[test]
fn only_session_starts_are_touched() {
    let mut prompt = json!({
        "jsonrpc": "2.0",
        "id": 8,
        "method": "session/prompt",
        "params": { "sessionId": "s", "prompt": [] }
    });
    let before = prompt.clone();
    prepare_session(
        &mut prompt,
        true,
        std::path::Path::new("/home/macro/work"),
        None,
    )
    .unwrap();
    assert_eq!(prompt, before);

    // Without the internal MCP server there is no gateway to point at.
    let mut bare = json!({
        "jsonrpc": "2.0",
        "id": 9,
        "method": "session/load",
        "params": { "sessionId": "s", "cwd": "/", "mcpServers": [] }
    });
    let before = bare.clone();
    assert!(
        prepare_session(
            &mut bare,
            false,
            std::path::Path::new("/home/macro/work"),
            None
        )
        .is_err()
    );
    assert_eq!(bare, before);
}

#[test]
fn each_attach_refreshes_credentials_and_switches_modes_without_old_env() {
    let mut frame = session_new();
    prepare_session(
        &mut frame,
        false,
        std::path::Path::new("/home/macro/work"),
        None,
    )
    .unwrap();
    prepare_session(
        &mut frame,
        true,
        std::path::Path::new("/home/macro/work"),
        None,
    )
    .unwrap();
    let env = &frame["params"]["_meta"]["claudeCode"]["options"]["env"];
    assert!(env.get("ANTHROPIC_AUTH_TOKEN").is_none());
    assert!(env.get("ANTHROPIC_BASE_URL").is_none());

    frame["method"] = json!("session/load");
    frame["params"]["mcpServers"][1]["headers"][0]["value"] = json!("Bearer fresh-token");
    prepare_session(
        &mut frame,
        false,
        std::path::Path::new("/home/macro/work"),
        None,
    )
    .unwrap();
    let env = &frame["params"]["_meta"]["claudeCode"]["options"]["env"];
    assert_eq!(env["ANTHROPIC_AUTH_TOKEN"], "fresh-token");
    assert!(env.get("CLAUDE_CODE_OAUTH_TOKEN").is_none());
}

#[test]
fn computer_sessions_use_the_guest_workspace_and_egress_route() {
    for method in SESSION_METHODS {
        let mut frame = session_new();
        frame["method"] = json!(method);
        frame["params"]["cwd"] = json!("/workspace");
        frame["params"]["mcpServers"].as_array_mut().unwrap().push(json!({
            "type": "http", "name": "macro-preview", "url": "https://dev-gateway.macro.com/agent-harness-egress/mcp-preview", "headers": []
        }));
        prepare_session(
            &mut frame,
            false,
            std::path::Path::new("/home/macro/work"),
            Some("http://10.210.0.1:41027/"),
        )
        .unwrap();
        assert_eq!(frame["params"]["cwd"], "/home/macro/work");
        assert_eq!(
            frame["params"]["mcpServers"][0]["url"],
            "https://example.test/mcp"
        );
        assert_eq!(
            frame["params"]["mcpServers"][1]["url"],
            "http://10.210.0.1:41027/mcp/internal"
        );
        assert_eq!(
            frame["params"]["mcpServers"][2]["url"],
            "http://10.210.0.1:41027/mcp-preview"
        );
        assert_eq!(
            frame["params"]["_meta"]["claudeCode"]["options"]["env"]["ANTHROPIC_BASE_URL"],
            "http://10.210.0.1:41027/anthropic"
        );
        assert_eq!(
            frame["params"]["_meta"]["claudeCode"]["options"]["env"]["ANTHROPIC_AUTH_TOKEN"],
            "egress-token"
        );
    }
    let mut explicit = session_new();
    prepare_session(
        &mut explicit,
        false,
        std::path::Path::new("/home/macro/other"),
        None,
    )
    .unwrap();
    assert_eq!(explicit["params"]["cwd"], "/home/macro/work");
}

#[cfg(unix)]
mod sign_in_screens {
    use super::super::claude_sign_in::{Screen, pasted_code, sign_in_url};

    // Claude Code 2.1.280 in a 53-column herdr pane, as `herdr pane read`
    // returns it.
    const THEME: &str = " Let's get started.\n\n Choose the text style that looks best with your\n terminal\n To change this later, run /theme\n\n   1. Auto (match terminal)\n ❯ 2. Dark mode ✔\n   3. Light mode\n";
    const METHOD: &str = "Welcome to Claude Code v2.1.280\n\n Select login method:\n\n ❯ 1. Claude account with subscription · Pro, Max,\n      Team, or Enterprise\n   2. Anthropic Console account · API usage billing\n";
    const URL_SCREEN: &str = "Welcome to Claude Code v2.1.280\n\n Browser didn't open? Use the url below to  (c to\n sign in                                    copy)\n\nhttps://claude.com/cai/oauth/authorize?code=true&clie\nnt_id=9d1c250a&response_t\nype=code&state=xS07\n\n\n Paste code here if prompted >\n";
    const OAUTH_ERROR: &str = "Welcome to Claude Code v2.1.280\n\n OAuth error: Request failed with status code 400\n\n\n Press Enter to retry.\n";
    // Claude Code 2.1.319's wording for a rejected code.
    const CODE_REJECTED: &str = " That code wasn't accepted. It may be incomplete, expired, already\n used, or from an earlier sign-in attempt. Sign in again to get a new\n code.\n";
    const TRUST: &str = " Accessing workspace:\n\n /home/macro\n\n ❯ No, exit\n   Yes, I trust this folder\n\n Enter to confirm · Esc to cancel\n";
    const PROMPT: &str = " ▐▛███▛█   Claude Code v2.1.280\n\n─────────\n❯ Try \"write a test for <filepath>\"\n─────────\n";

    #[test]
    fn each_login_screen_is_recognised() {
        assert_eq!(Screen::read(THEME), Screen::ThemePicker);
        assert_eq!(
            Screen::read(METHOD),
            Screen::LoginMethod {
                subscription_selected: true
            }
        );
        assert_eq!(
            Screen::read(&METHOD.replace(" ❯ 1.", "   1.").replace("   2.", " ❯ 2.")),
            Screen::LoginMethod {
                subscription_selected: false
            }
        );
        assert_eq!(
            Screen::read(URL_SCREEN),
            Screen::AwaitingCode {
                url: "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&response_type=code&state=xS07".to_owned()
            }
        );
        assert_eq!(Screen::read(OAUTH_ERROR), Screen::OAuthError);
        assert_eq!(Screen::read(CODE_REJECTED), Screen::OAuthError);
        assert_eq!(Screen::read(TRUST), Screen::TrustFolder);
        assert_eq!(Screen::read(PROMPT), Screen::Prompt);
        assert_eq!(Screen::read(""), Screen::Unknown);
    }

    #[test]
    fn the_wrapped_url_stops_at_the_blank_line() {
        assert_eq!(sign_in_url("no url here"), None);
        assert_eq!(sign_in_url("https://example.test/elsewhere\n"), None);
        assert!(sign_in_url(URL_SCREEN).unwrap().ends_with("&state=xS07"));
    }

    #[test]
    fn pasted_codes_are_one_token() {
        assert_eq!(pasted_code("  abc#def \n").unwrap(), "abc#def");
        assert!(pasted_code("").is_err());
        assert!(pasted_code("two words").is_err());
        assert!(pasted_code("bell\u{7}").is_err());
        assert!(pasted_code(&"x".repeat(513)).is_err());
    }
}

mod claude_status {
    use harnesses::domain::models::ClaudeAccount;

    use super::super::claude_auth::parse_status;

    #[test]
    fn only_a_claude_account_login_counts_as_signed_in() {
        let status = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"team@example.com","loginExpiresAt":"2027-02-01T00:00:00.000Z","orgName":"Acme","subscriptionType":"max"}"#;
        let signed_in = parse_status(
            status,
            Some(r#"{"oauthAccount":{"accountUuid":"8f3c1b2a-0000-4000-8000-000000000001","emailAddress":"team@example.com"}}"#),
        )
        .unwrap();
        assert_eq!(
            signed_in.0,
            ClaudeAccount::SignedIn {
                account_id: "8f3c1b2a-0000-4000-8000-000000000001".to_owned(),
                account: Some("team@example.com".to_owned()),
                organization: Some("Acme".to_owned()),
                plan: Some("max".to_owned()),
                expires_at: Some("2027-02-01T00:00:00Z".parse().unwrap()),
            }
        );
        assert_eq!(signed_in.account().as_deref(), Some("team@example.com"));
        // Accounts are keyed by their id, so a login without one is refused.
        assert!(parse_status(status, None).is_err());
        assert!(parse_status(status, Some("{}")).is_err());

        let signed_out = parse_status(r#"{"loggedIn":false,"authMethod":"none"}"#, None).unwrap();
        assert_eq!(signed_out.0, ClaudeAccount::SignedOut);
        let api_key = parse_status(r#"{"loggedIn":true,"authMethod":"api_key"}"#, None).unwrap();
        assert!(!api_key.is_signed_in());
        assert!(parse_status("not json", None).is_err());
    }
}
