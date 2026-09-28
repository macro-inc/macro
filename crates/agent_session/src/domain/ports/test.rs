use super::{BotDirectory, BotFacts, ManagedPersonaError, SelectedPersona, persona_for_owner};
use bots::domain::models::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_owner::Owner;

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

fn owner(id: &str) -> Owner {
    Owner::User(user(id))
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
    let selected = persona_for_owner(&Directory::managed_private(), BotId::TEST_A, &owner(OWNER))
        .await
        .expect("owner");
    assert_eq!(managed(selected).bot_id, BotId::TEST_A);
}

#[tokio::test]
async fn stranger_cannot_select_a_private_all_channel_persona() {
    let error = persona_for_owner(
        &Directory::managed_private(),
        BotId::TEST_A,
        &owner(STRANGER),
    )
    .await
    .expect_err("private all-channel personas stay with their owner");
    assert!(matches!(error, ManagedPersonaError::Forbidden));
}

#[tokio::test]
async fn channel_co_member_can_select_a_selected_channel_persona() {
    let selected = persona_for_owner(
        &Directory::managed_selected_channel(),
        BotId::TEST_A,
        &owner(TEAMMATE),
    )
    .await
    .expect("channel co-member");
    assert_eq!(managed(selected).bot_id, BotId::TEST_A);
}

#[tokio::test]
async fn stranger_cannot_select_a_selected_channel_persona_without_membership() {
    let error = persona_for_owner(
        &Directory::managed_selected_channel(),
        BotId::TEST_A,
        &owner(STRANGER),
    )
    .await
    .expect_err("no shared channel");
    assert!(matches!(error, ManagedPersonaError::Forbidden));
}

#[tokio::test]
async fn team_member_can_select_a_team_persona() {
    let selected = persona_for_owner(&Directory::managed_team(), BotId::TEST_A, &owner(TEAMMATE))
        .await
        .expect("team member");
    assert_eq!(managed(selected).bot_id, BotId::TEST_A);
}

#[tokio::test]
async fn stranger_cannot_select_a_team_all_channel_persona() {
    let error = persona_for_owner(&Directory::managed_team(), BotId::TEST_A, &owner(STRANGER))
        .await
        .expect_err("all-channel team personas stay with the team");
    assert!(matches!(error, ManagedPersonaError::Forbidden));
}

#[tokio::test]
async fn channel_co_member_can_select_a_team_selected_channel_persona() {
    let selected = persona_for_owner(
        &Directory::managed_team_selected_channel(),
        BotId::TEST_A,
        &owner(TEAMMATE),
    )
    .await
    .expect("channel co-member");
    assert_eq!(managed(selected).bot_id, BotId::TEST_A);
}

#[tokio::test]
async fn an_owner_that_is_not_a_user_selects_no_persona() {
    // Every persona rule is about a person - who owns it, whose team it
    // belongs to, who shares a channel with it - so a bot owner matches none
    // of them, even for a persona anyone could otherwise select.
    let result = persona_for_owner(
        &Directory::managed_private(),
        BotId::TEST_A,
        &Owner::Bot(BotId::TEST_A),
    )
    .await;
    assert!(matches!(result, Err(ManagedPersonaError::Forbidden)));
}

/// The managed persona a selection resolved to, failing the test otherwise.
fn managed(selected: SelectedPersona) -> super::SelectedManagedPersona {
    match selected {
        SelectedPersona::Managed(persona) => persona,
        SelectedPersona::External { .. } => panic!("expected a managed persona"),
    }
}

/// An agent bound to its owner's own macrod, as the composer now starts it.
fn external_facts(selected_channels: bool) -> BotFacts {
    BotFacts {
        is_managed: false,
        ..managed_facts(selected_channels)
    }
}

impl Directory {
    fn external_private() -> Self {
        Self {
            facts: external_facts(false),
            team_members: Vec::new(),
            channel_members: Vec::new(),
        }
    }

    fn external_team() -> Self {
        let mut facts = external_facts(false);
        facts.owner_user_id = None;
        facts.owner_team_id = Some(Uuid::nil());
        Self {
            facts,
            team_members: vec![OWNER, TEAMMATE],
            channel_members: Vec::new(),
        }
    }
}

/// An externally run persona is authorized by the same ownership rules as a
/// managed one, and only then told apart, so the caller can hand it to the
/// runtime its operator runs.
#[tokio::test]
async fn owner_selects_their_external_persona_as_external() {
    let selected = persona_for_owner(&Directory::external_private(), BotId::TEST_A, &owner(OWNER))
        .await
        .expect("owner");
    assert!(matches!(
        selected,
        SelectedPersona::External {
            bot_id: BotId::TEST_A
        }
    ));
}

#[tokio::test]
async fn team_member_selects_a_team_external_persona() {
    let selected = persona_for_owner(&Directory::external_team(), BotId::TEST_A, &owner(TEAMMATE))
        .await
        .expect("team member");
    assert!(matches!(selected, SelectedPersona::External { .. }));
}

#[tokio::test]
async fn stranger_cannot_select_someone_elses_external_persona() {
    let error = persona_for_owner(
        &Directory::external_private(),
        BotId::TEST_A,
        &owner(STRANGER),
    )
    .await
    .expect_err("external personas stay with their owner");
    assert!(matches!(error, ManagedPersonaError::Forbidden));
}

/// A first-party bot this deployment does not run has no operator to ask and
/// no owner to authorize against: the state should not exist, and is refused
/// rather than published to a topic nothing serves.
#[tokio::test]
async fn an_unmanaged_system_bot_selects_nothing() {
    let mut facts = external_facts(false);
    facts.is_system = true;
    let directory = Directory {
        facts,
        team_members: Vec::new(),
        channel_members: Vec::new(),
    };
    let error = persona_for_owner(&directory, BotId::TEST_A, &owner(OWNER))
        .await
        .expect_err("a system bot this deployment does not run is misconfigured");
    assert!(matches!(error, ManagedPersonaError::UnmanagedSystemBot));
}
