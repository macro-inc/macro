//! Scope and replay rules for the loopback review, outside the product API.

use std::{collections::HashMap, fs, io, io::Write, path::PathBuf};

use chrono::{DateTime, Duration, Utc};
use entity_access::domain::models::{
    AdminTeamRole, EntityAccessReceipt, EntityType, MemberTeamRole, RequiredPermission,
};
use hosted_runtimes::{
    domain::{
        agent::ComputerAgents,
        lifecycle::{Billing as BillingState, Phase},
        ports::ComputerRepo,
        size::{ComputerSize, current_catalog},
    },
    outbound::pg::PgComputerRepo,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use team_agents::{
    domain::{
        models::{CreateTeamAgent, TeamAgent, TeamAgentError, TeamAgentStatus},
        ports::{AgentAccounts, TeamAgentRepository, TeamAgentService, TeamMembership},
    },
    outbound::pg_team_agents_repo::PgTeamAgentsRepo,
};
use teams::{
    domain::{model::TeamRole, team_repo::TeamRepository},
    outbound::team_repo::TeamRepositoryImpl,
};
use uuid::Uuid;

pub struct IncludedMembership(pub TeamRepositoryImpl);

impl IncludedMembership {
    async fn remove(&self, team: Uuid, agent: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        self.0
            .remove_user_from_team(&team, agent)
            .await
            .map(|_| ())
            .map_err(TeamAgentError::internal)
    }
}

impl TeamMembership for IncludedMembership {
    async fn add_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        let team = receipt
            .entity()
            .entity_id
            .parse()
            .map_err(TeamAgentError::internal)?;
        // Use the team's real included-seat transaction. The local review
        // deliberately lacks the channel, notification and provider ports.
        self.0
            .add_user_to_team(&team, agent, true)
            .await
            .map_err(TeamAgentError::internal)?
            .ok_or_else(|| TeamAgentError::internal(io::Error::other("member already exists")))?;
        Ok(())
    }

    async fn undo_add_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        let team = receipt
            .entity()
            .entity_id
            .parse()
            .map_err(TeamAgentError::internal)?;
        self.remove(team, agent).await
    }

    async fn remove_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        self.undo_add_agent(receipt, agent).await
    }

    async fn take_back_agent(
        &self,
        team: Uuid,
        agent: &MacroUserIdStr<'_>,
        _: MacroUserIdStr<'static>,
    ) -> Result<(), TeamAgentError> {
        self.remove(team, agent).await
    }
}

// The signed Vite bridge adds actor and team on its side. The browser only
// supplies the operation inputs. There is no TCP listener for this process.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewRequest {
    actor: String,
    team: Uuid,
    command: Command,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Command {
    Offers,
    Confirm {
        offer_id: Uuid,
        key: Uuid,
        name: String,
        size: ComputerSize,
    },
    Roster,
}

impl ReviewRequest {
    pub fn is_purchase(&self) -> bool {
        matches!(self.command, Command::Offers | Command::Confirm { .. })
    }
}

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
struct Intent {
    offer: Uuid,
    name: String,
    size: ComputerSize,
}

#[derive(Deserialize, Serialize)]
struct Receipt {
    actor: MacroUserIdStr<'static>,
    team: Uuid,
    intent: Intent,
    result: Value,
}

struct Offer {
    size: ComputerSize,
    expires_at: DateTime<Utc>,
    claimed: bool,
}

pub struct Review {
    teams: TeamRepositoryImpl,
    accounts: PgTeamAgentsRepo,
    actor: MacroUserIdStr<'static>,
    team: Uuid,
    offers: HashMap<Uuid, Offer>,
    journal: PathBuf,
}

impl Review {
    pub fn new(
        teams: TeamRepositoryImpl,
        accounts: PgTeamAgentsRepo,
        actor: MacroUserIdStr<'static>,
        team: Uuid,
        journal: PathBuf,
    ) -> Self {
        Self {
            teams,
            accounts,
            actor,
            team,
            offers: HashMap::new(),
            journal,
        }
    }

    pub async fn verify_seed(&self) -> Result<(), io::Error> {
        if self.is_admin().await.unwrap_or(false) {
            Ok(())
        } else {
            Err(io::Error::other("missing seeded review authority"))
        }
    }

    async fn is_admin(&self) -> Result<bool, teams::domain::model::TeamError> {
        let teams = self.teams.get_user_teams(&self.actor).await?;
        if teams.len() != 1
            || teams[0].id() != &self.team
            || self.teams.get_team_payment_status(&self.team).await?
            || self
                .teams
                .get_team_subscription_id(&self.team)
                .await?
                .is_some()
        {
            return Ok(false);
        }
        Ok(self
            .teams
            .get_all_team_members(&self.team)
            .await?
            .iter()
            .any(|member| {
                member.user_id == self.actor
                    && matches!(member.role, TeamRole::Admin | TeamRole::Owner)
            }))
    }

