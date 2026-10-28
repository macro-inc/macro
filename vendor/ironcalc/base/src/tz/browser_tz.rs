use crate::constants::EXCEL_DATE_BASE;

#[derive(Clone)]
pub(crate) struct Tz(String);

mod js {
    use wasm_bindgen::prelude::*;

    // Weirdly enough Intl.supportedValuesOf('timeZone') doesn't include "UTC" or "GMT"
    // but Intl.DateTimeFormat does support them, so we add them manually.
    #[wasm_bindgen(inline_js = r#"
        const _fmtCache = new Map();
        function getFormatter(tz) {
            let f = _fmtCache.get(tz);
            if (!f) {
                f = new Intl.DateTimeFormat('en-US', {
                    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
                });
                _fmtCache.set(tz, f);
            }
            return f;
        }
        export function ic_tz_validate(name) {
            try { getFormatter(name); return true; }
            catch(_) { return false; }
        }
        export function ic_tz_all() {
            try {
                const list = Intl.supportedValuesOf('timeZone');

                const zones = new Set(list);

                const extras = [ 'UTC', 'GMT' ];

                for (const tz of extras) {
                    zones.add(tz);
                }

                return Array.from(zones);
            } catch(e) {
                // no support
                console.log(e);
                return [ ];
            }
        }
        export function ic_tz_parts(ms, tz) {
            const p = {};
            for (const x of getFormatter(tz).formatToParts(new Date(ms))) p[x.type] = x.value | 0;
            return [p.year, p.month, p.day, p.hour, p.minute, p.second];
        }
    "#)]
    extern "C" {
        pub fn ic_tz_validate(name: &str) -> bool;
        pub fn ic_tz_all() -> js_sys::Array;
        pub fn ic_tz_parts(ms: f64, tz: &str) -> js_sys::Array;
    }
}

impl Tz {
    pub(crate) fn parse(s: &str) -> Result<Tz, String> {
        if js::ic_tz_validate(s) {
            Ok(Tz(s.to_string()))
        } else {
            Err(format!("Invalid timezone: {s}"))
        }
    }
}

pub fn get_all_timezone_names() -> Vec<String> {
    js::ic_tz_all()
        .iter()
        .filter_map(|v| v.as_string())
        .collect()
}

pub(crate) fn excel_serial_for_now(tz: &Tz) -> Option<f64> {
    let ms = crate::model::get_milliseconds_since_epoch();
    let parts = js::ic_tz_parts(ms as f64, &tz.0);
    if parts.length() != 6 {
        return None;
    }

    let get = |i: u32| parts.get(i).as_f64().unwrap_or(0.0) as i32;
    // TODO: handle invalid dates
    let (year, month, day) = (get(0), get(1), get(2));
    let (hour, minute, second) = (get(3), get(4), get(5));

    let y = year - 1;
    let n = 365 * y + y / 4 - y / 100 + y / 400;
    let month_starts: [i32; 12] = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let leap = if month > 2 && year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) {
        1
    } else {
        0
    };
    let days_from_ce = n + month_starts[(month - 1) as usize] + leap + day;
    let secs = hour * 3600 + minute * 60 + second;

    Some((days_from_ce - EXCEL_DATE_BASE) as f64 + secs as f64 / 86400.0)
}
