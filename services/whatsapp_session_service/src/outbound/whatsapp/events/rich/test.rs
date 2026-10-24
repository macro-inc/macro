use super::vcard;

#[test]
fn a_vcard_gives_its_name_and_phone_numbers() {
    let card = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Lovelace;Ada;;;\r\nFN:Ada Lovelace\r\n\
        item1.TEL;waid=15550001111:+1 555-000-1111\r\nitem1.X-ABLabel:Mobile\r\n\
        TEL;TYPE=WORK:+44 20 7946 0000\r\nEND:VCARD";

    let (name, phones) = vcard(card);

    assert_eq!(name.as_deref(), Some("Ada Lovelace"));
    assert_eq!(phones, vec!["+1 555-000-1111", "+44 20 7946 0000"]);
}