    fn receipt<T: RequiredPermission>(&self) -> EntityAccessReceipt<T> {
        // All calls first verify the sole current team and the stored role.
        EntityAccessReceipt::dangerously_assert_authenticated_user(
            self.actor.clone(),
            &self.team.to_string(),
            EntityType::Team,
        )
    }

    pub async fn handle(
        &mut self,
        agents: &impl TeamAgentService,
        computers: &PgComputerRepo,
        request: ReviewRequest,
    ) -> Value {
        if request.actor != self.actor.as_ref() || request.team != self.team {
            return json!({"status":"denied"});
        }
        match self.is_admin().await {
            Ok(true) => {}
            Ok(false) => return json!({"status":"denied"}),
            Err(_) => return json!({"status":"unavailable"}),
        }

        match request.command {
            Command::Offers => self.offers(computers).await,
            Command::Confirm {
                offer_id,
                key,
                name,
                size,
            } => {
                self.confirm(
                    agents,
                    computers,
                    key,
                    Intent {
                        offer: offer_id,
                        name: name.trim().to_owned(),
                        size,
                    },
                )
                .await
            }
            Command::Roster => self.roster(agents, computers).await,
        }
    }

    async fn roster(&self, agents: &impl TeamAgentService, computers: &PgComputerRepo) -> Value {
        let Ok(roster) = agents.list(self.receipt::<MemberTeamRole>()).await else {
            return json!({"status":"unavailable"});
        };
        let mut items = Vec::new();
        for agent in roster.agents {
            match self.persisted_agent(computers, &agent, None).await {
                Ok(Some(item)) => items.push(item),
                Ok(None) => {}
                Err(()) => return json!({"status":"unavailable"}),
            }
        }
        json!({"status":"available","teamId":self.team,"agents":items})
    }

    async fn persisted_agent(
        &self,
        computers: &PgComputerRepo,
        agent: &TeamAgent,
        size: Option<ComputerSize>,
    ) -> Result<Option<Value>, ()> {
        let facts = self
            .accounts
            .account_facts(&agent.user_id)
            .await
            .map_err(|_| ())?;
        if agent.team_id != self.team
            || !facts
                .is_some_and(|facts| facts.team_id == self.team && facts.is_agent && facts.member)
        {
            return Ok(None);
        }
        let Some(key) = self
            .accounts
            .opaque_key_for_account(&agent.user_id)
            .await
            .map_err(|_| ())?
        else {
            return Ok(None);
        };

        // An account remains addressable while its computer is changing;
        // confirmation itself still requires the exact persisted assignment.
        let mut item =
            json!({"id":key,"teamId":self.team,"name":agent.name,"status":"unavailable"});
        let Some(id) = agent.computer_id else {
            return Ok(size.is_none().then_some(item));
        };
        let Some(computer) = computers.get(id).await.map_err(|_| ())? else {
            return Ok(size.is_none().then_some(item));
        };
        let computer = computer.into_healthy().map_err(|_| ())?;
        let owner = computers.agent_of(id).await.map_err(|_| ())?;
        if computer.team_id != self.team
            || owner.as_ref() != Some(&agent.user_id)
            || size.is_some_and(|size| computer.size != size)
            || !matches!(computer.state.billing, BillingState::Comped { .. })
        {
            return Ok(size.is_none().then_some(item));
        }
        let phase = serde_json::to_value(&computer.state.phase).map_err(|_| ())?;
        let status = if agent.status == TeamAgentStatus::Running
            && (computer.state.phase != Phase::Running
                || !computer.state.macrod_connected
                || computer.state.awaiting_agent
                || !self
                    .accounts
                    .get(&agent.user_id)
                    .await
                    .map_err(|_| ())?
                    .is_some_and(|record| record.first_online_at.is_some()))
        {
            TeamAgentStatus::Starting
        } else {
            agent.status
        };
        item["status"] = json!(status);
        item["computerId"] = json!(id);
        item["size"] = json!(computer.size);
        item["phase"] = phase["phase"].clone();
        Ok(Some(item))
    }

