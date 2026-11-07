use super::*;
#[test]
fn utf16_boundaries_and_clamping() -> Result<(), Error> {
    let text = TextBuffer::new("a😀e\u{301}");
    assert_eq!(text.utf16_len(), Utf16Offset(5));
    assert_eq!(text.byte_offset(Utf16Offset(3))?, 5);
    assert!(matches!(
        text.byte_offset(Utf16Offset(2)),
        Err(Error::Utf16OffsetSplitsSurrogatePair(_))
    ));
    assert!(matches!(
        text.byte_offset(Utf16Offset(6)),
        Err(Error::Utf16OffsetOutOfRange(_))
    ));
    assert_eq!(text.slice(Utf16Offset(3)..Utf16Offset(99))?, "e\u{301}");
    assert_eq!(text.code_unit_at(Utf16Offset(1)), Some(0xd83d));
    assert_eq!(text.slice(Utf16Offset(5)..Utf16Offset(0))?, "");
    Ok(())
}
