use super::*;

#[test]
fn input_dom_disposition_uses_only_canonical_code_twelve_fields() {
    for default_prevented in [false, true] {
        for propagation_stopped in [false, true] {
            let disposition = InputDomDisposition {
                default_prevented,
                propagation_stopped,
            };
            let output = SessionOutput {
                view: vec![ViewEffect::Editor(Effect::InputDomDisposition(disposition))],
                ..SessionOutput::default()
            };
            let mut buffer = Vec::new();
            let flags = output::encode(&output, false, &mut buffer, None, None).unwrap();
            assert_eq!(flags, 1);
            assert_eq!(u32::from_le_bytes(buffer[12..16].try_into().unwrap()), 0);
            assert_eq!(u32::from_le_bytes(buffer[16..20].try_into().unwrap()), 0);
            assert_eq!(u32::from_le_bytes(buffer[20..24].try_into().unwrap()), 1);
            assert_eq!(u32::from_le_bytes(buffer[24..28].try_into().unwrap()), 16);
            let len = u32::from_le_bytes(buffer[36..40].try_into().unwrap()) as usize;
            let encoded = &buffer[40..40 + len];
            let effect = wire::ViewEffectMsg::deserialize(encoded).unwrap();
            let mut expected = output::view(6);
            expected.code = 12;
            expected.flag = default_prevented;
            expected.detail = u32::from(propagation_stopped);
            assert_eq!(bytes(&effect).unwrap(), bytes(&expected).unwrap());
            assert_eq!(bytes(&effect).unwrap(), encoded);
        }
    }
}

#[test]
fn prevent_default_success_keeps_its_existing_code_two_bytes() {
    let output = SessionOutput {
        view: vec![ViewEffect::Editor(Effect::PreventDefault)],
        ..SessionOutput::default()
    };
    let mut buffer = Vec::new();
    output::encode(&output, false, &mut buffer, None, None).unwrap();
    let len = u32::from_le_bytes(buffer[36..40].try_into().unwrap()) as usize;
    let mut expected = output::view(6);
    expected.code = 2;
    assert_eq!(buffer[40..40 + len], bytes(&expected).unwrap());
}
