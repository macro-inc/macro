use super::*;

/// Every native Stop request receives its actual reply and finishes host teardown.
pub fn every_close_terminates(outcome: &Outcome) -> Result<(), Failure> {
    for (index, event) in outcome.events.iter().enumerate() {
        let Fact::CloseRequested {
            client,
            session,
            request,
            deadline,
        } = &event.fact
        else {
            continue;
        };
        let later = &outcome.events[index + 1..];
        let ack = later.iter().position(|event| {
            matches!(&event.fact,
            Fact::CloseAcknowledged { client: target, session: owner, request: id }
                if target == client && owner == session && id == request)
        });
        let closed = later.iter().position(|event| {
            matches!(&event.fact,
            Fact::Closed { client: target, session: owner } if target == client && owner == session)
        });
        if !matches!((ack, closed), (Some(a), Some(c)) if a < c && later[c].at.0 <= *deadline) {
            return Err(Failure::new(
                "every_close_terminates",
                format!(
                    "{client:?}/{session:?}/{request}: missing ordered reply/teardown before {deadline}"
                ),
            ));
        }
    }
    Ok(())
}
