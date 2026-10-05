use std::cell::RefCell;

// main idea borrowed_mut from:
// https://blog.iany.me/2019/03/how-to-mock-time-in-rust-tests-and-cargo-gotchas-we-met/
// see also:
// https://docs.rs/mock_instant/latest/mock_instant/

// FIXME: This should be November 12 1955 06:38, of course
// (or maybe OCT 21, 2015 07:28)
// 8 November 2022 12:13 Berlin time

thread_local! {
    static MOCK_TIME: RefCell<i64> = const { RefCell::new(1667906008578) };
}

pub fn get_milliseconds_since_epoch() -> i64 {
    MOCK_TIME.with(|t| *t.borrow())
}

pub fn set_mock_time(time: i64) {
    MOCK_TIME.with(|cell| *cell.borrow_mut() = time);
}

#[cfg(test)]
mod tests {
    use crate::mock_time::MOCK_TIME;

    use super::get_milliseconds_since_epoch;

    #[test]
    fn mock_time() {
        let t = get_milliseconds_since_epoch();
        assert_eq!(t, 1667906008578);

        MOCK_TIME.with_borrow(|v| assert_eq!(*v, 1667906008578));
    }
}
