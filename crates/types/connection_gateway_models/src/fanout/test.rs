use super::*;

/// The gateway encodes and the sync tier decodes (and vice versa); this pins
/// the postcard round trip both directions.
#[test]
fn from_gateway_round_trips() {
    let message = FromGateway::Frame {
        gateway: GatewayId("g-1".into()),
        conn: ConnId("c-1".into()),
        text: false,
        payload: vec![0xff, 0x00, 0x7f],
    };
    let bytes = postcard::to_stdvec(&message).unwrap();
    let decoded: FromGateway = postcard::from_bytes(&bytes).unwrap();
    match decoded {
        FromGateway::Frame {
            gateway,
            conn,
            text,
            payload,
        } => {
            assert_eq!(gateway, GatewayId("g-1".into()));
            assert_eq!(conn, ConnId("c-1".into()));
            assert!(!text);
            assert_eq!(payload, vec![0xff, 0x00, 0x7f]);
        }
        other => panic!("wrong variant: {other:?}"),
    }
}

#[test]
fn to_gateway_round_trips() {
    let message = ToGateway::Close {
        conn: ConnId("c-9".into()),
        code: 4000,
    };
    let bytes = postcard::to_stdvec(&message).unwrap();
    let decoded: ToGateway = postcard::from_bytes(&bytes).unwrap();
    match decoded {
        ToGateway::Close { conn, code } => {
            assert_eq!(conn, ConnId("c-9".into()));
            assert_eq!(code, 4000);
        }
        other => panic!("wrong variant: {other:?}"),
    }
}