    async fn offers(&mut self, computers: &PgComputerRepo) -> Value {
        let Ok(hosts) = computers.allocation().await else {
            return json!({"status":"unavailable"});
        };
        let now = Utc::now();
        self.offers
            .retain(|_, offer| !offer.claimed && offer.expires_at > now);
        if self.offers.len() >= 96 {
            return json!({"status":"unavailable"});
        }
        let expires_at = now + Duration::minutes(2);
        let offers: Vec<_> = current_catalog()
            .into_iter()
            .filter(|entry| hosts.iter().any(|host| host.sells(entry.resources.units())))
            .map(|entry| {
                let id = Uuid::now_v7();
                self.offers.insert(
                    id,
                    Offer {
                        size: entry.size,
                        expires_at,
                        claimed: false,
                    },
                );
                json!({
                    "id":id,"size":entry.size,"expiresAt":expires_at,
                    "vcpus":entry.resources.vcpus.get(),"memoryGb":entry.resources.memory_gib.get(),
                    "diskGb":entry.resources.disk_gib.get(),
                    "dueToday":0,"funding":"local_no_charge",
                })
            })
            .collect();
        json!({"status":"available","offers":offers})
    }

    async fn confirm(
        &mut self,
        agents: &impl TeamAgentService,
        computers: &PgComputerRepo,
        key: Uuid,
        intent: Intent,
    ) -> Value {
        let receipt_path = self.journal.join(key.to_string());
        match fs::read(&receipt_path) {
            Ok(bytes) => {
                return match serde_json::from_slice::<Receipt>(&bytes) {
                    Ok(receipt)
                        if receipt.actor == self.actor
                            && receipt.team == self.team
                            && receipt.intent == intent =>
                    {
                        if receipt.result.get("status").and_then(Value::as_str) == Some("accepted")
                        {
                            let current = self.roster(agents, computers).await;
                            let id = receipt.result.pointer("/agent/id");
                            if !current.get("agents").and_then(Value::as_array).is_some_and(
                                |agents| agents.iter().any(|agent| agent.get("id") == id),
                            ) {
                                return json!({"status":"unknown"});
                            }
                        }
                        receipt.result
                    }
                    Ok(_) => json!({"status":"conflict"}),
                    Err(_) => json!({"status":"unknown"}),
                };
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return json!({"status":"unavailable"}),
        }

        let Some(offer) = self.offers.get_mut(&intent.offer) else {
            return json!({"status":"stale-offer"});
        };
        if offer.claimed || offer.expires_at <= Utc::now() || offer.size != intent.size {
            return json!({"status":"stale-offer"});
        }
        offer.claimed = true;
        let pending = Receipt {
            actor: self.actor.clone(),
            team: self.team,
            intent: intent.clone(),
            result: json!({"status":"unknown"}),
        };
        let mut claim = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&receipt_path)
        {
            Ok(file) => file,
            Err(_) => return json!({"status":"unknown"}),
        };
        // The claim fences retries even after the local review process exits.
        if write_receipt(&mut claim, &pending).is_err()
            || fs::File::open(&self.journal)
                .and_then(|directory| directory.sync_all())
                .is_err()
        {
            return json!({"status":"unknown"});
        }

        let result = agents
            .create(
                self.receipt::<AdminTeamRole>(),
                CreateTeamAgent {
                    purchase_key: format!("local-hire:{key}"),
                    name: intent.name.clone(),
                    job_description: String::new(),
                    personality: String::new(),
                    size: intent.size,
                    avatar_url: None,
                    voice: None,
                },
            )
            .await;
        let reply = match result {
            Ok(agent) => match self
                .persisted_agent(computers, &agent, Some(intent.size))
                .await
            {
                Ok(Some(agent)) => json!({"status":"accepted","agent":agent}),
                Ok(None) | Err(()) => json!({"status":"unknown"}),
            },
            Err(TeamAgentError::InvalidName) => json!({"status":"invalid-profile"}),
            Err(TeamAgentError::NoRoom(_)) => json!({"status":"no-room"}),
            Err(_) => json!({"status":"unknown"}),
        };
        let terminal = Receipt {
            actor: self.actor.clone(),
            team: self.team,
            intent,
            result: reply.clone(),
        };
        let tmp = self.journal.join(format!("{key}.next"));
        let written = fs::File::create(&tmp)
            .and_then(|mut file| write_receipt(&mut file, &terminal))
            .and_then(|()| fs::rename(&tmp, &receipt_path))
            .and_then(|()| fs::File::open(&self.journal)?.sync_all());
        if written.is_ok() {
            reply
        } else {
            json!({"status":"unknown"})
        }
    }
}

fn write_receipt(file: &mut fs::File, receipt: &Receipt) -> io::Result<()> {
    serde_json::to_writer(&mut *file, receipt)?;
    file.flush()?;
    file.sync_all()
}
