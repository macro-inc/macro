use super::*;
use sync_service_bebop_schema::ToRouter;

#[test]
fn subscribe_round_trips() {
    let mut buffer = Vec::new();
    ToRouter::RouterSubscribe {
        doc_id: "doc-1",
        token: "tok",
    }
    .serialize(&mut buffer)
    .unwrap();
    assert_eq!(
        decode_client(&buffer).unwrap(),
        ClientEnvelope::RouterSubscribe {
            doc_id: "doc-1".into(),
            token: "tok".into()
        },
    );
}

#[test]
fn frame_round_trips() {
    let mut buffer = Vec::new();
    ToRouter::RouterFrame {
        doc_id: "doc-2",
        payload: SliceWrapper::Raw(&[1, 2, 3]),
    }
    .serialize(&mut buffer)
    .unwrap();
    assert_eq!(
        decode_client(&buffer).unwrap(),
        ClientEnvelope::RouterFrame {
            doc_id: "doc-2".into(),
            payload: vec![1, 2, 3]
        },
    );
}

#[test]
fn unknown_discriminator_is_the_unknown_error() {
    // bebop union wire shape: u32 LE body length, then discriminator, then body.
    let bytes = [1u8, 0, 0, 0, 99];
    assert!(matches!(decode_client(&bytes), Err(EnvelopeError::Unknown)));
}

#[test]
fn garbage_is_a_decode_error() {
    assert!(matches!(
        decode_client(&[0xde, 0xad]),
        Err(EnvelopeError::Decode(_))
    ));
}

#[test]
fn server_frames_decode_as_from_router() {
    let bytes = doc_frame("doc-3", &[9, 9]);
    match FromRouter::deserialize(&bytes).unwrap() {
        FromRouter::RouterDocFrame { doc_id, payload } => {
            assert_eq!(doc_id, "doc-3");
            assert_eq!(payload.to_vec(), vec![9, 9]);
        }
        other => panic!("wrong variant: {other:?}"),
    }
}
