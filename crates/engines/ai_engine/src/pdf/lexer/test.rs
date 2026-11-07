use super::*;

fn tokens(s: &[u8]) -> Vec<Token<'_>> {
    let mut lexer = Lexer::new(s, 0);
    std::iter::from_fn(|| lexer.next().map(|t| t.token)).collect()
}

fn one(s: &[u8]) -> Token<'_> {
    let mut t = tokens(s);
    assert_eq!(
        t.len(),
        1,
        "{:?} lexed as {t:?}",
        String::from_utf8_lossy(s)
    );
    t.remove(0)
}

#[test]
fn numbers() {
    assert_eq!(one(b"123"), Token::Int(123));
    assert_eq!(one(b"+17"), Token::Int(17));
    assert_eq!(one(b"-98"), Token::Int(-98));
    assert_eq!(one(b"-0"), Token::Int(0));
    assert_eq!(one(b"0000000015"), Token::Int(15));
    assert_eq!(one(b"34.5"), Token::Real(34.5));
    assert_eq!(one(b"-3.62"), Token::Real(-3.62));
    assert_eq!(one(b"+123.6"), Token::Real(123.6));
    assert_eq!(one(b"4."), Token::Real(4.0));
    assert_eq!(one(b"-.002"), Token::Real(-0.002));
    assert_eq!(one(b"+.5"), Token::Real(0.5));
    assert_eq!(one(b".5"), Token::Real(0.5));
    assert_eq!(one(b"0.0"), Token::Real(0.0));
    assert_eq!(one(b"0.1"), Token::Real(0.1));
    assert_eq!(one(b"123456.789"), Token::Real(123456.789));
}

#[test]
fn numbers_as_acrobat_reads_them() {
    // A doubled minus, a minus inside a number, and a lone sign or dot.
    assert_eq!(one(b"--5"), Token::Int(-5));
    assert_eq!(one(b"5-3"), Token::Int(53));
    assert_eq!(one(b"0.00-1"), Token::Real(0.001));
    assert_eq!(one(b"-"), Token::Int(0));
    assert_eq!(one(b"."), Token::Int(0));
    // A second dot starts another number.
    assert_eq!(tokens(b"1.2.3"), [Token::Real(1.2), Token::Real(0.3)]);
    // An exponent only when digits follow; `E` otherwise starts an operator.
    assert_eq!(one(b"1e3"), Token::Real(1000.0));
    assert_eq!(one(b"2.5E-2"), Token::Real(0.025));
    assert_eq!(tokens(b"5ET"), [Token::Int(5), Token::Keyword(b"ET")]);
    assert_eq!(tokens(b"12abc"), [Token::Int(12), Token::Keyword(b"abc")]);
}

#[test]
fn big_numbers_do_not_overflow() {
    assert_eq!(one(b"9223372036854775807"), Token::Int(i64::MAX));
    assert_eq!(one(b"99999999999999999999"), Token::Real(1e20));
    assert_eq!(
        one(b"0.123456789012345678901234567890"),
        Token::Real(0.123_456_789_012_345_68)
    );
    let huge = format!("1{}", "0".repeat(400));
    assert!(matches!(one(huge.as_bytes()), Token::Real(v) if v.is_finite()));
    assert_eq!(one(b"1e99999"), Token::Real(0.0));
}

#[test]
fn reals_read_back_exactly() {
    for v in [
        0.1,
        0.3,
        1.0 / 3.0,
        595.276,
        841.89,
        -0.000_123_4,
        12_345.678_9,
    ] {
        let s = format!("{v}");
        assert_eq!(one(s.as_bytes()), Token::Real(v), "{s}");
    }
}

#[test]
fn literal_strings() {
    assert_eq!(
        one(b"(This is a string)"),
        Token::String(b"This is a string".to_vec())
    );
    assert_eq!(
        one(b"(Strings may contain (balanced) parentheses ( ) and *!&}^%)"),
        Token::String(b"Strings may contain (balanced) parentheses ( ) and *!&}^%".to_vec())
    );
    assert_eq!(one(b"()"), Token::String(Vec::new()));
    assert_eq!(
        one(b"(\\n\\r\\t\\b\\f\\(\\)\\\\)"),
        Token::String(b"\n\r\t\x08\x0c()\\".to_vec())
    );
    // Octal: one to three digits, high bits dropped.
    assert_eq!(
        one(b"(\\53\\0053\\7\\777)"),
        Token::String(b"+\x053\x07\xff".to_vec())
    );
    // Unknown escapes are the character itself.
    assert_eq!(one(b"(\\q\\%)"), Token::String(b"q%".to_vec()));
    // A backslash before an end of line continues the line.
    assert_eq!(
        one(b"(ab\\\ncd\\\r\nef\\\rgh)"),
        Token::String(b"abcdefgh".to_vec())
    );
    // Ends of line inside strings read as LF.
    assert_eq!(
        one(b"(a\r\nb\rc\nd)"),
        Token::String(b"a\nb\nc\nd".to_vec())
    );
    // Unterminated: the rest of the data.
    assert_eq!(one(b"(abc (def"), Token::String(b"abc (def".to_vec()));
}

