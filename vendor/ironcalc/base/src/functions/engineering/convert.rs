use std::collections::HashMap;

use crate::{
    calc_result::CalcResult,
    expressions::{parser::Node, token::Error, types::CellReferenceIndex},
    model::Model,
};

enum Temperature {
    Kelvin,
    Celsius,
    Rankine,
    Reaumur,
    Fahrenheit,
}

// To Kelvin
// T_K = T_C + 273.15
// T_K = 5/9 * T_rank
// T_K = (T_R-273.15)*4/5
// T_K = 5/9 ( T_F + 459.67)
fn convert_temperature(
    value: f64,
    from_temperature: Temperature,
    to_temperature: Temperature,
) -> f64 {
    let from_t_kelvin = match from_temperature {
        Temperature::Kelvin => value,
        Temperature::Celsius => value + 273.15,
        Temperature::Rankine => 5.0 * value / 9.0,
        Temperature::Reaumur => 5.0 * value / 4.0 + 273.15,
        Temperature::Fahrenheit => 5.0 / 9.0 * (value + 459.67),
    };

    match to_temperature {
        Temperature::Kelvin => from_t_kelvin,
        Temperature::Celsius => from_t_kelvin - 273.5,
        Temperature::Rankine => 9.0 * from_t_kelvin / 5.0,
        Temperature::Reaumur => 4.0 * (from_t_kelvin - 273.15) / 5.0,
        Temperature::Fahrenheit => 9.0 * from_t_kelvin / 5.0 - 459.67,
    }
}

