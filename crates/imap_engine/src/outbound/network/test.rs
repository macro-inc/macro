use super::*;
use tokio::io::AsyncReadExt;

#[test]
fn two_hundred_account_watches_leave_capacity_for_commands_and_reuse_a_freed_slot() {
    let connector = Connector::new(LocalEndpoints::default()).unwrap();
    let endpoint = Endpoint {
        host: "mail.example.net".into(),
        port: 993,
        tls: crate::domain::models::TlsMode::Implicit,
        username: "reader@example.net".into(),
    };
    let mut watches = Vec::new();
    let mut polling = 0;
    for index in 0..205 {
        let mut account = endpoint.clone();
        account.username = format!("account-{index}@example.net");
        match connector.try_watch(&account).unwrap() {
            Some(permit) => watches.push(permit),
            None => polling += 1,
        }
    }
    assert_eq!(
        watches.len(),
        150,
        "held watches must reserve fifty host sockets for commands"
    );
    assert_eq!(polling, 55);
    let total = connector.host_budget(&endpoint.host).unwrap().connections;
    let held = total.clone().try_acquire_many_owned(150).unwrap();
    let send = total
        .clone()
        .try_acquire_owned()
        .expect("send admitted with every watch slot occupied");
    assert_eq!(total.available_permits(), 49);
    assert!(connector.try_watch(&endpoint).unwrap().is_none());
    drop(watches.pop());
    assert!(connector.try_watch(&endpoint).unwrap().is_some());
    drop((held, send, watches));
}

fn input(bytes: Vec<u8>) -> Stream {
    Stream {
        inner: Box::new(tokio::io::join(
            std::io::Cursor::new(bytes),
            tokio::io::sink(),
        )),
        permit: None,
        attempt: None,
        line: Vec::new(),
        literal: 0,
        meter: ReadMeter::default(),
    }
}

#[test]
fn a_new_response_resets_its_budget_without_resetting_lifetime_accounting() {
    let mut meter = ReadMeter::default();
    meter.arm(ResponseLimit::Reply);
    meter.charge(4 * 1024 * 1024).unwrap();
    assert!(meter.charge(1).is_err());
    meter.arm(ResponseLimit::Reply);
    meter.charge(4 * 1024 * 1024).unwrap();
    assert_eq!(meter.used, 4 * 1024 * 1024);
    assert_eq!(meter.lifetime, 8 * 1024 * 1024 + 1);
}

#[tokio::test]
async fn one_oversized_response_still_fails_closed() {
    let mut stream = input(vec![b'x'; 4 * 1024 * 1024 + 1]);
    stream.begin_response(ResponseLimit::Reply);
    let error = stream.read_to_end(&mut Vec::new()).await.unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    assert_eq!(error.to_string(), "mail response limit");
}

#[tokio::test]
async fn literal_and_line_guards_remain_independent_of_response_rearming() {
    let mut stream = input(format!("* 1 FETCH (BODY[] {{{}}}\r\n", MAX_LITERAL + 1).into_bytes());
    stream.begin_response(ResponseLimit::Source);
    let error = stream.read_to_end(&mut Vec::new()).await.unwrap_err();
    assert_eq!(error.to_string(), "mail literal limit");

    let mut stream = input(vec![b'x'; MAX_LINE + 1]);
    // Isolate the older framing guard from the stricter command budget.
    stream.meter.limit = MAX_LINE + 1;
    let error = stream.read_to_end(&mut Vec::new()).await.unwrap_err();
    assert_eq!(error.to_string(), "mail line limit");
}

#[test]
fn fresh_sessions_keep_a_total_ceiling_across_response_boundaries() {
    let mut meter = ReadMeter::default();
    for _ in 0..32 {
        meter.arm(ResponseLimit::Metadata);
        meter.charge(16 * 1024 * 1024).unwrap();
    }
    meter.arm(ResponseLimit::Metadata);
    let error = meter.charge(1).unwrap_err();
    assert!(matches!(
        error.get_ref().unwrap().downcast_ref::<ReadLimitError>(),
        Some(ReadLimitError::Connection)
    ));
}

#[test]
fn sync_transfer_budget_survives_reconnects() {
    let shared = Arc::new(TransferBudget::new(MAX_SESSION_BYTES));
    for _ in 0..32 {
        let mut meter = ReadMeter {
            sync_budget: Some(shared.clone()),
            ..ReadMeter::default()
        };
        meter.charge(16 * 1024 * 1024).unwrap();
    }
    let mut reconnected = ReadMeter {
        sync_budget: Some(shared),
        ..ReadMeter::default()
    };
    let error = reconnected.charge(1).unwrap_err();
    assert!(matches!(
        error.get_ref().unwrap().downcast_ref::<ReadLimitError>(),
        Some(ReadLimitError::Sync)
    ));
}
