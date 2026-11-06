import XCTest
@testable import CallOverlayHarness

final class AudioOutputTests: XCTestCase {
    func testBuiltInAndExternalRouteIdsAreStable() {
        XCTAssertEqual(
            CallAudioRouteController.outputIds(inputUIDs: ["bluetooth-1", "wired-2"]),
            ["receiver", "speaker", "input:bluetooth-1", "input:wired-2"]
        )
        XCTAssertEqual(CallAudioRouteController.outputIds(inputUIDs: []), ["receiver", "speaker"])
    }
}
