use super::*;

#[tokio::test]
async fn non_coding_agent_mentions_dispatch_when_the_agent_flag_is_enabled() {
    for enabled in [false, true] {
        let posted = message(vec![mention_of(BotId::TEST_A)]);
        let mut bots = MockAgentBotLookup::new();
        bots.expect_get_agent().once().return_once(move |bot_id| {
            Box::pin(async move {
                let mut agent = private_agent(bot_id);
                agent.bot.has_agent = enabled;
                agent.is_coding = false;
                Ok(Some(agent))
            })
        });

        assert_eq!(mention_yields_event(&posted, bots).await, enabled);
    }
}
