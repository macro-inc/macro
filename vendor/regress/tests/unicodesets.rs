pub mod common;
use common::*;

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-01.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_01() {
    test_parse_fails_flags(r#"[(]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-02.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_02() {
    test_parse_fails_flags(r#"[)]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-03.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_03() {
    test_parse_fails_flags(r#"[[]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-04.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_04() {
    test_parse_fails_flags(r#"[{]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-05.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_05() {
    test_parse_fails_flags(r#"[}]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-06.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_06() {
    test_parse_fails_flags(r#"[/]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-07.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_07() {
    test_parse_fails_flags(r#"[-]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-08.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_08() {
    test_parse_fails_flags(r#"[|]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-09.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_09() {
    test_parse_fails_flags(r#"[&&]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-10.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_10() {
    test_parse_fails_flags(r#"[!!]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-11.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_11() {
    test_parse_fails_flags(r#"[##]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-12.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_12() {
    test_parse_fails_flags(r#"[$$]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-13.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_13() {
    test_parse_fails_flags(r#"[%%]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-14.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_14() {
    test_parse_fails_flags(r#"[**]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-15.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_15() {
    test_parse_fails_flags(r#"[++]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-16.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_16() {
    test_parse_fails_flags(r#"[,,]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-17.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_17() {
    test_parse_fails_flags(r#"[..]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-18.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_18() {
    test_parse_fails_flags(r#"[::]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-19.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_19() {
    test_parse_fails_flags(r#"[;;]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-20.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_20() {
    test_parse_fails_flags(r#"[<<]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-21.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_21() {
    test_parse_fails_flags(r#"[==]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-22.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_22() {
    test_parse_fails_flags(r#"[>>]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-23.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_23() {
    test_parse_fails_flags(r#"[??]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-24.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_24() {
    test_parse_fails_flags(r#"[@@]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-25.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_25() {
    test_parse_fails_flags(r#"[``]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-26.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_26() {
    test_parse_fails_flags(r#"[~~]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-27.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_27() {
    test_parse_fails_flags(r#"[^^^]"#, "v");
}

/// 262 test/built-ins/RegExp/prototype/unicodeSets/breaking-change-from-u-to-v-28.js
#[test]
fn unicode_sets_breaking_change_from_u_to_v_28() {
    test_parse_fails_flags(r#"[_^^]"#, "v");
}

fn test_unicode_sets_matches(tc: TestConfig, expression: &str, matches: &[&str], fails: &[&str]) {
    let cr = tc.compilef(expression, "v");
    for m in matches {
        cr.test_succeeds(m);
    }
    for f in fails {
        cr.test_fails(f);
    }
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/rgi-emoji-13.1.js
#[test]
fn unicode_sets_rgi_emoji_13_1() {
    const EXPRESSION: &str = "^\\p{RGI_Emoji}+$";
    const MATCHES: &[&str] = &[
        "\u{2764}\u{FE0F}\u{200D}\u{1F525}",
        "\u{2764}\u{FE0F}\u{200D}\u{1FA79}",
        "\u{1F468}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F468}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F468}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F468}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F468}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F468}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F468}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F468}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F468}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F468}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F468}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F468}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F468}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F468}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F468}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F468}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F468}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F468}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F468}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F468}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F468}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F468}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F468}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F468}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F468}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F468}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F468}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F468}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F468}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F468}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F468}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F468}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F468}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F468}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F468}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F468}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F468}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F468}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F468}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F468}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F468}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F468}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F468}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F468}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F468}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F468}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F468}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F468}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F468}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F468}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FB}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FC}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FD}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FE}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FF}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FB}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FC}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FD}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FE}",
        "\u{1F469}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FF}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FB}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FC}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FD}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FE}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FF}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FB}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FC}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FD}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FE}",
        "\u{1F469}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FF}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FB}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FC}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FD}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FE}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FF}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FB}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FC}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FD}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FE}",
        "\u{1F469}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FF}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FB}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FC}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FD}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FE}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FF}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FB}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FC}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FD}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FE}",
        "\u{1F469}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FF}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FB}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FC}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FD}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FE}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F469}\u{1F3FF}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FB}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FC}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FD}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FE}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F468}\u{1F3FF}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FB}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FC}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FD}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FE}",
        "\u{1F469}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F469}\u{1F3FF}",
        "\u{1F48F}\u{1F3FB}",
        "\u{1F48F}\u{1F3FC}",
        "\u{1F48F}\u{1F3FD}",
        "\u{1F48F}\u{1F3FE}",
        "\u{1F48F}\u{1F3FF}",
        "\u{1F491}\u{1F3FB}",
        "\u{1F491}\u{1F3FC}",
        "\u{1F491}\u{1F3FD}",
        "\u{1F491}\u{1F3FE}",
        "\u{1F491}\u{1F3FF}",
        "\u{1F62E}\u{200D}\u{1F4A8}",
        "\u{1F635}\u{200D}\u{1F4AB}",
        "\u{1F636}\u{200D}\u{1F32B}\u{FE0F}",
        "\u{1F9D1}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FC}",
        "\u{1F9D1}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FD}",
        "\u{1F9D1}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FE}",
        "\u{1F9D1}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FF}",
        "\u{1F9D1}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FC}",
        "\u{1F9D1}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FD}",
        "\u{1F9D1}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FE}",
        "\u{1F9D1}\u{1F3FB}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FF}",
        "\u{1F9D1}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FB}",
        "\u{1F9D1}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FD}",
        "\u{1F9D1}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FE}",
        "\u{1F9D1}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FF}",
        "\u{1F9D1}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FB}",
        "\u{1F9D1}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FD}",
        "\u{1F9D1}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FE}",
        "\u{1F9D1}\u{1F3FC}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FF}",
        "\u{1F9D1}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FB}",
        "\u{1F9D1}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FC}",
        "\u{1F9D1}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FE}",
        "\u{1F9D1}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FF}",
        "\u{1F9D1}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FB}",
        "\u{1F9D1}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FC}",
        "\u{1F9D1}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FE}",
        "\u{1F9D1}\u{1F3FD}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FF}",
        "\u{1F9D1}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FB}",
        "\u{1F9D1}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FC}",
        "\u{1F9D1}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FD}",
        "\u{1F9D1}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FF}",
        "\u{1F9D1}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FB}",
        "\u{1F9D1}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FC}",
        "\u{1F9D1}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FD}",
        "\u{1F9D1}\u{1F3FE}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FF}",
        "\u{1F9D1}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FB}",
        "\u{1F9D1}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FC}",
        "\u{1F9D1}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FD}",
        "\u{1F9D1}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F48B}\u{200D}\u{1F9D1}\u{1F3FE}",
        "\u{1F9D1}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FB}",
        "\u{1F9D1}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FC}",
        "\u{1F9D1}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FD}",
        "\u{1F9D1}\u{1F3FF}\u{200D}\u{2764}\u{FE0F}\u{200D}\u{1F9D1}\u{1F3FE}",
        "\u{1F9D4}\u{200D}\u{2640}\u{FE0F}",
        "\u{1F9D4}\u{200D}\u{2642}\u{FE0F}",
        "\u{1F9D4}\u{1F3FB}\u{200D}\u{2640}\u{FE0F}",
        "\u{1F9D4}\u{1F3FB}\u{200D}\u{2642}\u{FE0F}",
        "\u{1F9D4}\u{1F3FC}\u{200D}\u{2640}\u{FE0F}",
        "\u{1F9D4}\u{1F3FC}\u{200D}\u{2642}\u{FE0F}",
        "\u{1F9D4}\u{1F3FD}\u{200D}\u{2640}\u{FE0F}",
        "\u{1F9D4}\u{1F3FD}\u{200D}\u{2642}\u{FE0F}",
        "\u{1F9D4}\u{1F3FE}\u{200D}\u{2640}\u{FE0F}",
        "\u{1F9D4}\u{1F3FE}\u{200D}\u{2642}\u{FE0F}",
        "\u{1F9D4}\u{1F3FF}\u{200D}\u{2640}\u{FE0F}",
        "\u{1F9D4}\u{1F3FF}\u{200D}\u{2642}\u{FE0F}",
    ];
    const FAILS: &[&str] = &[];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/rgi-emoji-14.0.js
#[test]
fn unicode_sets_rgi_emoji_14_0() {
    const EXPRESSION: &str = "^\\p{RGI_Emoji}+$";
    const MATCHES: &[&str] = &[
        "\u{1F6DD}",
        "\u{1F6DE}",
        "\u{1F6DF}",
        "\u{1F7F0}",
        "\u{1F91D}\u{1F3FB}",
        "\u{1F91D}\u{1F3FC}",
        "\u{1F91D}\u{1F3FD}",
        "\u{1F91D}\u{1F3FE}",
        "\u{1F91D}\u{1F3FF}",
        "\u{1F979}",
        "\u{1F9CC}",
        "\u{1FA7B}",
        "\u{1FA7C}",
        "\u{1FAA9}",
        "\u{1FAAA}",
        "\u{1FAAB}",
        "\u{1FAAC}",
        "\u{1FAB7}",
        "\u{1FAB8}",
        "\u{1FAB9}",
        "\u{1FABA}",
        "\u{1FAC3}",
        "\u{1FAC3}\u{1F3FB}",
        "\u{1FAC3}\u{1F3FC}",
        "\u{1FAC3}\u{1F3FD}",
        "\u{1FAC3}\u{1F3FE}",
        "\u{1FAC3}\u{1F3FF}",
        "\u{1FAC4}",
        "\u{1FAC4}\u{1F3FB}",
        "\u{1FAC4}\u{1F3FC}",
        "\u{1FAC4}\u{1F3FD}",
        "\u{1FAC4}\u{1F3FE}",
        "\u{1FAC4}\u{1F3FF}",
        "\u{1FAC5}",
        "\u{1FAC5}\u{1F3FB}",
        "\u{1FAC5}\u{1F3FC}",
        "\u{1FAC5}\u{1F3FD}",
        "\u{1FAC5}\u{1F3FE}",
        "\u{1FAC5}\u{1F3FF}",
        "\u{1FAD7}",
        "\u{1FAD8}",
        "\u{1FAD9}",
        "\u{1FAE0}",
        "\u{1FAE1}",
        "\u{1FAE2}",
        "\u{1FAE3}",
        "\u{1FAE4}",
        "\u{1FAE5}",
        "\u{1FAE6}",
        "\u{1FAE7}",
        "\u{1FAF0}",
        "\u{1FAF0}\u{1F3FB}",
        "\u{1FAF0}\u{1F3FC}",
        "\u{1FAF0}\u{1F3FD}",
        "\u{1FAF0}\u{1F3FE}",
        "\u{1FAF0}\u{1F3FF}",
        "\u{1FAF1}",
        "\u{1FAF1}\u{1F3FB}",
        "\u{1FAF1}\u{1F3FB}\u{200D}\u{1FAF2}\u{1F3FC}",
        "\u{1FAF1}\u{1F3FB}\u{200D}\u{1FAF2}\u{1F3FD}",
        "\u{1FAF1}\u{1F3FB}\u{200D}\u{1FAF2}\u{1F3FE}",
        "\u{1FAF1}\u{1F3FB}\u{200D}\u{1FAF2}\u{1F3FF}",
        "\u{1FAF1}\u{1F3FC}",
        "\u{1FAF1}\u{1F3FC}\u{200D}\u{1FAF2}\u{1F3FB}",
        "\u{1FAF1}\u{1F3FC}\u{200D}\u{1FAF2}\u{1F3FD}",
        "\u{1FAF1}\u{1F3FC}\u{200D}\u{1FAF2}\u{1F3FE}",
        "\u{1FAF1}\u{1F3FC}\u{200D}\u{1FAF2}\u{1F3FF}",
        "\u{1FAF1}\u{1F3FD}",
        "\u{1FAF1}\u{1F3FD}\u{200D}\u{1FAF2}\u{1F3FB}",
        "\u{1FAF1}\u{1F3FD}\u{200D}\u{1FAF2}\u{1F3FC}",
        "\u{1FAF1}\u{1F3FD}\u{200D}\u{1FAF2}\u{1F3FE}",
        "\u{1FAF1}\u{1F3FD}\u{200D}\u{1FAF2}\u{1F3FF}",
        "\u{1FAF1}\u{1F3FE}",
        "\u{1FAF1}\u{1F3FE}\u{200D}\u{1FAF2}\u{1F3FB}",
        "\u{1FAF1}\u{1F3FE}\u{200D}\u{1FAF2}\u{1F3FC}",
        "\u{1FAF1}\u{1F3FE}\u{200D}\u{1FAF2}\u{1F3FD}",
        "\u{1FAF1}\u{1F3FE}\u{200D}\u{1FAF2}\u{1F3FF}",
        "\u{1FAF1}\u{1F3FF}",
        "\u{1FAF1}\u{1F3FF}\u{200D}\u{1FAF2}\u{1F3FB}",
        "\u{1FAF1}\u{1F3FF}\u{200D}\u{1FAF2}\u{1F3FC}",
        "\u{1FAF1}\u{1F3FF}\u{200D}\u{1FAF2}\u{1F3FD}",
        "\u{1FAF1}\u{1F3FF}\u{200D}\u{1FAF2}\u{1F3FE}",
        "\u{1FAF2}",
        "\u{1FAF2}\u{1F3FB}",
        "\u{1FAF2}\u{1F3FC}",
        "\u{1FAF2}\u{1F3FD}",
        "\u{1FAF2}\u{1F3FE}",
        "\u{1FAF2}\u{1F3FF}",
        "\u{1FAF3}",
        "\u{1FAF3}\u{1F3FB}",
        "\u{1FAF3}\u{1F3FC}",
        "\u{1FAF3}\u{1F3FD}",
        "\u{1FAF3}\u{1F3FE}",
        "\u{1FAF3}\u{1F3FF}",
        "\u{1FAF4}",
        "\u{1FAF4}\u{1F3FB}",
        "\u{1FAF4}\u{1F3FC}",
        "\u{1FAF4}\u{1F3FD}",
        "\u{1FAF4}\u{1F3FE}",
        "\u{1FAF4}\u{1F3FF}",
        "\u{1FAF5}",
        "\u{1FAF5}\u{1F3FB}",
        "\u{1FAF5}\u{1F3FC}",
        "\u{1FAF5}\u{1F3FD}",
        "\u{1FAF5}\u{1F3FE}",
        "\u{1FAF5}\u{1F3FF}",
        "\u{1FAF6}",
        "\u{1FAF6}\u{1F3FB}",
        "\u{1FAF6}\u{1F3FC}",
        "\u{1FAF6}\u{1F3FD}",
        "\u{1FAF6}\u{1F3FE}",
        "\u{1FAF6}\u{1F3FF}",
    ];
    const FAILS: &[&str] = &[];
    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-union-character-class-escape.js
#[test]
fn unicode_sets_character_property_escape_union_character_class_escape() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}\\d]+$";
    const MATCHES: &[&str] = &[
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "a", "b",
        "c", "d", "e", "f",
    ];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-intersection-character-class.js
#[test]
fn unicode_sets_character_intersection_character_class() {
    const EXPRESSION: &str = "^[_&&[0-9]]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "_",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-union-character-property-escape.js
#[test]
fn unicode_sets_character_class_union_character_property_escape() {
    const EXPRESSION: &str = "^[[0-9]\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &[
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "a", "b",
        "c", "d", "e", "f",
    ];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-intersection-character-class-escape.js
#[test]
fn unicode_sets_character_class_escape_intersection_character_class_escape() {
    const EXPRESSION: &str = "^[\\d&&\\d]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-intersection-character.js
#[test]
fn unicode_sets_character_class_escape_intersection_character() {
    const EXPRESSION: &str = "^[\\d&&_]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-difference-character-property-escape.js
#[test]
fn unicode_sets_character_difference_character_property_escape() {
    const EXPRESSION: &str = "^[_--\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &["_"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-intersection-character.js
#[test]
fn unicode_sets_string_literal_intersection_character() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}&&_]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "0",
        "2",
        "4",
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-difference-character-property-escape.js
#[test]
fn unicode_sets_character_class_escape_difference_character_property_escape() {
    const EXPRESSION: &str = "^[\\d--\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-intersection-string-literal.js
#[test]
fn unicode_sets_character_class_intersection_string_literal() {
    const EXPRESSION: &str = "^[[0-9]&&\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &["0", "2", "4"];
    const FAILS: &[&str] = &[
        "1",
        "3",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-intersection-character-class.js
#[test]
fn unicode_sets_string_literal_intersection_character_class() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}&&[0-9]]+$";
    const MATCHES: &[&str] = &["0", "2", "4"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-difference-character-class-escape.js
#[test]
fn unicode_sets_property_of_strings_escape_difference_character_class_escape() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}--\\d]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &["7", "C", "\u{2603}", "\u{1D306}", "\u{1F1E7}\u{1F1EA}"];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-difference-character-class-escape.js
#[test]
fn unicode_sets_string_literal_difference_character_class_escape() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}--\\d]+$";
    const MATCHES: &[&str] = &["9\u{FE0F}\u{20E3}"];
    const FAILS: &[&str] = &[
        "0",
        "2",
        "4",
        "6\u{FE0F}\u{20E3}",
        "7",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-difference-character.js
#[test]
fn unicode_sets_string_literal_difference_character() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}--_]+$";
    const MATCHES: &[&str] = &["0", "2", "4", "9\u{FE0F}\u{20E3}"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-intersection-string-literal.js
#[test]
fn unicode_sets_character_class_escape_intersection_string_literal() {
    const EXPRESSION: &str = "^[\\d&&\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &["0", "2", "4"];
    const FAILS: &[&str] = &[
        "1",
        "3",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-difference-string-literal.js
#[test]
fn unicode_sets_character_class_difference_string_literal() {
    const EXPRESSION: &str = "^[[0-9]--\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &["1", "3", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "0",
        "2",
        "4",
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];
    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-intersection-character-class-escape.js
#[test]
fn unicode_sets_property_of_strings_escape_intersection_character_class_escape() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}&&\\d]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-difference-character-class.js
#[test]
fn unicode_sets_character_property_escape_difference_character_class() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}--[0-9]]+$";
    const MATCHES: &[&str] = &["A", "B", "C", "D", "E", "F", "a", "b", "c", "d", "e", "f"];
    const FAILS: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-difference-string-literal.js
#[test]
fn unicode_sets_character_difference_string_literal() {
    const EXPRESSION: &str = "^[_--\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &["_"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-difference-string-literal.js
#[test]
fn unicode_sets_property_of_strings_escape_difference_string_literal() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}--\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &[
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-intersection-string-literal.js
#[test]
fn unicode_sets_property_of_strings_escape_intersection_string_literal() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}&&\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &["9\u{FE0F}\u{20E3}"];
    const FAILS: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-difference-property-of-strings-escape.js
#[test]
fn unicode_sets_string_literal_difference_property_of_strings_escape() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}--\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &["0", "2", "4"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-union-character-class.js
#[test]
fn unicode_sets_character_class_union_character_class() {
    const EXPRESSION: &str = "^[[0-9][0-9]]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-difference-string-literal.js
#[test]
fn unicode_sets_character_class_escape_difference_string_literal() {
    const EXPRESSION: &str = "^[\\d--\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &["1", "3", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "0",
        "2",
        "4",
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];
    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-difference-property-of-strings-escape.js
#[test]
fn unicode_sets_character_property_escape_difference_property_of_strings_escape() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}--\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &[
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "a", "b",
        "c", "d", "e", "f",
    ];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-difference-property-of-strings-escape.js
#[test]
fn unicode_sets_property_of_strings_escape_difference_property_of_strings_escape() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}--\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-union-property-of-strings-escape.js
#[test]
fn unicode_sets_character_union_property_of_strings_escape() {
    const EXPRESSION: &str = "^[_\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "_",
    ];
    const FAILS: &[&str] = &["7", "C", "\u{2603}", "\u{1D306}", "\u{1F1E7}\u{1F1EA}"];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-union-string-literal.js
#[test]
fn unicode_sets_character_class_escape_union_string_literal() {
    const EXPRESSION: &str = "^[\\d\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-union-character-property-escape.js
#[test]
fn unicode_sets_character_class_escape_union_character_property_escape() {
    const EXPRESSION: &str = "^[\\d\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &[
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "a", "b",
        "c", "d", "e", "f",
    ];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-union-character-class.js
#[test]
fn unicode_sets_property_of_strings_escape_union_character_class() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}[0-9]]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0",
        "0\u{FE0F}\u{20E3}",
        "1",
        "1\u{FE0F}\u{20E3}",
        "2",
        "2\u{FE0F}\u{20E3}",
        "3",
        "3\u{FE0F}\u{20E3}",
        "4",
        "4\u{FE0F}\u{20E3}",
        "5",
        "5\u{FE0F}\u{20E3}",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "7\u{FE0F}\u{20E3}",
        "8",
        "8\u{FE0F}\u{20E3}",
        "9",
        "9\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &["C", "\u{2603}", "\u{1D306}", "\u{1F1E7}\u{1F1EA}"];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-difference-string-literal.js
#[test]
fn unicode_sets_character_property_escape_difference_string_literal() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}--\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &[
        "1", "3", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "a", "b", "c", "d", "e",
        "f",
    ];
    const FAILS: &[&str] = &[
        "0",
        "2",
        "4",
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];
    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-union-character-property-escape.js
#[test]
fn unicode_sets_string_literal_union_character_property_escape() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
    ];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-union-character-property-escape.js
#[test]
fn unicode_sets_property_of_strings_escape_union_character_property_escape() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0",
        "0\u{FE0F}\u{20E3}",
        "1",
        "1\u{FE0F}\u{20E3}",
        "2",
        "2\u{FE0F}\u{20E3}",
        "3",
        "3\u{FE0F}\u{20E3}",
        "4",
        "4\u{FE0F}\u{20E3}",
        "5",
        "5\u{FE0F}\u{20E3}",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "7\u{FE0F}\u{20E3}",
        "8",
        "8\u{FE0F}\u{20E3}",
        "9",
        "9\u{FE0F}\u{20E3}",
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
    ];
    const FAILS: &[&str] = &["\u{2603}", "\u{1D306}", "\u{1F1E7}\u{1F1EA}"];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-intersection-character.js
#[test]
fn unicode_sets_character_intersection_character() {
    const EXPRESSION: &str = "^[_&&_]+$";
    const MATCHES: &[&str] = &["_"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-intersection-character-property-escape.js
#[test]
fn unicode_sets_character_intersection_character_property_escape() {
    const EXPRESSION: &str = "^[_&&\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "_",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-union-character-property-escape.js
#[test]
fn unicode_sets_character_union_character_property_escape() {
    const EXPRESSION: &str = "^[_\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &[
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "_", "a",
        "b", "c", "d", "e", "f",
    ];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-union-string-literal.js
#[test]
fn unicode_sets_character_class_union_string_literal() {
    const EXPRESSION: &str = "^[[0-9]\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-union-character-class-escape.js
#[test]
fn unicode_sets_character_class_escape_union_character_class_escape() {
    const EXPRESSION: &str = "^[\\d\\d]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-intersection-character.js
#[test]
fn unicode_sets_property_of_strings_escape_intersection_character() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}&&_]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-intersection-character-class.js
#[test]
fn unicode_sets_character_class_intersection_character_class() {
    const EXPRESSION: &str = "^[[0-9]&&[0-9]]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-intersection-character-class-escape.js
#[test]
fn unicode_sets_character_property_escape_intersection_character_class_escape() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}&&\\d]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-difference-string-literal.js
#[test]
fn unicode_sets_string_literal_difference_string_literal() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}--\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "0",
        "2",
        "4",
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-intersection-character.js
#[test]
fn unicode_sets_character_property_escape_intersection_character() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}&&_]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-union-character-class.js
#[test]
fn unicode_sets_string_literal_union_character_class() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}[0-9]]+$";
    const MATCHES: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-union-property-of-strings-escape.js
#[test]
fn unicode_sets_property_of_strings_escape_union_property_of_strings_escape() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &["7", "C", "\u{2603}", "\u{1D306}", "\u{1F1E7}\u{1F1EA}"];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-union-string-literal.js
#[test]
fn unicode_sets_character_union_string_literal() {
    const EXPRESSION: &str = "^[_\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &["0", "2", "4", "9\u{FE0F}\u{20E3}", "_"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-union-string-literal.js
#[test]
fn unicode_sets_string_literal_union_string_literal() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &["0", "2", "4", "9\u{FE0F}\u{20E3}"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-intersection-character-class.js
#[test]
fn unicode_sets_character_property_escape_intersection_character_class() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}&&[0-9]]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-intersection-character-class.js
#[test]
fn unicode_sets_character_class_escape_intersection_character_class() {
    const EXPRESSION: &str = "^[\\d&&[0-9]]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-difference-character.js
#[test]
fn unicode_sets_property_of_strings_escape_difference_character() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}--_]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &["7", "C", "\u{2603}", "\u{1D306}", "\u{1F1E7}\u{1F1EA}"];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-intersection-string-literal.js
#[test]
fn unicode_sets_character_intersection_string_literal() {
    const EXPRESSION: &str = "^[_&&\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "_",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-difference-property-of-strings-escape.js
#[test]
fn unicode_sets_character_class_escape_difference_property_of_strings_escape() {
    const EXPRESSION: &str = "^[\\d--\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-union-character-class-escape.js
#[test]
fn unicode_sets_character_class_union_character_class_escape() {
    const EXPRESSION: &str = "^[[0-9]\\d]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-union-character-property-escape.js
#[test]
fn unicode_sets_character_property_escape_union_character_property_escape() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &[
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "a", "b",
        "c", "d", "e", "f",
    ];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-union-character.js
#[test]
fn unicode_sets_property_of_strings_escape_union_character() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}_]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "_",
    ];
    const FAILS: &[&str] = &["7", "C", "\u{2603}", "\u{1D306}", "\u{1F1E7}\u{1F1EA}"];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-union-character-class-escape.js
#[test]
fn unicode_sets_property_of_strings_escape_union_character_class_escape() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}\\d]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0",
        "0\u{FE0F}\u{20E3}",
        "1",
        "1\u{FE0F}\u{20E3}",
        "2",
        "2\u{FE0F}\u{20E3}",
        "3",
        "3\u{FE0F}\u{20E3}",
        "4",
        "4\u{FE0F}\u{20E3}",
        "5",
        "5\u{FE0F}\u{20E3}",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "7\u{FE0F}\u{20E3}",
        "8",
        "8\u{FE0F}\u{20E3}",
        "9",
        "9\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &["C", "\u{2603}", "\u{1D306}", "\u{1F1E7}\u{1F1EA}"];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-intersection-character-property-escape.js
#[test]
fn unicode_sets_character_class_intersection_character_property_escape() {
    const EXPRESSION: &str = "^[[0-9]&&\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-union-character.js
#[test]
fn unicode_sets_character_class_escape_union_character() {
    const EXPRESSION: &str = "^[\\d_]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "_"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-difference-character-class-escape.js
#[test]
fn unicode_sets_character_class_difference_character_class_escape() {
    const EXPRESSION: &str = "^[[0-9]--\\d]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-intersection-character-class.js
#[test]
fn unicode_sets_property_of_strings_escape_intersection_character_class() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}&&[0-9]]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-intersection-string-literal.js
#[test]
fn unicode_sets_string_literal_intersection_string_literal() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}&&\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-union-string-literal.js
#[test]
fn unicode_sets_character_property_escape_union_string_literal() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
    ];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-difference-property-of-strings-escape.js
#[test]
fn unicode_sets_character_class_difference_property_of_strings_escape() {
    const EXPRESSION: &str = "^[[0-9]--\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-difference-character-property-escape.js
#[test]
fn unicode_sets_character_class_difference_character_property_escape() {
    const EXPRESSION: &str = "^[[0-9]--\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-difference-character.js
#[test]
fn unicode_sets_character_class_difference_character() {
    const EXPRESSION: &str = "^[[0-9]--_]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-difference-character-property-escape.js
#[test]
fn unicode_sets_string_literal_difference_character_property_escape() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}--\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &["9\u{FE0F}\u{20E3}"];
    const FAILS: &[&str] = &[
        "0",
        "2",
        "4",
        "6\u{FE0F}\u{20E3}",
        "7",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-union-property-of-strings-escape.js
#[test]
fn unicode_sets_character_class_escape_union_property_of_strings_escape() {
    const EXPRESSION: &str = "^[\\d\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0",
        "0\u{FE0F}\u{20E3}",
        "1",
        "1\u{FE0F}\u{20E3}",
        "2",
        "2\u{FE0F}\u{20E3}",
        "3",
        "3\u{FE0F}\u{20E3}",
        "4",
        "4\u{FE0F}\u{20E3}",
        "5",
        "5\u{FE0F}\u{20E3}",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "7\u{FE0F}\u{20E3}",
        "8",
        "8\u{FE0F}\u{20E3}",
        "9",
        "9\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &["C", "\u{2603}", "\u{1D306}", "\u{1F1E7}\u{1F1EA}"];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-intersection-character-class-escape.js
#[test]
fn unicode_sets_character_class_intersection_character_class_escape() {
    const EXPRESSION: &str = "^[[0-9]&&\\d]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-difference-character.js
#[test]
fn unicode_sets_character_difference_character() {
    const EXPRESSION: &str = "^[_--_]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "_",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-difference-character-property-escape.js
#[test]
fn unicode_sets_character_property_escape_difference_character_property_escape() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}--\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-union-character-class-escape.js
#[test]
fn unicode_sets_string_literal_union_character_class_escape() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}\\d]+$";
    const MATCHES: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-union-character-class.js
#[test]
fn unicode_sets_character_property_escape_union_character_class() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}[0-9]]+$";
    const MATCHES: &[&str] = &[
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "a", "b",
        "c", "d", "e", "f",
    ];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-union-property-of-strings-escape.js
#[test]
fn unicode_sets_string_literal_union_property_of_strings_escape() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &["7", "C", "\u{2603}", "\u{1D306}", "\u{1F1E7}\u{1F1EA}"];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-union-character.js
#[test]
fn unicode_sets_string_literal_union_character() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}_]+$";
    const MATCHES: &[&str] = &["0", "2", "4", "9\u{FE0F}\u{20E3}", "_"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-difference-character.js
#[test]
fn unicode_sets_character_property_escape_difference_character() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}--_]+$";
    const MATCHES: &[&str] = &[
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "a", "b",
        "c", "d", "e", "f",
    ];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/rgi-emoji-15.0.js
#[test]
fn unicode_sets_rgi_emoji_15_0() {
    const EXPRESSION: &str = "^\\p{RGI_Emoji}+$";
    const MATCHES: &[&str] = &[
        "\u{1F426}\u{200D}\u{2B1B}",
        "\u{1F6DC}",
        "\u{1FA75}",
        "\u{1FA76}",
        "\u{1FA77}",
        "\u{1FA87}",
        "\u{1FA88}",
        "\u{1FAAD}",
        "\u{1FAAE}",
        "\u{1FAAF}",
        "\u{1FABB}",
        "\u{1FABC}",
        "\u{1FABD}",
        "\u{1FABF}",
        "\u{1FACE}",
        "\u{1FACF}",
        "\u{1FADA}",
        "\u{1FADB}",
        "\u{1FAE8}",
        "\u{1FAF7}",
        "\u{1FAF7}\u{1F3FB}",
        "\u{1FAF7}\u{1F3FC}",
        "\u{1FAF7}\u{1F3FD}",
        "\u{1FAF7}\u{1F3FE}",
        "\u{1FAF7}\u{1F3FF}",
        "\u{1FAF8}",
        "\u{1FAF8}\u{1F3FB}",
        "\u{1FAF8}\u{1F3FC}",
        "\u{1FAF8}\u{1F3FD}",
        "\u{1FAF8}\u{1F3FE}",
        "\u{1FAF8}\u{1F3FF}",
    ];
    const FAILS: &[&str] = &[];
    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-intersection-string-literal.js
#[test]
fn unicode_sets_character_property_escape_intersection_string_literal() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}&&\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &["0", "2", "4"];
    const FAILS: &[&str] = &[
        "1",
        "3",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-difference-character-class.js
#[test]
fn unicode_sets_character_class_difference_character_class() {
    const EXPRESSION: &str = "^[[0-9]--[0-9]]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-intersection-property-of-strings-escape.js
#[test]
fn unicode_sets_character_class_escape_intersection_property_of_strings_escape() {
    const EXPRESSION: &str = "^[\\d&&\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-intersection-property-of-strings-escape.js
#[test]
fn unicode_sets_character_property_escape_intersection_property_of_strings_escape() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}&&\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-difference-character-class.js
#[test]
fn unicode_sets_character_class_escape_difference_character_class() {
    const EXPRESSION: &str = "^[\\d--[0-9]]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-difference-character-class.js
#[test]
fn unicode_sets_string_literal_difference_character_class() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}--[0-9]]+$";
    const MATCHES: &[&str] = &["9\u{FE0F}\u{20E3}"];
    const FAILS: &[&str] = &[
        "0",
        "2",
        "4",
        "6\u{FE0F}\u{20E3}",
        "7",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-intersection-character-property-escape.js
#[test]
fn unicode_sets_string_literal_intersection_character_property_escape() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}&&\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &["0", "2", "4"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-difference-property-of-strings-escape.js
#[test]
fn unicode_sets_character_difference_property_of_strings_escape() {
    const EXPRESSION: &str = "^[_--\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &["_"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-intersection-character-class-escape.js
#[test]
fn unicode_sets_string_literal_intersection_character_class_escape() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}&&\\d]+$";
    const MATCHES: &[&str] = &["0", "2", "4"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-union-character-class.js
#[test]
fn unicode_sets_character_class_escape_union_character_class() {
    const EXPRESSION: &str = "^[\\d[0-9]]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-union-character.js
#[test]
fn unicode_sets_character_class_union_character() {
    const EXPRESSION: &str = "^[[0-9]_]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "_"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-difference-character-class.js
#[test]
fn unicode_sets_property_of_strings_escape_difference_character_class() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}--[0-9]]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &["7", "C", "\u{2603}", "\u{1D306}", "\u{1F1E7}\u{1F1EA}"];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-union-character.js
#[test]
fn unicode_sets_character_union_character() {
    const EXPRESSION: &str = "^[__]+$";
    const MATCHES: &[&str] = &["_"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-union-property-of-strings-escape.js
#[test]
fn unicode_sets_character_class_union_property_of_strings_escape() {
    const EXPRESSION: &str = "^[[0-9]\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0",
        "0\u{FE0F}\u{20E3}",
        "1",
        "1\u{FE0F}\u{20E3}",
        "2",
        "2\u{FE0F}\u{20E3}",
        "3",
        "3\u{FE0F}\u{20E3}",
        "4",
        "4\u{FE0F}\u{20E3}",
        "5",
        "5\u{FE0F}\u{20E3}",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "7\u{FE0F}\u{20E3}",
        "8",
        "8\u{FE0F}\u{20E3}",
        "9",
        "9\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &["C", "\u{2603}", "\u{1D306}", "\u{1F1E7}\u{1F1EA}"];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-intersection-character-property-escape.js
#[test]
fn unicode_sets_character_property_escape_intersection_character_property_escape() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}&&\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &[
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "a", "b",
        "c", "d", "e", "f",
    ];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-difference-character-property-escape.js
#[test]
fn unicode_sets_property_of_strings_escape_difference_character_property_escape() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}--\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &["7", "C", "\u{2603}", "\u{1D306}", "\u{1F1E7}\u{1F1EA}"];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-intersection-property-of-strings-escape.js
#[test]
fn unicode_sets_character_intersection_property_of_strings_escape() {
    const EXPRESSION: &str = "^[_&&\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "_",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-union-character.js
#[test]
fn unicode_sets_character_property_escape_union_character() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}_]+$";
    const MATCHES: &[&str] = &[
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "_", "a",
        "b", "c", "d", "e", "f",
    ];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-difference-character.js
#[test]
fn unicode_sets_character_class_escape_difference_character() {
    const EXPRESSION: &str = "^[\\d--_]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-intersection-character.js
#[test]
fn unicode_sets_character_class_intersection_character() {
    const EXPRESSION: &str = "^[[0-9]&&_]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-union-character-class.js
#[test]
fn unicode_sets_character_union_character_class() {
    const EXPRESSION: &str = "^[_[0-9]]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "_"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-union-property-of-strings-escape.js
#[test]
fn unicode_sets_character_property_escape_union_property_of_strings_escape() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0",
        "0\u{FE0F}\u{20E3}",
        "1",
        "1\u{FE0F}\u{20E3}",
        "2",
        "2\u{FE0F}\u{20E3}",
        "3",
        "3\u{FE0F}\u{20E3}",
        "4",
        "4\u{FE0F}\u{20E3}",
        "5",
        "5\u{FE0F}\u{20E3}",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "7\u{FE0F}\u{20E3}",
        "8",
        "8\u{FE0F}\u{20E3}",
        "9",
        "9\u{FE0F}\u{20E3}",
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
    ];
    const FAILS: &[&str] = &["\u{2603}", "\u{1D306}", "\u{1F1E7}\u{1F1EA}"];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-intersection-character-class-escape.js
#[test]
fn unicode_sets_character_intersection_character_class_escape() {
    const EXPRESSION: &str = "^[_&&\\d]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "_",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-property-escape-difference-character-class-escape.js
#[test]
fn unicode_sets_character_property_escape_difference_character_class_escape() {
    const EXPRESSION: &str = "^[\\p{ASCII_Hex_Digit}--\\d]+$";
    const MATCHES: &[&str] = &["A", "B", "C", "D", "E", "F", "a", "b", "c", "d", "e", "f"];
    const FAILS: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-intersection-character-property-escape.js
#[test]
fn unicode_sets_character_class_escape_intersection_character_property_escape() {
    const EXPRESSION: &str = "^[\\d&&\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-intersection-property-of-strings-escape.js
#[test]
fn unicode_sets_property_of_strings_escape_intersection_property_of_strings_escape() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}&&\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &["7", "C", "\u{2603}", "\u{1D306}", "\u{1F1E7}\u{1F1EA}"];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-escape-difference-character-class-escape.js
#[test]
fn unicode_sets_character_class_escape_difference_character_class_escape() {
    const EXPRESSION: &str = "^[\\d--\\d]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-class-intersection-property-of-strings-escape.js
#[test]
fn unicode_sets_character_class_intersection_property_of_strings_escape() {
    const EXPRESSION: &str = "^[[0-9]&&\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "6\u{FE0F}\u{20E3}",
        "7",
        "8",
        "9",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-union-character-class-escape.js
#[test]
fn unicode_sets_character_union_character_class_escape() {
    const EXPRESSION: &str = "^[_\\d]+$";
    const MATCHES: &[&str] = &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "_"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-difference-character-class.js
#[test]
fn unicode_sets_character_difference_character_class() {
    const EXPRESSION: &str = "^[_--[0-9]]+$";
    const MATCHES: &[&str] = &["_"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/string-literal-intersection-property-of-strings-escape.js
#[test]
fn unicode_sets_string_literal_intersection_property_of_strings_escape() {
    const EXPRESSION: &str = "^[\\q{0|2|4|9\u{FE0F}\u{20E3}}&&\\p{Emoji_Keycap_Sequence}]+$";
    const MATCHES: &[&str] = &["9\u{FE0F}\u{20E3}"];
    const FAILS: &[&str] = &[
        "0",
        "2",
        "4",
        "6\u{FE0F}\u{20E3}",
        "7",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/character-difference-character-class-escape.js
#[test]
fn unicode_sets_character_difference_character_class_escape() {
    const EXPRESSION: &str = "^[_--\\d]+$";
    const MATCHES: &[&str] = &["_"];
    const FAILS: &[&str] = &[
        "6\u{FE0F}\u{20E3}",
        "7",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-intersection-character-property-escape.js
#[test]
fn unicode_sets_property_of_strings_escape_intersection_character_property_escape() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}&&\\p{ASCII_Hex_Digit}]+$";
    const MATCHES: &[&str] = &[];
    const FAILS: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
        "C",
        "\u{2603}",
        "\u{1D306}",
        "\u{1F1E7}\u{1F1EA}",
    ];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

/// 262 test/built-ins/RegExp/unicodeSets/generated/property-of-strings-escape-union-string-literal.js
#[test]
fn unicode_sets_property_of_strings_escape_union_string_literal() {
    const EXPRESSION: &str = "^[\\p{Emoji_Keycap_Sequence}\\q{0|2|4|9\u{FE0F}\u{20E3}}]+$";
    const MATCHES: &[&str] = &[
        "#\u{FE0F}\u{20E3}",
        "*\u{FE0F}\u{20E3}",
        "0",
        "0\u{FE0F}\u{20E3}",
        "1\u{FE0F}\u{20E3}",
        "2",
        "2\u{FE0F}\u{20E3}",
        "3\u{FE0F}\u{20E3}",
        "4",
        "4\u{FE0F}\u{20E3}",
        "5\u{FE0F}\u{20E3}",
        "6\u{FE0F}\u{20E3}",
        "7\u{FE0F}\u{20E3}",
        "8\u{FE0F}\u{20E3}",
        "9\u{FE0F}\u{20E3}",
    ];
    const FAILS: &[&str] = &["7", "C", "\u{2603}", "\u{1D306}", "\u{1F1E7}\u{1F1EA}"];

    test_with_configs_no_ascii(|tc| test_unicode_sets_matches(tc, EXPRESSION, MATCHES, FAILS));
}

#[test]
fn unicode_sets_invalid_patterns() {
    test_parse_fails_flags(r#"[ab--c]"#, "v");
    test_parse_fails_flags(r#"[a--bc]"#, "v");
    test_parse_fails_flags(r#"[ab&&c]"#, "v");
    test_parse_fails_flags(r#"[a&&bc]"#, "v");
}

#[test]
fn test_unicode_sets_intersection() {
    test_with_configs_no_ascii(test_unicode_sets_intersection_tc)
}

fn test_unicode_sets_intersection_tc(tc: TestConfig) {
    tc.test_match_succeeds(r"^[\q{a}]$", "v", "a");
    tc.test_match_succeeds(r"^[\q{a}&&\q{a}]$", "v", "a");
    tc.test_match_fails(r"^[\q{a}&&\q{b}]$", "v", "a");
    tc.test_match_fails(r"^[\q{a}&&\q{b}&&\q{a}]$", "v", "a");
    tc.test_match_succeeds(r"^[\q{ab}]$", "v", "ab");
    tc.test_match_succeeds(r"^[\q{ab}&&\q{ab}]$", "v", "ab");
    tc.test_match_fails(r"^[\q{ab}&&\q{bc}]$", "v", "ab");
    tc.test_match_fails(r"^[\q{ab}&&\q{bc}&&\q{ab}]$", "v", "ab");
    tc.test_match_succeeds(r"^[\q{ab|bc}&&\q{ab}]$", "v", "ab");
    tc.test_match_fails(r"^[\q{ab|bc}&&\q{ab}&&\q{bc}]$", "v", "ab");
    tc.test_match_fails(r"^[\q{ab|bc}&&\q{ab}&&\q{bc}]$", "v", "bc");
    tc.test_match_succeeds(r"^[\q{a}&&a]$", "v", "a");
    tc.test_match_fails(r"^[\q{a}&&b]$", "v", "a");
    tc.test_match_fails(r"^[\q{a}&&b]$", "v", "b");
    tc.test_match_fails(r"^[\q{ab}&&b]$", "v", "ab");
    tc.test_match_fails(r"^[\q{ab}&&b]$", "v", "b");
    tc.test_match_succeeds(r"^[\q{ab}c]$", "v", "ab");
    tc.test_match_succeeds(r"^[\q{ab}c]$", "v", "c");
}

#[test]
fn test_unicode_sets_subtraction() {
    test_with_configs_no_ascii(test_unicode_sets_subtraction_tc)
}

fn test_unicode_sets_subtraction_tc(tc: TestConfig) {
    tc.test_match_succeeds(r"^[\q{a|b}--a]$", "v", "b");
    tc.test_match_fails(r"^[\q{a|b}--a]$", "v", "a");
    tc.test_match_succeeds(r"^[\q{a|b}--\q{a|c}]$", "v", "b");
    tc.test_match_fails(r"^[\q{a|b}--\q{a|c}]$", "v", "a");
    tc.test_match_fails(r"^[\q{a|b}--\q{a|c}]$", "v", "c");
    tc.test_match_fails(r"^[a--\q{a|b}]+$", "v", "a");
    tc.test_match_fails(r"^[a--\q{a|b}]+$", "v", "b");
    tc.test_match_fails(r"^[c--\q{a|b}]+$", "v", "a");
    tc.test_match_fails(r"^[c--\q{a|b}]+$", "v", "b");
    tc.test_match_succeeds(r"^[c--\q{a|b}]+$", "v", "c");
}

#[test]
fn test_unicode_sets_nested_class() {
    test_with_configs_no_ascii(test_unicode_sets_nested_class_tc)
}

fn test_unicode_sets_nested_class_tc(tc: TestConfig) {
    tc.test_match_succeeds(r"^[[ab]]$", "v", "a");
    tc.test_match_succeeds(r"^[[ab]]$", "v", "b");
    tc.test_match_succeeds(r"^[[ab][c]]$", "v", "a");
    tc.test_match_succeeds(r"^[[ab][c]]$", "v", "b");
    tc.test_match_succeeds(r"^[[ab][c]]$", "v", "c");
    tc.test_match_succeeds(r"^[[\q{a|b}]]$", "v", "a");
    tc.test_match_succeeds(r"^[[\q{a|b}]]$", "v", "b");
    tc.test_match_succeeds(r"^[[ab][\q{abc}]]$", "v", "a");
    tc.test_match_succeeds(r"^[[ab][\q{abc}]]$", "v", "b");
    tc.test_match_succeeds(r"^[[ab][\q{abc}]]$", "v", "abc");
    tc.test_match_fails(r"^[[ab][\q{abc}]]$", "v", "ab");
    tc.test_match_fails(r"^[[ab][\q{abc}]]$", "v", "bc");
    tc.test_match_fails(r"^[[ab][\q{abc}]]$", "v", "c");
    tc.test_match_fails(r"^[[\q{a|b}]--[\q{a}]]$", "v", "a");
    tc.test_match_succeeds(r"^[[\q{a|b}]--[\q{a}]]$", "v", "b");
    tc.test_match_succeeds(r"^[[\q{abc}ab]--a]$", "v", "abc");
    tc.test_match_succeeds(r"^[[\q{abc}ab]--a]$", "v", "b");
    tc.test_match_fails(r"^[[\q{abc}ab]--a]$", "v", "a");
    tc.test_match_fails(r"^[[\q{abc}ab]&&a]$", "v", "abc");
    tc.test_match_fails(r"^[[\q{abc}ab]&&a]$", "v", "b");
    tc.test_match_succeeds(r"^[[\q{abc}ab]&&a]$", "v", "a");
    tc.test_match_fails(r"^[a&&[\q{abc}ab]]$", "v", "abc");
    tc.test_match_fails(r"^[a&&[\q{abc}ab]]$", "v", "b");
    tc.test_match_succeeds(r"^[a&&[\q{abc}ab]]$", "v", "a");
    tc.test_match_succeeds(r"^[[\q{a|b}]&&[\q{abc}ab]]$", "v", "a");
    tc.test_match_succeeds(r"^[[\q{a|b}]&&[\q{abc}ab]]$", "v", "b");
    tc.test_match_fails(r"^[[\q{a|b}]&&[\q{abc}ab]]$", "v", "abc");
    tc.test_match_succeeds(r"^[[0-9]&&\q{0|2|4}]$", "v", "0");
    tc.test_match_succeeds(r"^[[0-9]&&\q{0|2|4}]$", "v", "2");
    tc.test_match_succeeds(r"^[[0-9]&&\q{0|2|4}]$", "v", "4");
}

#[test]
fn test_stuff() {
    test_with_configs(test_stuff_tc)
}

fn test_stuff_tc(tc: TestConfig) {
    let r = tc.compilef("c|abc", "i").match1f("\u{83}x0abcdef");
    assert_eq!(r, "abc");
}

/// Case-insensitive `\q{}` string sets match every case variant.
#[test]
fn unicode_sets_qstring_icase() {
    test_with_configs(|tc| {
        for input in ["ab", "aB", "Ab", "AB"] {
            tc.test_match_succeeds(r"^[\q{aB}]$", "vi", input);
        }
        tc.test_match_fails(r"^[\q{aB}]$", "vi", "ax");
        // A longer icase alternative (\q{} is only valid inside a class).
        tc.test_match_succeeds(r"^[\q{abc}]$", "vi", "ABC");
        tc.test_match_succeeds(r"^[\q{abc}]$", "vi", "aBc");
    });
}

/// `v`-mode string-set alternatives are matched longest-first,
/// regardless of the order in which they are written. So both `[\q{a|abc}]` and
/// `[\q{abc|a}]` must match the full "abc", not just the leading "a".
#[test]
fn unicode_sets_qstring_longest_first() {
    test_with_configs(|tc| {
        assert_eq!(tc.compilef(r"[\q{a|abc}]", "v").match1f("abc"), "abc");
        assert_eq!(tc.compilef(r"[\q{abc|a}]", "v").match1f("abc"), "abc");
        // Equal-length alternatives keep source-order priority.
        assert_eq!(tc.compilef(r"[\q{ab|ba}]", "v").match1f("ab"), "ab");
    });
}

/// A negated *nested* class `[^...]` used as a set operand must have its code
/// points inverted. Regression test: previously the inversion was dropped, so
/// `[[^a]]` behaved like `[a]`.
#[test]
fn unicode_sets_negated_nested_class() {
    test_with_configs(|tc| {
        // Bare negated nested class: `[[^a]]` is "everything except a".
        test_unicode_sets_matches(tc, "[[^a]]", &["b", "c", "0", "z"], &["a"]);
        test_unicode_sets_matches(tc, "[^[^a]]", &["a"], &["b", "c", "0", "z"]);
        // Negated nested class containing a character-class escape.
        test_unicode_sets_matches(tc, r"[[^\d]]", &["a", "x", "_"], &["5", "0"]);
        // Intersection: word characters except `_`.
        test_unicode_sets_matches(tc, r"[\w&&[^_]]", &["a", "5", "Z"], &["_", " "]);
        // Union: `a` unioned with "not b" is everything except `b`.
        test_unicode_sets_matches(tc, "[a[^b]]", &["a", "c", "0"], &["b"]);
        // Subtraction: lowercase letters minus the non-vowels leaves the vowels.
        test_unicode_sets_matches(tc, "[[a-z]--[^aeiou]]", &["a", "e", "u"], &["b", "z"]);

        // None of these should parse without the 'v' flag.
        test_parse_fails_flags("[[^a]]", "u");
        test_parse_fails_flags("[^[^a]]", "u");
        test_parse_fails_flags(r"[[^\d]]", "u");
        test_parse_fails_flags(r"[\w&&[^_]]", "u");
        test_parse_fails_flags("[a[^b]]", "u");
        test_parse_fails_flags("[[a-z]--[^aeiou]]", "u");
    });
}
