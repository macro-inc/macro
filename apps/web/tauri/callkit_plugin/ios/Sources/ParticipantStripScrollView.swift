import UIKit

/// The row itself owns every touch. Participant views are disposable render
/// targets, never the views UIKit associates with a delayed touch event.
final class ParticipantStripScrollView: UIScrollView, UIGestureRecognizerDelegate {
    struct Item: Equatable {
        let id: String
        let frame: CGRect
    }

    private(set) var displayedItems: [Item] = []
    var onSelectParticipant: ((String) -> Void)?
    private var touchedParticipantId: String?
    private var selectionGeneration = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        let tap = UITapGestureRecognizer(target: self, action: #selector(selectParticipant(_:)))
        tap.delegate = self
        tap.cancelsTouchesInView = false
        tap.delaysTouchesBegan = false
        tap.delaysTouchesEnded = false
        tap.require(toFail: panGestureRecognizer)
        addGestureRecognizer(tap)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        // In particular, don't return the content container, tiles, or a
        // LiveKit renderer: any of those may be removed on the next update.
        super.hitTest(point, with: event) == nil ? nil : self
    }

    func participant(at point: CGPoint) -> String? {
        displayedItems.first { $0.frame.contains(point) }?.id
    }

    /// Preserve a surviving visible participant's position when membership
    /// changes. Frame coordinates and contentOffset share the content space.
    func updateItems(_ items: [Item], contentSize newSize: CGSize) {
        let surviving = displayedItems.filter { old in items.contains { $0.id == old.id } }
        let anchor = surviving.first { $0.frame.intersects(bounds) }
            ?? surviving.min { abs($0.frame.minX - bounds.minX) < abs($1.frame.minX - bounds.minX) }
        let oldOffset = contentOffset.x
        displayedItems = items
        contentSize = newSize
        let proposedOffset: CGFloat
        if let anchor, let replacement = items.first(where: { $0.id == anchor.id }) {
            proposedOffset = oldOffset + replacement.frame.minX - anchor.frame.minX
        } else {
            proposedOffset = oldOffset
        }
        let maxOffset = max(0, newSize.width - bounds.width)
        let offset = CGPoint(x: min(max(0, proposedOffset), maxOffset), y: 0)
        if contentOffset != offset { setContentOffset(offset, animated: false) }
    }

    func invalidateSelection() {
        selectionGeneration += 1
        touchedParticipantId = nil
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard gestureRecognizer is UITapGestureRecognizer,
              gestureRecognizer.numberOfTouches == 0 else { return true }
        // A touch that stops momentum must not also pin a participant. Capture
        // identity at touch-down, rather than looking up a potentially new row
        // at touch-up.
        touchedParticipantId = isDecelerating ? nil : participant(at: touch.location(in: self))
        return true
    }

    @objc private func selectParticipant(_ recognizer: UITapGestureRecognizer) {
        guard recognizer.state == .ended, let id = touchedParticipantId else { return }
        touchedParticipantId = nil
        let generation = selectionGeneration
        DispatchQueue.main.async { [weak self] in
            guard let self, self.selectionGeneration == generation else { return }
            self.onSelectParticipant?(id)
        }
    }
}
