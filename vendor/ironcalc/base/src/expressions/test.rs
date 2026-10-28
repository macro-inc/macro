use super::*;

#[test]
fn test_error_codes() {
    let errors = vec![
        Error::REF,
        Error::NAME,
        Error::VALUE,
        Error::DIV,
        Error::NA,
        Error::NUM,
        Error::ERROR,
        Error::NIMPL,
        Error::SPILL,
        Error::CALC,
        Error::CIRC,
        Error::NULL
    ];
    for (i, error) in errors.iter().enumerate() {
        let s = format!("{}", error);
        let index = error_index(s.clone()).unwrap();
        assert_eq!(i as i32, index);
        let s2 = error_string(i as usize).unwrap();
        assert_eq!(s, s2);
    }
}
