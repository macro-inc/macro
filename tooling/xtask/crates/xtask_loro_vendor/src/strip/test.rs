use super::strip_disabled;
use quote::ToTokens;

fn stripped(source: &str) -> String {
    let mut file = syn::parse_file(source).unwrap();
    strip_disabled(&mut file, "local").unwrap();
    file.into_token_stream().to_string()
}

fn tokens(source: &str) -> String {
    syn::parse_file(source)
        .unwrap()
        .into_token_stream()
        .to_string()
}

#[test]
fn every_gated_position_strips_to_the_upstream_source() {
    let vendor = r#"
        #[cfg(feature = "local")]
        mod added;
        #[cfg(all(test, feature = "local"))]
        mod added_tests;
        struct Inner {
            kept: i64,
            #[cfg(feature = "local")]
            added: i64,
        }
        impl Inner {
            #[cfg(feature = "local")]
            pub fn added(&self) {}
            fn run(&self, values: &mut [u8]) -> i64 {
                #[cfg(feature = "local")]
                values.fill(1);
                #[cfg(not(feature = "local"))]
                for value in values.iter_mut() {
                    *value = 1;
                }
                #[cfg(not(feature = "local"))]
                let now = 1;
                #[cfg(feature = "local")]
                let now = 2;
                let inner = Inner {
                    kept: now,
                    #[cfg(feature = "local")]
                    added: 0,
                };
                match now {
                    #[cfg(feature = "local")]
                    2 => 0,
                    _ => inner.kept,
                }
            }
        }
    "#;
    let upstream = r#"
        struct Inner {
            kept: i64,
        }
        impl Inner {
            fn run(&self, values: &mut [u8]) -> i64 {
                for value in values.iter_mut() {
                    *value = 1;
                }
                let now = 1;
                let inner = Inner {
                    kept: now,
                };
                match now {
                    _ => inner.kept,
                }
            }
        }
    "#;
    assert_eq!(stripped(vendor), tokens(upstream));
}

#[test]
fn unrelated_cfgs_stay_and_any_with_the_feature_stays_unknown() {
    let vendor = r#"
        #[cfg(test)]
        mod tests;
        #[cfg(any(test, feature = "local"))]
        fn either() {}
        #[cfg(any(not(feature = "local"), test))]
        fn always() {}
        #[cfg(feature = "other")]
        fn other() {}
    "#;
    let expected = r#"
        #[cfg(test)]
        mod tests;
        #[cfg(any(test, feature = "local"))]
        fn either() {}
        fn always() {}
        #[cfg(feature = "other")]
        fn other() {}
    "#;
    assert_eq!(stripped(vendor), tokens(expected));
}

#[test]
fn a_feature_reference_outside_a_gated_node_survives_for_the_caller_to_reject() {
    let vendor = r#"
        fn run() -> bool {
            cfg!(feature = "local")
        }
    "#;
    assert!(stripped(vendor).contains("\"local\""));
}
