//! Resolve the race between observing another holder and registering a waiter.
use super::*;

pub(super) async fn resolve<C, CF, W, WF>(claim: C, wait: W) -> Result<TeamClaim>
where
    C: Fn() -> CF,
    CF: Future<Output = Result<TeamClaim>>,
    W: Fn(Uuid) -> WF,
    WF: Future<Output = Result<bool>>,
{
    for _ in 0..3 {
        let found = claim().await?;
        match found {
            TeamClaim::Waiting { holder } if !wait(holder).await? => {}
            found => return Ok(found),
        }
    }
    Err(ImportError::NotReady(
        "The team's import kept changing. Plan again to retry this object.",
    ))
}

#[cfg(test)]
mod test;
