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
    gate.filter(HANDSHAKE, false).unwrap();

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
    unknown.filter(HANDSHAKE, true).unwrap();
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
    huge.filter(HANDSHAKE, true).unwrap();
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

#[test]
fn a_viewer_may_only_ask_for_encodings_the_server_side_can_frame() {
    let mut gate = RfbGate::new();
    gate.filter(HANDSHAKE, false).unwrap();
    // noVNC's SetEncodings: Tight (7), ZRLE (16), ExtendedClipboard, Raw,
    // DesktopSize (-223), fences (-312).
    let mut set_encodings = vec![2u8, 0, 0, 6];
    for encoding in [7i32, 16, 0xC0A1_E5CEu32 as i32, 0, -223, -312] {
        set_encodings.extend_from_slice(&encoding.to_be_bytes());
    }

    let filtered = gate.filter(&set_encodings, false).unwrap();

    let mut expected = vec![2u8, 0, 0, 3];
    for encoding in [16i32, 0, -223] {
        expected.extend_from_slice(&encoding.to_be_bytes());
    }
    assert_eq!(filtered.forward, expected);
    assert!(!filtered.input);
}

#[test]
fn only_version_3_8_is_spoken() {
    assert_eq!(
        RfbGate::new().filter(b"RFB 003.003\n", false),
        Err(GateError::Version)
    );
}

/// Xvnc's side of a handshake: version, security None, its result, and a
/// 1920x1080 ServerInit at 32 bits per pixel named "a".
fn server_greeting() -> Vec<u8> {
    let mut bytes = b"RFB 003.008\n".to_vec();
    bytes.extend_from_slice(&[1, 1]);
    bytes.extend_from_slice(&[0, 0, 0, 0]);
    bytes.extend_from_slice(&[7, 128, 4, 56]);
    bytes.extend_from_slice(&[32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]);
    bytes.extend_from_slice(&1u32.to_be_bytes());
    bytes.push(b'a');
    bytes
}

fn rectangle(width: u16, height: u16, encoding: i32) -> Vec<u8> {
    let mut bytes = vec![0, 0, 0, 0];
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&encoding.to_be_bytes());
    bytes
}

fn cut_text(text: &[u8]) -> Vec<u8> {
    let mut bytes = vec![3, 0, 0, 0];
    bytes.extend_from_slice(&(text.len() as u32).to_be_bytes());
    bytes.extend_from_slice(text);
    bytes
}

/// A FramebufferUpdate with a 2x2 Raw rectangle, a ZRLE one, a cursor and
/// a CopyRect, then a bell, a clipboard, and a colour map entry.
fn screen_traffic() -> (Vec<u8>, Vec<u8>) {
    let mut frames = vec![0u8, 0, 0, 4];
    frames.extend(rectangle(2, 2, 0));
    frames.extend([9u8; 16]);
    frames.extend(rectangle(64, 64, 16));
    frames.extend(5u32.to_be_bytes());
    frames.extend([1u8, 2, 3, 4, 5]);
    frames.extend(rectangle(9, 1, -239));
    frames.extend([7u8; 9 * 4 + 2]);
    frames.extend(rectangle(10, 10, 1));
    frames.extend([0u8, 1, 0, 2]);
    frames.push(2);
    let clipboard = cut_text(b"secret");
    let mut colour_map = vec![1u8, 0, 0, 0, 0, 1];
    colour_map.extend([0u8; 6]);
    let mut after = frames.clone();
    after.extend(colour_map.clone());
    let mut all = frames;
    all.extend(&clipboard);
    all.extend(colour_map);
    (all, after)
}

#[test]
fn a_viewer_who_does_not_drive_never_gets_the_clipboard() {
    let mut server = RfbGate::new().server_filter();
    let (traffic, without_clipboard) = screen_traffic();
    let mut stream = server_greeting();
    stream.extend(&traffic);

    let passed = server.filter(&stream, false).unwrap();

    let mut expected = server_greeting();
    expected.extend(without_clipboard);
    assert_eq!(passed, expected);
}

#[test]
fn the_driver_gets_the_clipboard_and_everything_else_byte_for_byte() {
    let mut server = RfbGate::new().server_filter();
    let (traffic, _) = screen_traffic();
    let mut stream = server_greeting();
    stream.extend(&traffic);

    assert_eq!(server.filter(&stream, true).unwrap(), stream);
}

