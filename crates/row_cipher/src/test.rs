use super::RowCipher;
use uuid::Uuid;

#[test]
fn a_secret_opens_only_in_its_own_row_under_its_own_key() {
    let cipher = RowCipher::new(&[7; 32]);
    let row = Uuid::from_u128(1);
    let sealed = cipher.seal(row, b"whsec_secret").unwrap();

    assert_eq!(cipher.open(row, &sealed).unwrap(), b"whsec_secret");
    assert!(cipher.open(Uuid::from_u128(2), &sealed).is_err());
    assert!(RowCipher::new(&[8; 32]).open(row, &sealed).is_err());
    assert!(cipher.open(row, &sealed[..11]).is_err());
}
