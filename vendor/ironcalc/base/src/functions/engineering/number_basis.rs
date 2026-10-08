use crate::{
    calc_result::CalcResult,
    expressions::{parser::Node, token::Error, types::CellReferenceIndex},
    model::Model,
};

// 8_i64.pow(10);
const OCT_MAX: i64 = 1_073_741_824;
const OCT_MAX_HALF: i64 = 536_870_912;
// 16_i64.pow(10)
const HEX_MAX: i64 = 1_099_511_627_776;
const HEX_MAX_HALF: i64 = 549_755_813_888;
// Binary numbers are 10 bits and the most significant bit is the sign

fn from_binary_to_decimal(value: f64) -> Result<i64, String> {
    let value = format!("{value}");

    let result = match i64::from_str_radix(&value, 2) {
        Ok(b) => b,
        Err(_) => {
            return Err("cannot parse into binary".to_string());
        }
    };
    if !(0..=1023).contains(&result) {
        // 2^10
        return Err("too large".to_string());
    } else if result > 511 {
        // 2^9
        return Ok(result - 1024);
    };
    Ok(result)
}

impl<'a> Model<'a> {
    // BIN2DEC(number)
    pub(crate) fn fn_bin2dec(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        match from_binary_to_decimal(value) {
            Ok(n) => CalcResult::Number(n as f64),
            Err(message) => CalcResult::new_error(Error::NUM, cell, message),
        }
    }