#[test]
fn the_server_side_frames_bytes_however_they_are_split() {
    let mut server = RfbGate::new().server_filter();
    let (traffic, without_clipboard) = screen_traffic();
    let mut stream = server_greeting();
    stream.extend(&traffic);

    let mut passed = Vec::new();
    for byte in &stream {
        passed.extend(server.filter(std::slice::from_ref(byte), false).unwrap());
    }

    let mut expected = server_greeting();
    expected.extend(without_clipboard);
    assert_eq!(passed, expected);
}

#[test]
fn a_drive_that_ends_mid_clipboard_passes_none_of_the_rest() {
    let mut server = RfbGate::new().server_filter();
    let mut stream = server_greeting();
    let clipboard = cut_text(b"secret");
    let (start, rest) = clipboard.split_at(10);
    stream.extend(start);
    let passed = server.filter(&stream, true).unwrap();
    assert_eq!(passed, stream);

    assert_eq!(server.filter(rest, false), Err(GateError::ClipboardCut));
}

#[test]
fn a_clipboard_split_across_reads_passes_whole_while_the_drive_lasts() {
    let mut server = RfbGate::new().server_filter();
    let mut stream = server_greeting();
    stream.extend(cut_text(b"secret"));

    let mut passed = Vec::new();
    for byte in &stream {
        passed.extend(server.filter(std::slice::from_ref(byte), true).unwrap());
    }

    assert_eq!(passed, stream);
}

/// noVNC's SetPixelFormat: 32 bits per pixel, depth 24, true colour.
const PIXEL_FORMAT_32: [u8; 20] = [
    0, 0, 0, 0, 32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0,
];

#[test]
fn only_32_bit_true_colour_pixels_are_spoken() {
    let mut gate = RfbGate::new();
    gate.filter(HANDSHAKE, false).unwrap();
    assert_eq!(
        gate.filter(&PIXEL_FORMAT_32, false).unwrap().forward,
        PIXEL_FORMAT_32
    );

    let mut eight_bits = PIXEL_FORMAT_32;
    eight_bits[4] = 8;
    assert_eq!(gate.filter(&eight_bits, false), Err(GateError::PixelFormat));

    let mut gate = RfbGate::new();
    gate.filter(HANDSHAKE, false).unwrap();
    let mut colour_map = PIXEL_FORMAT_32;
    colour_map[7] = 0;
    assert_eq!(gate.filter(&colour_map, false), Err(GateError::PixelFormat));
}

/// A watcher who changes the pixel format under a frame already on its way
/// would have the server side frame that frame at the wrong size and pass
/// what follows it, the clipboard included: the change ends the connection
/// before any of that frame passes the filter.
#[test]
fn a_mid_stream_pixel_format_change_ends_the_connection() {
    let mut gate = RfbGate::new();
    let mut server = gate.server_filter();
    gate.filter(HANDSHAKE, false).unwrap();
    gate.filter(&PIXEL_FORMAT_32, false).unwrap();
    server.filter(&server_greeting(), false).unwrap();
    gate.filter(&FRAMEBUFFER_UPDATE_REQUEST, false).unwrap();

    let mut eight_bits = PIXEL_FORMAT_32;
    eight_bits[4] = 8;
    assert_eq!(gate.filter(&eight_bits, false), Err(GateError::PixelFormat));
}

#[test]
fn a_server_that_isnt_32_bit_is_not_framed() {
    let mut server = RfbGate::new().server_filter();
    let mut greeting = server_greeting();
    // ServerInit's bits per pixel, after version, security and result.
    greeting[12 + 2 + 4 + 4] = 16;
    assert_eq!(server.filter(&greeting, false), Err(GateError::PixelFormat));
}

#[test]
fn the_server_side_closes_on_what_it_cannot_frame() {
    let mut server = RfbGate::new().server_filter();
    let mut stream = server_greeting();
    stream.extend([0u8, 0, 0, 1]);
    // Tight, which the gate never offers.
    stream.extend(rectangle(2, 2, 7));
    assert_eq!(
        server.filter(&stream, false),
        Err(GateError::UnknownEncoding(7))
    );

    let mut server = RfbGate::new().server_filter();
    let mut stream = server_greeting();
    stream.push(77);
    assert_eq!(
        server.filter(&stream, false),
        Err(GateError::UnknownServerMessage(77))
    );
}
