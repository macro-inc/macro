import Foundation

/// Mirrors calendar.css: opaque OKLCH fills with bounded lightness and richer chroma.
enum NativeCalendarPalette {
    static func eventRGB(red: Double, green: Double, blue: Double) -> (red: Double, green: Double, blue: Double) {
        func linear(_ value: Double) -> Double { value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4) }
        let r = linear(red), g = linear(green), b = linear(blue)
        let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        let lightness = min(0.72, max(0.67, 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s))
        let a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
        let axisB = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
        let chroma = hypot(a, axisB)
        let scale = chroma > 0.000001 ? min(chroma * 1.65, 0.2) / chroma : 1
        let newA = a * scale, newB = axisB * scale
        let newL = pow(lightness + 0.3963377774 * newA + 0.2158037573 * newB, 3)
        let newM = pow(lightness - 0.1055613458 * newA - 0.0638541728 * newB, 3)
        let newS = pow(lightness - 0.0894841775 * newA - 1.2914855480 * newB, 3)
        func encoded(_ value: Double) -> Double {
            let clamped = min(1, max(0, value))
            return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * pow(clamped, 1 / 2.4) - 0.055
        }
        return (encoded(4.0767416621 * newL - 3.3077115913 * newM + 0.2309699292 * newS),
                encoded(-1.2684380046 * newL + 2.6097574011 * newM - 0.3413193965 * newS),
                encoded(-0.0041960863 * newL - 0.7034186147 * newM + 1.7076147010 * newS))
    }
}
