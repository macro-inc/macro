use super::*;

/// Programs never reach it: these tests stop before any program runs.
struct NeverRuns;

#[async_trait]
impl MentionCodeMode for NeverRuns {
    async fn execute(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &MentionContext,
        _: ExecuteRequest,
        _: CancellationToken,
    ) -> Result<UserExecutionReceipt, CodeModeError> {
        panic!("no program should run in this test");
    }
}

fn mention() -> BotMention {
    BotMention {
        message_id: uuid::Uuid::from_u128(1),
        root_id: uuid::Uuid::from_u128(2),
    }
}

#[test]
fn replies_get_the_code_tools_and_only_the_direct_tools_code_mode_keeps() {
    let tools = ChannelBotTools::new(Arc::new(NeverRuns));
    let names: Vec<String> = tools
        .for_mention(&mention(), None)
        .request_schemas()
        .unwrap_or_default()
        .into_iter()
        .map(|schema| schema.name)
        .collect();
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
    assert!(tools.system_prompt().contains("Code Mode"));
    // Replies cannot present views, so the bot is never told to.
    assert!(
        !tools
            .system_prompt()
            .contains("present them with `execution.views.present`")
    );
    // A routine's token carries no channel mention, so replies never schedule one.
    assert!(!tools.system_prompt().contains("macro.routines.create"));
}

#[test]
fn replies_are_told_never_to_show_how_the_bot_works() {
    // The channel shows only the reply text, so the prompt is what keeps code,
    // the SDK and tool names out of it.
    let prompt = ChannelBotTools::new(Arc::new(NeverRuns))
        .system_prompt()
        .to_owned();
    assert!(prompt.contains(
        "never mention code, programs, scripts, the SDK, requests, `ExecuteCode` or other \
         tool names, and never show the code you ran"
    ));
}

fn code_mode_tools() -> CodeModeTools {
    CodeModeTools {
        direct: ai_tools::tools_for_channel_bot_code_mode().toolset,
        code: Arc::new(agent_code_mode::inbound::toolset::user_toolset()),
        context: UserCodeModeToolContext {
            service: Arc::new(MentionPrograms {
                executions: Arc::new(NeverRuns),
                mention: MentionContext {
                    message_id: uuid::Uuid::from_u128(1),
                    root_id: uuid::Uuid::from_u128(2),
                },
            }),
            cognition: None,
            caller: ToolCaller::Agent(bot_id::MACRO_AI_BOT_ID),
            session: None,
        },
    }
}

#[test]
fn a_hidden_native_tool_is_refused_not_dispatched() {
    let tools = code_mode_tools();
    assert_eq!(tools.route("ExecuteCode"), Route::Code);
    assert_eq!(tools.route("RenderCanvas"), Route::Direct);
    for hidden in [
        "ReadContent",
        "SendChannelMessage",
        "BashCodeExecution",
        "NoSuchTool",
    ] {
        assert_eq!(tools.route(hidden), Route::Refused, "{hidden}");
    }
    let refusal = hidden_tool_refusal("ReadContent");
    assert!(
        refusal
            .description
            .contains("ReadContent is not available here")
    );
    assert!(refusal.description.contains("ExecuteCode"));
}
