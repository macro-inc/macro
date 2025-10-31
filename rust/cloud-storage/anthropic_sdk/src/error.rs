use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("config error")]
    Config(std::env::VarError),
}

pub type Result<T> = std::result::Result<T, Error>;
