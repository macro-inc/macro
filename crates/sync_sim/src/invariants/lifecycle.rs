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

/// No surface initializes before its durable adoption callbacks are consumed.
pub fn no_seed_over_unadopted_wal(outcome: &Outcome) -> Result<(), Failure> {
    let mut pending = std::collections::BTreeSet::new();
    for event in &outcome.events {
        match &event.fact {
            Fact::WalAdoptionIssued {
                client,
                session,
                id,
            } => {
                pending.insert((client, session, id));
            }
            Fact::WalAdoptionCompleted {
                client,
                session,
                id,
            } => {
                pending.remove(&(client, session, id));
            }
            Fact::Seeded {
                client, session, ..
            } if pending
                .iter()
                .any(|(c, s, _)| c == &client && s == &session) =>
            {
                return Err(Failure::new(
                    "no_seed_over_unadopted_wal",
                    format!(
                        "{client:?}/{session:?}: initialized before durable WAL adoption completed"
                    ),
                ));
            }
            _ => {}
        }
    }
    Ok(())
}
