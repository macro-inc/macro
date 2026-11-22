use super::*;
use tokio::io::AsyncReadExt;

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
