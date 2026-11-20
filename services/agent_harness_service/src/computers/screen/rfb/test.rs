use super::{GateError, InputEvent, RfbGate, encode};

/// Version 3.8, security None, an exclusive ClientInit.
const HANDSHAKE: &[u8] = b"RFB 003.008\n\x01\x00";
const SHARED_HANDSHAKE: &[u8] = b"RFB 003.008\n\x01\x01";
const FRAMEBUFFER_UPDATE_REQUEST: [u8; 10] = [3, 1, 0, 0, 0, 0, 7, 128, 4, 56];
const KEY_A_DOWN: [u8; 8] = [4, 1, 0, 0, 0, 0, 0, 0x61];
const POINTER_CLICK: [u8; 6] = [5, 1, 0, 10, 0, 20];
const CUT_TEXT_HI: [u8; 10] = [6, 0, 0, 0, 0, 0, 0, 2, b'h', b'i'];
const XVP_REBOOT: [u8; 4] = [250, 0, 1, 3];
const SET_DESKTOP_SIZE: [u8; 24] = [
    251, 0, 7, 128, 4, 56, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 128, 4, 56, 0, 0, 0, 0,
];

fn session(messages: &[&[u8]]) -> Vec<u8> {
    let mut bytes = HANDSHAKE.to_vec();
    for message in messages {
        bytes.extend_from_slice(message);
    }
    bytes
}

#[test]
fn a_viewer_keeps_the_handshake_and_frame_requests_but_no_input() {
    let mut gate = RfbGate::new();

    let forwarded = gate
        .filter(
            &session(&[
                &FRAMEBUFFER_UPDATE_REQUEST,
                &KEY_A_DOWN,
                &POINTER_CLICK,
                &CUT_TEXT_HI,
                &SET_DESKTOP_SIZE,
                &FRAMEBUFFER_UPDATE_REQUEST,
            ]),
            false,
        )
        .unwrap()
        .forward;

    let mut expected = SHARED_HANDSHAKE.to_vec();
    expected.extend_from_slice(&FRAMEBUFFER_UPDATE_REQUEST);
    expected.extend_from_slice(&FRAMEBUFFER_UPDATE_REQUEST);
    assert_eq!(forwarded, expected);
}

#[test]
fn the_driver_passes_input_but_never_power_actions() {
    let mut gate = RfbGate::new();

    let forwarded = gate
        .filter(&session(&[&KEY_A_DOWN, &XVP_REBOOT, &POINTER_CLICK]), true)
        .unwrap()
        .forward;

    let mut expected = SHARED_HANDSHAKE.to_vec();
    expected.extend_from_slice(&KEY_A_DOWN);
    expected.extend_from_slice(&POINTER_CLICK);
    assert_eq!(forwarded, expected);
}

#[test]
fn messages_split_across_frames_are_judged_whole() {
    let mut gate = RfbGate::new();
    let bytes = session(&[&CUT_TEXT_HI, &FRAMEBUFFER_UPDATE_REQUEST]);

    let mut forwarded = Vec::new();
    for byte in &bytes {
        forwarded.extend(
            gate.filter(std::slice::from_ref(byte), false)
                .unwrap()
                .forward,
        );
    }

    let mut expected = SHARED_HANDSHAKE.to_vec();
    expected.extend_from_slice(&FRAMEBUFFER_UPDATE_REQUEST);
    assert_eq!(forwarded, expected);
}

#[test]
fn input_follows_the_lease_mid_stream() {
    let mut gate = RfbGate::new();
    gate.filter(HANDSHAKE, false).unwrap().forward;

    assert_eq!(
        gate.filter(&KEY_A_DOWN, false).unwrap().forward,
        Vec::<u8>::new()
    );
    assert_eq!(
        gate.filter(&KEY_A_DOWN, true).unwrap().forward,
        KEY_A_DOWN.to_vec()
    );
}

#[test]
fn the_gate_closes_on_what_it_cannot_frame() {
    let mut unknown = RfbGate::new();
    unknown.filter(HANDSHAKE, true).unwrap().forward;
    assert_eq!(
        unknown.filter(&[7, 0, 0], true),
        Err(GateError::UnknownMessage(7))
    );

    let mut vnc_auth = RfbGate::new();
    assert_eq!(
        vnc_auth.filter(b"RFB 003.008\n\x02", true),
        Err(GateError::Security)
    );

    let mut version = RfbGate::new();
    assert_eq!(
        version.filter(b"RFB 004.001\n", true),
        Err(GateError::Version)
    );

    let mut huge = RfbGate::new();
    huge.filter(HANDSHAKE, true).unwrap().forward;
    assert_eq!(
        huge.filter(&[6, 0, 0, 0, 0x7f, 0xff, 0xff, 0xff], true),
        Err(GateError::TooLarge)
    );
}

#[test]
fn text_types_each_character_down_and_up() {
    let (bytes, held) = encode(
        &InputEvent::Text {
            text: "A\né".to_owned(),
        },
        0,
    );

    let keysyms: Vec<(u8, u32)> = bytes
        .chunks(8)
        .map(|event| {
            (
                event[1],
                u32::from_be_bytes([event[4], event[5], event[6], event[7]]),
            )
        })
        .collect();
    assert_eq!(
        keysyms,
        vec![
            (1, 0x41),
            (0, 0x41),
            (1, 0xff0d),
            (0, 0xff0d),
            (1, 0xe9),
            (0, 0xe9)
        ]
    );
    assert_eq!(held, 0);
}

#[test]
fn scrolling_clicks_the_wheel_buttons_over_held_ones() {
    let (bytes, held) = encode(
        &InputEvent::Scroll {
            x: 5,
            y: 6,
            dx: 0,
            dy: -2,
        },
        1,
    );

    assert_eq!(
        bytes,
        [
            [5, 0b1001, 0, 5, 0, 6],
            [5, 1, 0, 5, 0, 6],
            [5, 0b1001, 0, 5, 0, 6],
            [5, 1, 0, 5, 0, 6],
        ]
        .concat()
    );
    assert_eq!(held, 1);
}

#[test]
fn pointers_clamp_to_the_screen_and_clipboards_are_latin1() {
    let (pointer, held) = encode(
        &InputEvent::Pointer {
            x: -4,
            y: 70_000,
            buttons: 4,
        },
        0,
    );
    assert_eq!(pointer, vec![5, 4, 0, 0, 0xff, 0xff]);
    assert_eq!(held, 4);

    let (clipboard, _) = encode(
        &InputEvent::Clipboard {
            text: "é→".to_owned(),
        },
        0,
    );
    assert_eq!(clipboard, vec![6, 0, 0, 0, 0, 0, 0, 2, 0xe9, b'?']);
}
