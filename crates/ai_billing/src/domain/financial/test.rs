use super::*;

fn money(units: u64) -> CustomerMoney {
    CustomerMoney::from_units(units)
}

#[test]
fn fractional_spend_and_holds_are_not_spendable_by_either_ledger() {
    let cent = CustomerMoney::UNITS_PER_CENT;
    let credits = CreditCommitments {
        remainder: money(cent / 4),
        held: money(cent),
        release_pool: money(cent / 2),
    };
    assert_eq!(credits.available(2).unwrap(), money(cent / 4));
    assert_eq!(credits.legacy_available_cents(2).unwrap(), 0);
    assert_eq!(credits.available(1).unwrap(), money(0));
}

#[test]
fn prepaid_debits_partition_without_rounding_or_double_debits() {
    let cent = CustomerMoney::UNITS_PER_CENT;
    let mut remainder = money(0);
    let mut debited = 0;
    for _ in 0..7 {
        let (debit, next) = prepaid_debit(remainder, money(cent / 4)).unwrap();
        debited += debit;
        remainder = next;
    }
    assert_eq!(debited, 1);
    assert_eq!(remainder, money(cent * 3 / 4));
    assert_eq!(
        prepaid_debit(money(0), money(cent * 7 / 4)).unwrap(),
        (debited, remainder)
    );
}

#[test]
fn legacy_cap_reserves_any_fraction_without_rounding_customer_liability() {
    let cent = CustomerMoney::UNITS_PER_CENT;
    assert_eq!(legacy_cap_remaining(100, money(cent + 1)), 98);
    assert_eq!(legacy_cap_remaining(1, money(cent + 1)), 0);
}

#[test]
fn credit_overflow_fails_closed() {
    assert!(prepaid_debit(money(1), money(u64::MAX)).is_err());
    assert!(
        CreditCommitments {
            remainder: money(0),
            held: money(0),
            release_pool: money(0)
        }
        .available(i64::MAX)
        .is_err()
    );
}

#[test]
fn subscription_identity_is_not_an_empty_or_whitespace_label() {
    assert!(FundingSubscription::new(String::new()).is_err());
    assert!(FundingSubscription::new("sub invalid".into()).is_err());
    assert!(FundingSubscription::new("sub_verified".into()).is_ok());
}
