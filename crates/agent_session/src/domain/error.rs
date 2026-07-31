use thiserror::Error;
pub type Result<T, E = AgentSessionError> = std::result::Result<T, E>;

#[derive(Error, Debug)]
pub enum AgentSessionError {
    #[error("{0}")]
    Unknown(#[from] anyhow::Error),
}
