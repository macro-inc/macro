//! harnessd, the agent sign-in daemon on a Macro computer. `harnessd serve`
//! owns each agent's sign-in (a Claude sign-in spans two requests minutes
//! apart) and answers the JSONL protocol of `harnessd_protocol` on a unix
//! socket; `harnessd` alone is the client the control plane runs.

#![deny(missing_docs)]

pub mod auth;
pub mod claude;
pub mod client;
pub mod jsonl;
pub mod socket;
