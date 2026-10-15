import XCTest
@testable import MacroNative

final class CalendarPaletteTests: XCTestCase {
    func testDarkAndBrightCalendarSourcesRemainReadableWithDarkEventText() {
        let sources: [(Double, Double, Double)] = [(0.03, 0.05, 0.2), (0.99, 0.99, 0.99), (0.45, 0.6, 0.8), (0.9, 0.2, 0.1), (0.05, 0.5, 0.1)]
        func linear(_ value: Double) -> Double { value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4) }
        for (red, green, blue) in sources {
            let fill = NativeCalendarPalette.eventRGB(red: red, green: green, blue: blue)
            let luminance = 0.2126 * linear(fill.red) + 0.7152 * linear(fill.green) + 0.0722 * linear(fill.blue)
            XCTAssertGreaterThanOrEqual((luminance + 0.05) / (linear(0.086) + 0.05), 4.5)
        }
    }

    func testNeutralCalendarDoesNotGainAnArbitraryHue() {
        let value = NativeCalendarPalette.eventRGB(red: 0.1, green: 0.1, blue: 0.1)
        XCTAssertEqual(value.red, value.green, accuracy: 0.0001)
        XCTAssertEqual(value.green, value.blue, accuracy: 0.0001)
    }
}
