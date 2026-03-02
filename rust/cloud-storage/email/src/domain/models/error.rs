use frecency::domain::models::FrecencyQueryErr;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum EmailErr {
    #[error(transparent)]
    RepoErr(#[from] anyhow::Error),
    #[error(transparent)]
    Frecency(#[from] FrecencyQueryErr),
}
