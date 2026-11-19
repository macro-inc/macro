use super::Extensions;

#[test]
fn only_explicit_ehlo_extensions_and_mechanisms_are_recognized() {
    let response =
        b"250-AUTH PLAIN\r\n250-smtputf8\r\n250-8BITMIME\r\n250-SIZE 2048\r\n250 AUTH=LOGIN\r\n";
    let capabilities = Extensions::parse(response);
    assert!(capabilities.utf8 && capabilities.eight_bit && capabilities.login);
    assert!(!capabilities.plain);
    assert_eq!(capabilities.size, Some(2048));
    for response in [
        b"250-host\r\n250 SIZE 0\r\n".as_slice(),
        b"250-host\r\n250 SIZE invalid\r\n",
        b"250-host\r\n250 SIZE 18446744073709551616\r\n",
    ] {
        assert_eq!(Extensions::parse(response).size, None);
    }
}

#[test]
fn smtp_size_excludes_dot_stuffing_and_terminator_and_preserves_final_crlf() {
    let (data, size) = super::data_block("Subject: hi\r\n\r\n.first\n.\r\n").unwrap();
    assert_eq!(data, b"Subject: hi\r\n\r\n..first\r\n..\r\n.\r\n");
    assert_eq!(size, "Subject: hi\r\n\r\n.first\r\n.\r\n".len() as u64);
    assert!(super::data_block("header\rforged").is_err());
}
