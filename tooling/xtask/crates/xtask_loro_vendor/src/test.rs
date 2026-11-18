use super::token_difference;
use quote::ToTokens;

fn tokens(source: &str) -> String {
    syn::parse_file(source)
        .unwrap()
        .into_token_stream()
        .to_string()
}

#[test]
fn whitespace_inside_a_literal_is_a_difference() {
    let upstream = tokens(r#"const A: &str = "a  b";"#);
    let vendor = tokens(r#"const A: &str = "a b";"#);
    let difference = token_difference(&upstream, &vendor).expect("literal bytes differ");
    assert!(difference.contains("inside a token"), "{difference}");
}

#[test]
fn formatting_and_comments_are_not_differences() {
    let upstream = tokens("fn f() { let x = 1; }");
    let vendor = tokens("// local note\nfn f() {\n    let x = 1;\n}");
    assert_eq!(token_difference(&upstream, &vendor), None);
}

#[test]
fn a_changed_token_reports_its_position() {
    let difference = token_difference(&tokens("fn f() -> u8 { 1 }"), &tokens("fn f() -> u8 { 2 }"))
        .expect("tokens differ");
    assert!(difference.starts_with("token "), "{difference}");
}
