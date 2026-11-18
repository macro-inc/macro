//! The move routes ([`crate::moves`]).

use reqwest::Method;

use super::{ClientError, HostClient, NO_BODY};
use crate::moves::{AdoptComputer, ExpectMove, MoveHolding, Replicate, Replication};
use crate::{Computer, ComputerId};

const MOVE: &str = "/v1/moves/{computer_id}";
const ADOPT: &str = "/v1/moves/{computer_id}/adopt";
const REPLICATION: &str = "/v1/computers/{computer_id}/replication";
const RELEASE: &str = "/v1/computers/{computer_id}/release";

impl HostClient {
    /// On the target: accept the computer from a source holding the ticket.
    pub async fn expect_move(
        &self,
        computer_id: ComputerId,
        request: &ExpectMove,
    ) -> Result<MoveHolding, ClientError> {
        let path = format!("/v1/moves/{computer_id}");
        self.json(Method::PUT, MOVE, &path, Some(request)).await
    }

    /// What the host holds of a moving computer.
    pub async fn move_holding(&self, computer_id: ComputerId) -> Result<MoveHolding, ClientError> {
        let path = format!("/v1/moves/{computer_id}");
        self.json(Method::GET, MOVE, &path, NO_BODY).await
    }

    /// Drop the staged copy (never the live computer).
    pub async fn drop_staged(&self, computer_id: ComputerId) -> Result<(), ClientError> {
        let path = format!("/v1/moves/{computer_id}");
        self.call(Method::DELETE, MOVE, &path, NO_BODY)
            .await
            .map(drop)
    }

    /// On the source: start (or join) a replication round to the target.
    pub async fn replicate(
        &self,
        computer_id: ComputerId,
        request: &Replicate,
    ) -> Result<Replication, ClientError> {
        let path = format!("/v1/computers/{computer_id}/replication");
        self.json(Method::POST, REPLICATION, &path, Some(request))
            .await
    }

    /// On the source: the last replication round.
    pub async fn replication(&self, computer_id: ComputerId) -> Result<Replication, ClientError> {
        let path = format!("/v1/computers/{computer_id}/replication");
        self.json(Method::GET, REPLICATION, &path, NO_BODY).await
    }

    /// On the source: shut the guest down and stage it.
    pub async fn release(&self, computer_id: ComputerId) -> Result<MoveHolding, ClientError> {
        let path = format!("/v1/computers/{computer_id}/release");
        self.json(Method::POST, RELEASE, &path, NO_BODY).await
    }

    /// On the target: serve the staged computer, stopped.
    pub async fn adopt(
        &self,
        computer_id: ComputerId,
        request: &AdoptComputer,
    ) -> Result<Computer, ClientError> {
        let path = format!("/v1/moves/{computer_id}/adopt");
        self.json(Method::POST, ADOPT, &path, Some(request)).await
    }
}
