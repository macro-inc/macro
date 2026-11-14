use super::*;

fn channel(id: u128) -> MessageParent {
    MessageParent::Channel(Uuid::from_u128(id))
}

#[tokio::test(start_paused = true)]
async fn a_channel_runs_a_few_writes_and_the_rest_wait_their_turn() {
    let gate = ChannelWriteGate::default();
    let mut turns = Vec::new();
    for _ in 0..WRITES_IN_FLIGHT {
        turns.push(gate.enter(&channel(1)).await.unwrap());
    }
    let waiting = tokio::spawn({
        let gate = gate.clone();
        async move { gate.enter(&channel(1)).await.map(|_| ()) }
    });
    // Another channel is not held up.
    assert!(gate.enter(&channel(2)).await.unwrap().is_some());

    tokio::time::advance(TURN_WAIT / 2).await;
    assert!(!waiting.is_finished());
    turns.pop();
    assert!(waiting.await.unwrap().is_ok());
}

#[tokio::test(start_paused = true)]
async fn a_write_that_waits_too_long_fails_as_busy() {
    let gate = ChannelWriteGate::default();
    let mut turns = Vec::new();
    for _ in 0..WRITES_IN_FLIGHT {
        turns.push(gate.enter(&channel(1)).await.unwrap());
    }
    let refused = gate.enter(&channel(1)).await;
    assert!(matches!(refused, Err(MessageError::Busy)));

    // The channel is forgotten once nobody holds or waits for a turn.
    assert_eq!(gate.channels(), 1);
    turns.clear();
    assert_eq!(gate.channels(), 0);
}

#[tokio::test]
async fn parents_without_a_counter_need_no_turn() {
    let gate = ChannelWriteGate::default();
    let turn = gate
        .enter(&MessageParent::Initiative(Uuid::from_u128(3)))
        .await
        .unwrap();
    assert!(turn.is_none());
    assert_eq!(gate.channels(), 0);
}