    // BIN2HEX(number, [places])
    pub(crate) fn fn_bin2hex(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=2).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let places = if args.len() == 2 {
            match self.get_number_no_bools(&args[1], cell) {
                Ok(f) => Some(f.trunc() as i32),
                Err(s) => return s,
            }
        } else {
            None
        };
        if let Some(p) = places {
            if p <= 0 || p > 10 {
                return CalcResult::new_error(Error::NUM, cell, "Not enough places".to_string());
            }
        }
        let value = match from_binary_to_decimal(value) {
            Ok(n) => n,
            Err(message) => return CalcResult::new_error(Error::NUM, cell, message),
        };
        if value < 0 {
            CalcResult::String(format!("{:0width$X}", HEX_MAX + value, width = 9))
        } else {
            let result = format!("{value:X}");
            if let Some(places) = places {
                if places < result.len() as i32 {
                    return CalcResult::new_error(
                        Error::NUM,
                        cell,
                        "Not enough places".to_string(),
                    );
                }
                return CalcResult::String(format!("{:0width$X}", value, width = places as usize));
            }
            CalcResult::String(result)
        }
    }

    // BIN2OCT(number, [places])
    pub(crate) fn fn_bin2oct(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=2).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let places = if args.len() == 2 {
            match self.get_number_no_bools(&args[1], cell) {
                Ok(f) => Some(f.trunc() as i32),
                Err(s) => return s,
            }
        } else {
            None
        };
        let value = match from_binary_to_decimal(value) {
            Ok(n) => n,
            Err(message) => return CalcResult::new_error(Error::NUM, cell, message),
        };
        if let Some(p) = places {
            if p <= 0 || p > 10 {
                return CalcResult::new_error(Error::NUM, cell, "Not enough places".to_string());
            }
        }
        if value < 0 {
            CalcResult::String(format!("{:0width$o}", OCT_MAX + value, width = 9))
        } else {
            let result = format!("{value:o}");
            if let Some(places) = places {
                if places < result.len() as i32 {
                    return CalcResult::new_error(
                        Error::NUM,
                        cell,
                        "Not enough places".to_string(),
                    );
                }
                return CalcResult::String(format!("{:0width$o}", value, width = places as usize));
            }
            CalcResult::String(result)
        }
    }

    pub(crate) fn fn_dec2bin(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=2).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }
        let value_raw = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let places = if args.len() == 2 {
            match self.get_number_no_bools(&args[1], cell) {
                Ok(f) => Some(f.trunc() as i32),
                Err(s) => return s,
            }
        } else {
            None
        };
        if let Some(p) = places {
            if p <= 0 || p > 10 {
                return CalcResult::new_error(Error::NUM, cell, "Not enough places".to_string());
            }
        }
        let mut value = value_raw.trunc() as i64;
        if !(-512..=511).contains(&value) {
            return CalcResult::new_error(Error::NUM, cell, "Out of bounds".to_string());
        }
        if value < 0 {
            value += 1024;
        }
        let result = format!("{value:b}");
        if let Some(places) = places {
            if value_raw > 0.0 && places < result.len() as i32 {
                return CalcResult::new_error(Error::NUM, cell, "Out of bounds".to_string());
            }
            let result = format!("{:0width$b}", value, width = places as usize);
            return CalcResult::String(result);
        }
        CalcResult::String(result)
    }

    pub(crate) fn fn_dec2hex(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=2).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }
        let value_raw = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.trunc(),
            Err(s) => return s,
        };
        let places = if args.len() == 2 {
            match self.get_number_no_bools(&args[1], cell) {
                Ok(f) => Some(f.trunc() as i32),
                Err(s) => return s,
            }
        } else {
            None
        };
        if let Some(p) = places {
            if p <= 0 || p > 10 {
                return CalcResult::new_error(Error::NUM, cell, "Not enough places".to_string());
            }
        }
        let mut value = value_raw.trunc() as i64;
        if !(-HEX_MAX_HALF..=HEX_MAX_HALF - 1).contains(&value) {
            return CalcResult::new_error(Error::NUM, cell, "Out of bounds".to_string());
        }
        if value < 0 {
            value += HEX_MAX;
        }
        let result = format!("{value:X}");
        if let Some(places) = places {
            if value_raw > 0.0 && places < result.len() as i32 {
                return CalcResult::new_error(Error::NUM, cell, "Out of bounds".to_string());
            }
            let result = format!("{:0width$X}", value, width = places as usize);
            return CalcResult::String(result);
        }
        CalcResult::String(result)
    }

    pub(crate) fn fn_dec2oct(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=2).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }
        let value_raw = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let places = if args.len() == 2 {
            match self.get_number_no_bools(&args[1], cell) {
                Ok(f) => Some(f.trunc() as i32),
                Err(s) => return s,
            }
        } else {
            None
        };
        if let Some(p) = places {
            if p <= 0 || p > 10 {
                return CalcResult::new_error(Error::NUM, cell, "Not enough places".to_string());
            }
        }
        let mut value = value_raw.trunc() as i64;

        if !(-OCT_MAX_HALF..=OCT_MAX_HALF - 1).contains(&value) {
            return CalcResult::new_error(Error::NUM, cell, "Out of bounds".to_string());
        }
        if value < 0 {
            value += OCT_MAX;
        }
        let result = format!("{value:o}");
        if let Some(places) = places {
            if value_raw > 0.0 && places < result.len() as i32 {
                return CalcResult::new_error(Error::NUM, cell, "Out of bounds".to_string());
            }
            let result = format!("{:0width$o}", value, width = places as usize);
            return CalcResult::String(result);
        }
        CalcResult::String(result)
    }

    // HEX2BIN(number, [places])
    pub(crate) fn fn_hex2bin(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=2).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let places = if args.len() == 2 {
            match self.get_number_no_bools(&args[1], cell) {
                Ok(f) => Some(f.trunc() as i32),
                Err(s) => return s,
            }
        } else {
            None
        };
        if value.len() > 10 {
            return CalcResult::new_error(Error::NUM, cell, "Value too large".to_string());
        }
        if let Some(p) = places {
            if p <= 0 || p > 10 {
                return CalcResult::new_error(Error::NUM, cell, "Not enough places".to_string());
            }
        }
        let mut value = match i64::from_str_radix(&value, 16) {
            Ok(f) => f,
            Err(_) => {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Error parsing hex number".to_string(),
                );
            }
        };
        if value < 0 {
            return CalcResult::new_error(Error::NUM, cell, "Negative value".to_string());
        }

        if value >= HEX_MAX_HALF {
            value -= HEX_MAX;
        }
        if !(-512..=511).contains(&value) {
            return CalcResult::new_error(Error::NUM, cell, "Out of bounds".to_string());
        }
        if value < 0 {
            value += 1024;
        }
        let result = format!("{value:b}");
        if let Some(places) = places {
            if places <= 0 || (value > 0 && places < result.len() as i32) {
                return CalcResult::new_error(Error::NUM, cell, "Out of bounds".to_string());
            }
            let result = format!("{:0width$b}", value, width = places as usize);
            return CalcResult::String(result);
        }
        CalcResult::String(result)
    }

    // HEX2DEC(number)
    pub(crate) fn fn_hex2dec(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=2).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(s) => return s,
        };
        if value.len() > 10 {
            return CalcResult::new_error(Error::NUM, cell, "Value too large".to_string());
        }
        let mut value = match i64::from_str_radix(&value, 16) {
            Ok(f) => f,
            Err(_) => {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Error parsing hex number".to_string(),
                );
            }
        };
        if value < 0 {
            return CalcResult::new_error(Error::NUM, cell, "Negative value".to_string());
        }

        if value >= HEX_MAX_HALF {
            value -= HEX_MAX;
        }
        CalcResult::Number(value as f64)
    }

    pub(crate) fn fn_hex2oct(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=2).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let places = if args.len() == 2 {
            match self.get_number_no_bools(&args[1], cell) {
                Ok(f) => Some(f.trunc() as i32),
                Err(s) => return s,
            }
        } else {
            None
        };
        if let Some(p) = places {
            if p <= 0 || p > 10 {
                return CalcResult::new_error(Error::NUM, cell, "Not enough places".to_string());
            }
        }
        if value.len() > 10 {
            return CalcResult::new_error(Error::NUM, cell, "Value too large".to_string());
        }
        let mut value = match i64::from_str_radix(&value, 16) {
            Ok(f) => f,
            Err(_) => {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Error parsing hex number".to_string(),
                );
            }
        };
        if value < 0 {
            return CalcResult::new_error(Error::NUM, cell, "Negative value".to_string());
        }

        if value > HEX_MAX_HALF {
            value -= HEX_MAX;
        }
        if !(-OCT_MAX_HALF..=OCT_MAX_HALF - 1).contains(&value) {
            return CalcResult::new_error(Error::NUM, cell, "Out of bounds".to_string());
        }
        if value < 0 {
            value += OCT_MAX;
        }
        let result = format!("{value:o}");
        if let Some(places) = places {
            if places <= 0 || (value > 0 && places < result.len() as i32) {
                return CalcResult::new_error(Error::NUM, cell, "Out of bounds".to_string());
            }
            let result = format!("{:0width$o}", value, width = places as usize);
            return CalcResult::String(result);
        }
        CalcResult::String(result)
    }

    pub(crate) fn fn_oct2bin(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=2).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let places = if args.len() == 2 {
            match self.get_number_no_bools(&args[1], cell) {
                Ok(f) => Some(f.trunc() as i32),
                Err(s) => return s,
            }
        } else {
            None
        };
        if let Some(p) = places {
            if p <= 0 || p > 10 {
                return CalcResult::new_error(Error::NUM, cell, "Not enough places".to_string());
            }
        }
        let mut value = match i64::from_str_radix(&value, 8) {
            Ok(f) => f,
            Err(_) => {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Error parsing hex number".to_string(),
                );
            }
        };
        if value < 0 {
            return CalcResult::new_error(Error::NUM, cell, "Negative value".to_string());
        }

        if value >= OCT_MAX_HALF {
            value -= OCT_MAX;
        }
        if !(-512..=511).contains(&value) {
            return CalcResult::new_error(Error::NUM, cell, "Out of bounds".to_string());
        }
        if value < 0 {
            value += 1024;
        }
        let result = format!("{value:b}");
        if let Some(places) = places {
            if value < 512 && places < result.len() as i32 {
                return CalcResult::new_error(Error::NUM, cell, "Out of bounds".to_string());
            }
            let result = format!("{:0width$b}", value, width = places as usize);
            return CalcResult::String(result);
        }
        CalcResult::String(result)
    }

    pub(crate) fn fn_oct2dec(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=2).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let mut value = match i64::from_str_radix(&value, 8) {
            Ok(f) => f,
            Err(_) => {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Error parsing hex number".to_string(),
                );
            }
        };
        if value < 0 {
            return CalcResult::new_error(Error::NUM, cell, "Negative value".to_string());
        }

        if value >= OCT_MAX_HALF {
            value -= OCT_MAX
        }
        CalcResult::Number(value as f64)
    }

    pub(crate) fn fn_oct2hex(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(1..=2).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let places = if args.len() == 2 {
            match self.get_number_no_bools(&args[1], cell) {
                Ok(f) => Some(f.trunc() as i32),
                Err(s) => return s,
            }
        } else {
            None
        };
        // There is not a default value for places
        // But if there is a value it needs to be positive and less than 11
        if let Some(p) = places {
            if p <= 0 || p > 10 {
                return CalcResult::new_error(Error::NUM, cell, "Not enough places".to_string());
            }
        }
        let mut value = match i64::from_str_radix(&value, 8) {
            Ok(f) => f,
            Err(_) => {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Error parsing hex number".to_string(),
                );
            }
        };
        if value < 0 {
            return CalcResult::new_error(Error::NUM, cell, "Negative value".to_string());
        }

        if value >= OCT_MAX_HALF {
            value -= OCT_MAX;
        }

        if !(-HEX_MAX_HALF..=HEX_MAX_HALF - 1).contains(&value) {
            return CalcResult::new_error(Error::NUM, cell, "Out of bounds".to_string());
        }
        if value < 0 {
            value += HEX_MAX;
        }
        let result = format!("{value:X}");
        if let Some(places) = places {
            if value < HEX_MAX_HALF && places < result.len() as i32 {
                return CalcResult::new_error(Error::NUM, cell, "Out of bounds".to_string());
            }
            let result = format!("{:0width$X}", value, width = places as usize);
            return CalcResult::String(result);
        }
        CalcResult::String(result)
    }
}