#[test]
fn hex_strings() {
    assert_eq!(
        one(b"<4E6F762073686D6F7A206B6120706F702E>"),
        Token::String(b"Nov shmoz ka pop.".to_vec())
    );
    assert_eq!(one(b"<901FA3>"), Token::String(vec![0x90, 0x1f, 0xa3]));
    // An odd final digit reads as if followed by 0.
    assert_eq!(one(b"<901FA>"), Token::String(vec![0x90, 0x1f, 0xa0]));
    assert_eq!(one(b"< 90 1f\na3 >"), Token::String(vec![0x90, 0x1f, 0xa3]));
    assert_eq!(one(b"<>"), Token::String(Vec::new()));
    assert_eq!(one(b"<4gz1>"), Token::String(vec![0x41]));
}

#[test]
fn names() {
    let name = |s: &[u8]| Token::Name(Name(s.to_vec()));
    assert_eq!(one(b"/Name1"), name(b"Name1"));
    assert_eq!(
        one(b"/A;Name_With-Various***Characters?"),
        name(b"A;Name_With-Various***Characters?")
    );
    assert_eq!(one(b"/1.2"), name(b"1.2"));
    assert_eq!(one(b"/Lime#20Green"), name(b"Lime Green"));
    assert_eq!(
        one(b"/paired#28#29parentheses"),
        name(b"paired()parentheses")
    );
    assert_eq!(one(b"/The_Key_of_F#23_Minor"), name(b"The_Key_of_F#_Minor"));
    // A `#` without two hex digits stays.
    assert_eq!(one(b"/A#zz"), name(b"A#zz"));
    assert_eq!(one(b"/A#4"), name(b"A#4"));
    assert_eq!(tokens(b"/"), [name(b"")]);
    assert_eq!(tokens(b"/Type/Page"), [name(b"Type"), name(b"Page")]);
}

#[test]
fn delimiters_keywords_and_comments() {
    assert_eq!(
        tokens(b"[1 R]<</A true>>{null} obj % comment ) ( \n endobj"),
        [
            Token::ArrayOpen,
            Token::Int(1),
            Token::Keyword(b"R"),
            Token::ArrayClose,
            Token::DictOpen,
            Token::Name(Name::new("A")),
            Token::Keyword(b"true"),
            Token::DictClose,
            Token::Brace(b'{'),
            Token::Keyword(b"null"),
            Token::Brace(b'}'),
            Token::Keyword(b"obj"),
            Token::Keyword(b"endobj"),
        ]
    );
    assert_eq!(
        tokens(b") > T* '"),
        [
            Token::Junk(b')'),
            Token::Junk(b'>'),
            Token::Keyword(b"T*"),
            Token::Keyword(b"'")
        ]
    );
    assert_eq!(tokens(b"%only a comment"), []);
    assert_eq!(tokens(b"\0\t\x0c\r\n "), []);
}

#[test]
fn positions() {
    let mut lexer = Lexer::new(b"  /A  (b)", 0);
    let a = lexer.next().unwrap();
    assert_eq!((a.start, a.end), (2, 4));
    let b = lexer.next().unwrap();
    assert_eq!((b.start, b.end), (6, 9));
    assert!(lexer.next().is_none());
}

#[test]
fn search() {
    assert_eq!(find(b"abcabc", b"bc", 0), Some(1));
    assert_eq!(find(b"abcabc", b"bc", 2), Some(4));
    assert_eq!(find(b"abcabc", b"bc", 5), None);
    assert_eq!(find(b"ab", b"abc", 0), None);
    assert_eq!(find(b"abc", b"", 0), None);
    assert_eq!(find(b"abc", b"c", 99), None);
    assert_eq!(rfind(b"abcabc", b"bc", usize::MAX), Some(4));
    assert_eq!(rfind(b"abcabc", b"bc", 4), Some(1));
    assert_eq!(rfind(b"ab", b"abc", usize::MAX), None);
}
