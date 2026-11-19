use super::*;

#[test]
fn reads_assignments_and_blocks_in_order() {
    let values = parse(
        "rust_packages=email documents\nskip_tests=false\nnotes<<EOF\nfirst line\nkey=not an assignment\nEOF\nlast=1\n",
    )
    .expect("parses");

    assert_eq!(
        values,
        vec![
            ("rust_packages".to_owned(), "email documents".to_owned()),
            ("skip_tests".to_owned(), "false".to_owned()),
            (
                "notes".to_owned(),
                "first line\nkey=not an assignment".to_owned()
            ),
            ("last".to_owned(), "1".to_owned()),
        ]
    );
}

#[test]
fn keeps_equals_signs_in_a_value_and_allows_an_empty_one() {
    let values = parse("BASH_ENV=/tmp/a=b\nEMPTY=\n").expect("parses");

    assert_eq!(
        values,
        vec![
            ("BASH_ENV".to_owned(), "/tmp/a=b".to_owned()),
            ("EMPTY".to_owned(), String::new()),
        ]
    );
}

#[test]
fn an_empty_file_holds_nothing() {
    assert_eq!(parse("").expect("parses"), vec![]);
}

#[test]
fn refuses_a_line_that_sets_nothing() {
    assert!(parse("just some words\n").is_err());
}

#[test]
fn refuses_a_block_that_is_never_closed() {
    assert!(parse("result<<EOF\nok\n").is_err());
    assert!(parse("result<<\nok\n").is_err());
}

#[test]
fn reads_an_empty_block() {
    assert_eq!(
        parse("result<<EOF\nEOF\n").expect("parses"),
        vec![("result".to_owned(), String::new())]
    );
}
