//! Resolve current connections without changing a session's selected-app policy.
use crate::domain::{model::SandboxEgress, ports::SandboxEgressProvisioner};
use agent_egress::domain::model::SessionToken;
use agent_session::domain::{model::AgentSessionId, ports::AgentSessionRepo};

/// Authenticate the existing session credential and rebuild its permitted list.
#[tracing::instrument(skip_all, fields(session_id = %id), err)]
pub async fn refresh<R: AgentSessionRepo, P: SandboxEgressProvisioner>(
    sessions: &R,
    provisioner: &P,
    id: AgentSessionId,
    token: SessionToken,
) -> anyhow::Result<SandboxEgress> {
    let session = sessions
        .find_by_egress_token_hash(&token.hash())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Unknown session credential"))?;
    anyhow::ensure!(
        session.id == id && !session.is_archived,
        "Session is not available for connector refresh"
    );
    Ok(provisioner
        .restore(
            session.owner_user()?,
            token.as_str().to_owned(),
            &session.mcp_servers,
        )
        .await?)
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::domain::{error::Result, model::ProvisionedEgress};
    use agent_session::{
        domain::model::AgentMcpServers,
        testing::{InMemoryAgentSessionRepo, test_agent_session},
    };
    use macro_user_id::user_id::MacroUserIdStr;
    use std::sync::Mutex;

    #[derive(Default)]
    struct RecordingProvisioner(Mutex<Vec<(String, AgentMcpServers)>>);
    impl SandboxEgressProvisioner for RecordingProvisioner {
        async fn provision(
            &self,
            _: AgentSessionId,
            _: &MacroUserIdStr<'static>,
            _: &AgentMcpServers,
        ) -> Result<ProvisionedEgress> {
            panic!("refresh must not mint credentials")
        }
        async fn restore(
            &self,
            owner: &MacroUserIdStr<'static>,
            token: String,
            selection: &AgentMcpServers,
        ) -> Result<SandboxEgress> {
            self.0
                .lock()
                .unwrap()
                .push((owner.to_string(), selection.clone()));
            Ok(SandboxEgress {
                session_token: token,
                ..crate::testing::helpers::egress::test_egress()
            })
        }
    }

    #[tokio::test]
    async fn refresh_preserves_owner_selection_and_credential() {
        for selection in [
            AgentMcpServers::OwnerConnections,
            AgentMcpServers::Selected { servers: vec![] },
        ] {
            let repo = InMemoryAgentSessionRepo::new();
            let mut session = test_agent_session(AgentSessionId::new());
            session.mcp_servers = selection.clone();
            let id = session.id;
            let owner = session.owner_user().unwrap().to_string();
            repo.insert_session(session);
            repo.set_egress_token_hash(id, &SessionToken::new("credential").hash())
                .await
                .unwrap();
            let provisioner = RecordingProvisioner::default();
            let result = refresh(&repo, &provisioner, id, SessionToken::new("credential"))
                .await
                .unwrap();
            assert_eq!(result.session_token, "credential");
            assert_eq!(*provisioner.0.lock().unwrap(), vec![(owner, selection)]);
        }
    }

    #[tokio::test]
    async fn unknown_mismatched_and_archived_sessions_cannot_refresh() {
        let repo = InMemoryAgentSessionRepo::new();
        let mut session = test_agent_session(AgentSessionId::new());
        let id = session.id;
        repo.insert_session(session.clone());
        repo.set_egress_token_hash(id, &SessionToken::new("credential").hash())
            .await
            .unwrap();
        let provisioner = RecordingProvisioner::default();
        assert!(
            refresh(&repo, &provisioner, id, SessionToken::new("unknown"))
                .await
                .is_err()
        );
        assert!(
            refresh(
                &repo,
                &provisioner,
                AgentSessionId::new(),
                SessionToken::new("credential")
            )
            .await
            .is_err()
        );
        session.is_archived = true;
        repo.insert_session(session);
        assert!(
            refresh(&repo, &provisioner, id, SessionToken::new("credential"))
                .await
                .is_err()
        );
        assert!(provisioner.0.lock().unwrap().is_empty());
    }
}