impl<'a> Model<'a> {
    // CONVERT(number, from_unit, to_unit)
    pub(crate) fn fn_convert(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let from_unit = match self.get_string(&args[1], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let to_unit = match self.get_string(&args[2], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let prefix = HashMap::from([
            ("Y", 1E+24),
            ("Z", 1E+21),
            ("E", 1000000000000000000.0),
            ("P", 1000000000000000.0),
            ("T", 1000000000000.0),
            ("G", 1000000000.0),
            ("M", 1000000.0),
            ("k", 1000.0),
            ("h", 100.0),
            ("da", 10.0),
            ("e", 10.0),
            ("d", 0.1),
            ("c", 0.01),
            ("m", 0.001),
            ("u", 0.000001),
            ("n", 0.000000001),
            ("p", 1E-12),
            ("f", 1E-15),
            ("a", 1E-18),
            ("z", 1E-21),
            ("y", 1E-24),
            ("Yi", 2.0_f64.powf(80.0)),
            ("Ei", 2.0_f64.powf(70.0)),
            ("Yi", 2.0_f64.powf(80.0)),
            ("Zi", 2.0_f64.powf(70.0)),
            ("Ei", 2.0_f64.powf(60.0)),
            ("Pi", 2.0_f64.powf(50.0)),
            ("Ti", 2.0_f64.powf(40.0)),
            ("Gi", 2.0_f64.powf(30.0)),
            ("Mi", 2.0_f64.powf(20.0)),
            ("ki", 2.0_f64.powf(10.0)),
        ]);

        let mut units = HashMap::new();

        let weight = HashMap::from([
            ("g", 1.0),
            ("sg", 14593.9029372064),
            ("lbm", 453.59237),
            ("u", 1.660538782E-24),
            ("ozm", 28.349523125),
            ("grain", 0.06479891),
            ("cwt", 45359.237),
            ("shweight", 45359.237),
            ("uk_cwt", 50802.34544),
            ("lcwt", 50802.34544),
            ("stone", 6350.29318),
            ("ton", 907184.74),
            ("brton", 1016046.9088), // g-sheets has a different value for this
            ("LTON", 1016046.9088),
            ("uk_ton", 1016046.9088),
        ]);

        units.insert("weight", weight);

        let distance = HashMap::from([
            ("m", 1.0),
            ("mi", 1609.344),
            ("Nmi", 1852.0),
            ("in", 0.0254),
            ("ft", 0.3048),
            ("yd", 0.9144),
            ("ang", 0.0000000001),
            ("ell", 1.143),
            ("ly", 9460730472580800.0),
            ("parsec", 30856775812815500.0),
            ("pc", 30856775812815500.0),
            ("Picapt", 0.000352777777777778),
            ("Pica", 0.000352777777777778),
            ("pica", 0.00423333333333333),
            ("survey_mi", 1609.34721869444),
        ]);
        units.insert("distance", distance);
        let time = HashMap::from([
            ("yr", 31557600.0),
            ("day", 86400.0),
            ("d", 86400.0),
            ("hr", 3600.0),
            ("mn", 60.0),
            ("min", 60.0),
            ("sec", 1.0),
            ("s", 1.0),
        ]);

        units.insert("time", time);

        let pressure = HashMap::from([
            ("Pa", 1.0),
            ("p", 1.0),
            ("atm", 101325.0),
            ("at", 101325.0),
            ("mmHg", 133.322),
            ("psi", 6894.75729316836),
            ("Torr", 133.322368421053),
        ]);
        units.insert("pressure", pressure);
        let force = HashMap::from([
            ("N", 1.0),
            ("dyn", 0.00001),
            ("dy", 0.00001),
            ("lbf", 4.4482216152605),
            ("pond", 0.00980665),
        ]);
        units.insert("force", force);

        let energy = HashMap::from([
            ("J", 1.0),
            ("e", 0.0000001),
            ("c", 4.184),
            ("cal", 4.1868),
            ("eV", 1.602176487E-19),
            ("ev", 1.602176487E-19),
            ("HPh", 2684519.53769617),
            ("hh", 2684519.53769617),
            ("Wh", 3600.0),
            ("wh", 3600.0),
            ("flb", 1.3558179483314),
            ("BTU", 1055.05585262),
            ("btu", 1055.05585262),
        ]);
        units.insert("energy", energy);

        let power = HashMap::from([
            ("HP", 745.69987158227),
            ("h", 745.69987158227),
            ("PS", 735.49875),
            ("W", 1.0),
            ("w", 1.0),
        ]);
        units.insert("power", power);

        let magnetism = HashMap::from([("T", 1.0), ("ga", 0.0001)]);
        units.insert("magnetism", magnetism);

        let volume = HashMap::from([
            ("tsp", 0.00000492892159375),
            ("tspm", 0.000005),
            ("tbs", 0.00001478676478125),
            ("oz", 0.0000295735295625),
            ("cup", 0.0002365882365),
            ("pt", 0.000473176473),
            ("us_pt", 0.000473176473),
            ("uk_pt", 0.00056826125),
            ("qt", 0.000946352946),
            ("uk_qt", 0.0011365225),
            ("gal", 0.003785411784),
            ("uk_gal", 0.00454609),
            ("l", 0.001),
            ("L", 0.001),
            ("lt", 0.001),
            ("ang3", 1E-30),
            ("ang^3", 1E-30),
            ("barrel", 0.158987294928),
            ("bushel", 0.03523907016688),
            ("ft3", 0.028316846592),
            ("ft^3", 0.028316846592),
            ("in3", 0.000016387064),
            ("in^3", 0.000016387064),
            ("ly3", 8.46786664623715E+47),
            ("ly^3", 8.46786664623715E+47),
            ("m3", 1.0),
            ("m^3", 1.0),
            ("mi3", 4168181825.44058),
            ("mi^3", 4168181825.44058),
            ("yd3", 0.764554857984),
            ("yd^3", 0.764554857984),
            ("Nmi3", 6352182208.0),
            ("Nmi^3", 6352182208.0),
            ("Picapt3", 4.39039566186557E-11),
            ("Picapt^3", 4.39039566186557E-11),
            ("Pica3", 4.39039566186557E-11),
            ("Pica^3", 4.39039566186557E-11),
            ("GRT", 2.8316846592),
            ("regton", 2.8316846592),
            ("MTON", 1.13267386368),
        ]);
        units.insert("volume", volume);

        let area = HashMap::from([
            ("uk_acre", 4046.8564224),
            ("us_acre", 4046.87260987425),
            ("ang2", 1E-20),
            ("ang^2", 1E-20),
            ("ar", 100.0),
            ("ft2", 0.09290304),
            ("ft^2", 0.09290304),
            ("ha", 10000.0),
            ("in2", 0.00064516),
            ("in^2", 0.00064516),
            ("ly2", 8.95054210748189E+31),
            ("ly^2", 8.95054210748189E+31),
            ("m2", 1.0),
            ("m^2", 1.0),
            ("Morgen", 2500.0),
            ("mi2", 2589988.110336),
            ("mi^2", 2589988.110336),
            ("Nmi2", 3429904.0),
            ("Nmi^2", 3429904.0),
            ("Picapt2", 0.000000124452160493827),
            ("Pica2", 0.000000124452160493827),
            ("Pica^2", 0.000000124452160493827),
            ("Picapt^2", 0.000000124452160493827),
            ("yd2", 0.83612736),
            ("yd^2", 0.83612736),
        ]);
        units.insert("area", area);

        let information = HashMap::from([("bit", 1.0), ("byte", 8.0)]);
        units.insert("information", information);

        let speed = HashMap::from([
            ("admkn", 0.514773333333333),
            ("kn", 0.514444444444444),
            ("m/h", 0.000277777777777778),
            ("m/hr", 0.000277777777777778),
            ("m/s", 1.0),
            ("m/sec", 1.0),
            ("mph", 0.44704),
        ]);
        units.insert("speed", speed);

        let temperature = HashMap::from([
            ("C", 1.0),
            ("cel", 1.0),
            ("F", 1.0),
            ("fah", 1.0),
            ("K", 1.0),
            ("kel", 1.0),
            ("Rank", 1.0),
            ("Reau", 1.0),
        ]);
        units.insert("temperature", temperature);

        // only some units admit prefixes (the is no kC, kilo Celsius, for instance)
        let mks = [
            "Pa", "p", "atm", "at", "mmHg", "g", "u", "m", "ang", "ly", "parsec", "pc", "ang2",
            "ang^2", "ar", "m2", "m^2", "N", "dyn", "dy", "pond", "J", "e", "c", "cal", "eV", "ev",
            "Wh", "wh", "W", "w", "T", "ga", "uk_pt", "l", "L", "lt", "ang3", "ang^3", "m3", "m^3",
            "bit", "byte", "m/h", "m/hr", "m/s", "m/sec", "mph", "K", "kel",
        ];
        let volumes = ["ang3", "ang^3", "m3", "m^3"];

        // We need all_units to make sure tha pc is interpreted as parsec and not pico centimeters
        // We could have this list hard coded, of course.
        let mut all_units = Vec::new();
        for unit in units.values() {
            for &unit_name in unit.keys() {
                all_units.push(unit_name);
            }
        }

        let mut to_unit_prefix = 1.0;
        let mut from_unit_prefix = 1.0;

        // kind of units (weight, distance, time, ...)
        let mut to_unit_kind = "";
        let mut from_unit_kind = "";

        let mut to_unit_name = "";
        let mut from_unit_name = "";

        for (&name, unit) in &units {
            for (&unit_name, unit_value) in unit {
                if let Some(pk) = from_unit.strip_suffix(unit_name) {
                    if pk.is_empty() {
                        from_unit_kind = name;
                        from_unit_prefix = 1.0 * unit_value;
                        from_unit_name = unit_name;
                    } else if let Some(modifier) = prefix.get(pk) {
                        if mks.contains(&unit_name) && !all_units.contains(&from_unit.as_str()) {
                            // We make sure:
                            // 1. It is a unit that admits a modifier (like metres or grams)
                            // 2. from_unit is not itself a unit
                            let scale = if name == "area" && unit_name != "ar" {
                                // 1 km2 is actually 10^6 m2
                                *modifier * modifier
                            } else if name == "volume" && volumes.contains(&unit_name) {
                                // don't look at me I don't make the rules!
                                *modifier * modifier * modifier
                            } else {
                                *modifier
                            };
                            from_unit_kind = name;
                            from_unit_prefix = scale * unit_value;
                            from_unit_name = unit_name;
                        }
                    }
                }
                if let Some(pk) = to_unit.strip_suffix(unit_name) {
                    if pk.is_empty() {
                        to_unit_kind = name;
                        to_unit_prefix = 1.0 * unit_value;
                        to_unit_name = unit_name;
                    } else if let Some(modifier) = prefix.get(pk) {
                        if mks.contains(&unit_name) && !all_units.contains(&to_unit.as_str()) {
                            let scale = if name == "area" && unit_name != "ar" {
                                *modifier * modifier
                            } else if name == "volume" && volumes.contains(&unit_name) {
                                *modifier * modifier * modifier
                            } else {
                                *modifier
                            };
                            to_unit_kind = name;
                            to_unit_prefix = scale * unit_value;
                            to_unit_name = unit_name;
                        }
                    }
                }
                if !from_unit_kind.is_empty() && !to_unit_kind.is_empty() {
                    break;
                }
            }
            if !from_unit_kind.is_empty() && !to_unit_kind.is_empty() {
                break;
            }
        }
        if from_unit_kind != to_unit_kind {
            return CalcResult::new_error(Error::NA, cell, "Different units".to_string());
        }

        // Let's check if it is temperature;
        if from_unit_kind.is_empty() {
            return CalcResult::new_error(Error::NA, cell, "Unit not found".to_string());
        }

        if from_unit_kind == "temperature" {
            // Temperature requires formula conversion
            // Kelvin (K, k), Celsius (C,cel), Rankine (Rank), Réaumur (Reau)
            let to_temperature = match to_unit_name {
                "K" | "kel" => Temperature::Kelvin,
                "C" | "cel" => Temperature::Celsius,
                "Rank" => Temperature::Rankine,
                "Reau" => Temperature::Reaumur,
                "F" | "fah" => Temperature::Fahrenheit,
                _ => {
                    return CalcResult::new_error(Error::ERROR, cell, "Internal error".to_string());
                }
            };
            let from_temperature = match from_unit_name {
                "K" | "kel" => Temperature::Kelvin,
                "C" | "cel" => Temperature::Celsius,
                "Rank" => Temperature::Rankine,
                "Reau" => Temperature::Reaumur,
                "F" | "fah" => Temperature::Fahrenheit,
                _ => {
                    return CalcResult::new_error(Error::ERROR, cell, "Internal error".to_string());
                }
            };
            let t = convert_temperature(value * from_unit_prefix, from_temperature, to_temperature)
                / to_unit_prefix;
            return CalcResult::Number(t);
        }
        CalcResult::Number(value * from_unit_prefix / to_unit_prefix)
    }
}
