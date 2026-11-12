use super::*;
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};

const USER: &str = "macro|mentioner@example.com";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(USER.to_string()).unwrap()
}

fn mention() -> BotMention {
    BotMention {
        message_id: uuid::Uuid::from_u128(1),
        root_id: uuid::Uuid::from_u128(2),
    }
}

fn flags(result: Result<FlagSnapshot, String>) -> FlaggedCodeMode<FakeFeatureFlags> {
    let mut flags = FakeFeatureFlags::default();
    flags.set(user(), result);
    FlaggedCodeMode(flags)
}

fn snapshot(value: FlagValue) -> FlagSnapshot {
    FlagSnapshot::new([(CODE_MODE_FLAG.to_string(), value)])
}

#[tokio::test]
async fn the_flag_fails_closed() {
    assert!(
        !flags(Err("PostHog unreachable".into()))
            .enabled(&user())
            .await
    );
    assert!(!flags(Ok(FlagSnapshot::default())).enabled(&user()).await);
    assert!(
        !flags(Ok(snapshot(FlagValue::Boolean(false))))
            .enabled(&user())
            .await
    );
    // A user with no configured result is an error too.
    assert!(
        !FlaggedCodeMode(FakeFeatureFlags::default())
            .enabled(&user())
            .await
    );
}

#[tokio::test]
async fn the_flag_on_enables_code_mode() {
    assert!(
        flags(Ok(snapshot(FlagValue::Boolean(true))))
            .enabled(&user())
            .await
    );
    assert!(
        flags(Ok(snapshot(FlagValue::Variant("test".into()))))
            .enabled(&user())
            .await
    );
}

struct Fixed(bool);

#[async_trait]
impl CodeModeGate for Fixed {
    async fn enabled(&self, _: &MacroUserIdStr<'static>) -> bool {
        self.0
    }
}

fn modes(gate: Option<bool>) -> ToolModes {
    let modes = ToolModes::direct(ai_tools::tools_for(ai_tools::AiHost::ChannelBot));
    match gate {
        Some(enabled) => modes.with_code_mode(ChannelBotCodeMode {
            tools: ai_tools::tools_for_channel_bot_code_mode(),
            executions: HarnessUserExecutions::new("http://harness.invalid", "key").unwrap(),
            gate: Arc::new(Fixed(enabled)),
        }),
        None => modes,
    }
}

fn names(tools: &ReplyTools) -> Vec<String> {
    tools
        .toolset
        .request_schemas()
        .unwrap_or_default()
        .into_iter()
        .map(|schema| schema.name)
        .collect()
}

#[tokio::test]
async fn direct_tools_without_code_mode_or_with_the_flag_off() {
    for gate in [None, Some(false)] {
        let tools = modes(gate).for_reply(&user(), &mention(), None).await;
        let names = names(&tools);
        assert!(!tools.code_mode);
        assert!(names.iter().any(|name| name == "ReadContent"));
        assert!(names.iter().any(|name| name == "BashCodeExecution"));
        assert!(!names.iter().any(|name| name == "ExecuteCode"));
        assert!(!tools.system_prompt.contains("# Code Mode"));
    }
}

#[tokio::test]
async fn code_tools_with_the_flag_on() {
    let tools = modes(Some(true)).for_reply(&user(), &mention(), None).await;
    let names = names(&tools);
    assert!(tools.code_mode);
    for code in ["ExecuteCode", "DescribeCodeTools", "ReadCodeDocs"] {
        assert!(names.iter().any(|name| name == code), "{code} missing");
    }
    // SDK-covered tools and the Anthropic sandbox are gone; the rest stay.
    for dropped in [
        "ReadContent",
        "BashCodeExecution",
        "TextEditorCodeExecution",
    ] {
        assert!(!names.iter().any(|name| name == dropped), "{dropped} kept");
    }
    assert!(names.iter().any(|name| name == "RenderCanvas"));
    assert!(tools.system_prompt.contains("Code Mode"));
    assert!(!tools.system_prompt.contains("execution.views.present"));
}

#[tokio::test]
async fn programs_refuse_a_caller_other_than_macro_ai() {
    let code_mode = MentionCodeMode {
        executions: HarnessUserExecutions::new("http://harness.invalid", "key").unwrap(),
        mention: MentionContext {
            message_id: uuid::Uuid::from_u128(1),
            root_id: uuid::Uuid::from_u128(2),
        },
    };
    let program = || ExecuteRequest {
        source: "export async function main() { return {data: 1}; }".into(),
        timeout_ms: 1000,
    };
    for (caller, session) in [
        (ToolCaller::ApiKey, None),
        (
            ToolCaller::Agent(bot_id::MACRO_AI_BOT_ID),
            Some(uuid::Uuid::from_u128(3)),
        ),
    ] {
        let error = code_mode
            .execute(
                &user(),
                &caller,
                session,
                program(),
                CancellationToken::new(),
            )
            .await
            .err()
            .unwrap();
        assert!(matches!(error, CodeModeError::Forbidden));
    }
}
