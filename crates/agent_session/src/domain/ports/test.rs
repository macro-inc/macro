use super::{BotDirectory, BotFacts, ManagedPersonaError, managed_persona_for_user};
use bots::domain::models::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

const OWNER: &str = "macro|owner@example.com";
const TEAMMATE: &str = "macro|teammate@example.com";
const STRANGER: &str = "macro|stranger@example.com";

struct Directory {
    facts: BotFacts,
    team_members: Vec<&'static str>,
    channel_members: Vec<&'static str>,
}

impl Directory {
    fn managed_private() -> Self {
        Self {
            facts: managed_facts(false),
            team_members: Vec::new(),
            channel_members: Vec::new(),
        }
    }

    fn managed_selected_channel() -> Self {
        Self {
            facts: managed_facts(true),
            team_members: Vec::new(),
            channel_members: vec![OWNER, TEAMMATE],
        }
    }

    fn managed_team() -> Self {
        let mut facts = managed_facts(false);
        facts.owner_user_id = None;
        facts.owner_team_id = Some(Uuid::nil());
        Self {
            facts,
            team_members: vec![OWNER, TEAMMATE],
            channel_members: Vec::new(),
        }
    }

    fn managed_team_selected_channel() -> Self {
        let mut facts = managed_facts(true);
        facts.owner_user_id = None;
        facts.owner_team_id = Some(Uuid::nil());
        Self {
            facts,
            team_members: vec![OWNER],
            channel_members: vec![OWNER, TEAMMATE],
        }
    }
}

fn managed_facts(selected_channels: bool) -> BotFacts {
    BotFacts {
        has_agent: true,
        is_managed: true,
        is_system: false,
        owner_user_id: Some(MacroUserIdStr::try_from(OWNER.to_owned()).unwrap()),
        owner_team_id: None,
        harness_id: None,
        managed_profile: Some(super::ManagedAgentProfile {
            model: "persona-model".to_owned(),
            harness: "in-memory".to_owned(),
            instructions: "persona instructions".to_owned(),
            mcp_servers: Default::default(),
        }),
        selected_channels,
    }
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).unwrap()
}

impl BotDirectory for Directory {
    async fn bot_facts(&self, bot: BotId) -> super::Result<Option<BotFacts>> {
        Ok((bot == BotId::TEST_A).then(|| self.facts.clone()))
    }

    async fn user_has_team(
        &self,
        user: MacroUserIdStr<'static>,
        _team_id: Uuid,
    ) -> super::Result<bool> {
        Ok(self.team_members.contains(&user.as_ref()))
    }

    async fn user_shares_channel_with_bot(
        &self,
        user: MacroUserIdStr<'static>,
        _bot_id: BotId,
    ) -> super::Result<bool> {
        Ok(self.channel_members.contains(&user.as_ref()))
    }
}

#[tokio::test]
async fn owner_can_select_a_private_persona() {
    let selected =
        managed_persona_for_user(&Directory::managed_private(), BotId::TEST_A, &user(OWNER))
            .await
            .expect("owner");
    assert_eq!(selected.bot_id, BotId::TEST_A);
}

#[tokio::test]
async fn stranger_cannot_select_a_private_all_channel_persona() {
    let error = managed_persona_for_user(
        &Directory::managed_private(),
        BotId::TEST_A,
        &user(STRANGER),
    )
    .await
    .expect_err("private all-channel personas stay with their owner");
    assert!(matches!(error, ManagedPersonaError::Forbidden));
}

#[tokio::test]
async fn channel_co_member_can_select_a_selected_channel_persona() {
    let selected = managed_persona_for_user(
        &Directory::managed_selected_channel(),
        BotId::TEST_A,
        &user(TEAMMATE),
    )
    .await
    .expect("channel co-member");
    assert_eq!(selected.bot_id, BotId::TEST_A);
}

#[tokio::test]
async fn stranger_cannot_select_a_selected_channel_persona_without_membership() {
    let error = managed_persona_for_user(
        &Directory::managed_selected_channel(),
        BotId::TEST_A,
        &user(STRANGER),
    )
    .await
    .expect_err("no shared channel");
    assert!(matches!(error, ManagedPersonaError::Forbidden));
}

#[tokio::test]
async fn team_member_can_select_a_team_persona() {
    let selected =
        managed_persona_for_user(&Directory::managed_team(), BotId::TEST_A, &user(TEAMMATE))
            .await
            .expect("team member");
    assert_eq!(selected.bot_id, BotId::TEST_A);
}

#[tokio::test]
async fn stranger_cannot_select_a_team_all_channel_persona() {
    let error =
        managed_persona_for_user(&Directory::managed_team(), BotId::TEST_A, &user(STRANGER))
            .await
            .expect_err("all-channel team personas stay with the team");
    assert!(matches!(error, ManagedPersonaError::Forbidden));
}

#[tokio::test]
async fn channel_co_member_can_select_a_team_selected_channel_persona() {
    let selected = managed_persona_for_user(
        &Directory::managed_team_selected_channel(),
        BotId::TEST_A,
        &user(TEAMMATE),
    )
    .await
    .expect("channel co-member");
    assert_eq!(selected.bot_id, BotId::TEST_A);
}
