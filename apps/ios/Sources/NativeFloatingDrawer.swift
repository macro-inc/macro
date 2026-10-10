import SwiftUI
import CoreImage

private struct NativeDrawerBottomPaddingKey: EnvironmentKey { static let defaultValue: CGFloat = 16 }
private struct NativeDrawerMaximumHeightKey: EnvironmentKey { static let defaultValue: CGFloat = 640 }
extension EnvironmentValues {
    var nativeDrawerBottomPadding: CGFloat {
        get { self[NativeDrawerBottomPaddingKey.self] }
        set { self[NativeDrawerBottomPaddingKey.self] = newValue }
    }
    var nativeDrawerMaximumHeight: CGFloat {
        get { self[NativeDrawerMaximumHeightKey.self] }
        set { self[NativeDrawerMaximumHeightKey.self] = newValue }
    }
}

/// Macro's mobile drawer geometry, shared by native menus and composers.
/// Present with a transparent fullScreenCover so there is only one layer of sheet chrome.
struct NativeFloatingDrawer<Content: View>: View {
    let onDismiss: () -> Void
    var maximumHeightFraction: CGFloat = 0.8
    var dismissDisabled = false
    var handleBottomPadding: CGFloat = 12
    @ViewBuilder let content: () -> Content
    @State private var drag: CGFloat = 0
    private let menuTint = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.098, alpha: 0.88) : UIColor(white: 0.97, alpha: 0.88) })

    var body: some View {
        GeometryReader { geometry in
            let radius = max(36, min(48, min(geometry.size.width, geometry.size.height) * 0.112))
            let windowBottom = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows).first(where: \.isKeyWindow)?.safeAreaInsets.bottom ?? 0
            // Geometry's bottom inset also contains the keyboard; only the device inset belongs inside the drawer.
            let bottom = max(16, windowBottom - 8)
            let maximum = max(0, min(geometry.size.height * maximumHeightFraction, geometry.size.height - geometry.safeAreaInsets.top - 16))
            ZStack(alignment: .bottom) {
                NativeDrawerBackdrop().ignoresSafeArea().overlay(Color.black.opacity(0.1)).ignoresSafeArea().contentShape(Rectangle()).onTapGesture { if !dismissDisabled { onDismiss() } }
                VStack(spacing: 0) {
                    Capsule().fill(Color.primary.opacity(0.15)).frame(width: 38.25, height: 4.25)
                        .frame(maxWidth: .infinity).padding(.top, 8.5).padding(.bottom, handleBottomPadding * 1.0625)
                        .contentShape(Rectangle())
                        .gesture(DragGesture().onChanged { drag = max(0, $0.translation.height) }.onEnded {
                            if !dismissDisabled && ($0.translation.height > 80 || $0.predictedEndTranslation.height > 160) { onDismiss() }
                            withAnimation(.easeOut(duration: 0.2)) { drag = 0 }
                        })
                    content()
                }
                .frame(maxWidth: .infinity, maxHeight: maximum, alignment: .top)
                .fixedSize(horizontal: false, vertical: true)
                .background {
                    RoundedRectangle(cornerRadius: radius, style: .continuous).fill(menuTint)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
                }
                .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(.primary.opacity(0.08), lineWidth: 0.5))
                .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
                .offset(y: drag)
                .environment(\.nativeDrawerMaximumHeight, max(0, maximum - (12 + handleBottomPadding) * 1.0625))
                .environment(\.nativeDrawerBottomPadding, bottom)
                .environment(\.nativeChromeBottom, 0)
                .padding(8)
            }
        }
        .ignoresSafeArea(.container)
        .interactiveDismissDisabled(dismissDisabled)
        .accessibilityAddTraits(.isModal)
    }
}

private struct NativeDrawerContentHeight: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// Fits short drawer content, then scrolls once it reaches the available phone height.
struct NativeDrawerScrollView<Content: View>: View {
    var reservedHeight: CGFloat = 0
    @ViewBuilder let content: () -> Content
    @Environment(\.nativeDrawerMaximumHeight) private var maximumHeight
    @Environment(\.nativeDrawerBottomPadding) private var bottomPadding
    @State private var contentHeight: CGFloat = 200
    var body: some View {
        ScrollView {
            content().frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, bottomPadding)
                .background(GeometryReader { geometry in Color.clear.preference(key: NativeDrawerContentHeight.self, value: geometry.size.height) })
        }
        .frame(height: min(contentHeight, max(100, maximumHeight - reservedHeight)))
        .scrollDismissesKeyboard(.interactively)
        .onPreferenceChange(NativeDrawerContentHeight.self) { if abs(contentHeight - $0) > 0.5 { contentHeight = $0 } }
    }
}

/// UIKit's backdrop samples the presenting content through a transparent cover.
private struct NativeDrawerBackdrop: UIViewRepresentable {
    func makeUIView(context: Context) -> NativeDrawerBlurView { NativeDrawerBlurView() }
    func updateUIView(_ uiView: NativeDrawerBlurView, context: Context) { }
}

/// A snapshot of the presenting screen gives an exact 2pt blur without leaving a paused
/// animation registered (which also prevents XCTest from considering the app idle).
private final class NativeDrawerBlurView: UIView {
    private static let context = CIContext(options: [.cacheIntermediates: false])
    private let imageView = UIImageView()
    private var capturedSize: CGSize = .zero
    init() {
        super.init(frame: .zero)
        isUserInteractionEnabled = false; accessibilityElementsHidden = true
        imageView.contentMode = .scaleToFill; addSubview(imageView)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() {
        super.layoutSubviews(); imageView.frame = bounds
        guard window != nil, bounds.width > 0, bounds.height > 0, bounds.size != capturedSize else { return }
        var responder: UIResponder? = next
        var controller: UIViewController?
        while let current = responder { if let found = current as? UIViewController { controller = found; break }; responder = current.next }
        while let parent = controller?.parent { controller = parent }
        guard let presenting = controller?.presentingViewController?.view ?? window?.rootViewController?.view, presenting !== self else { return }
        capturedSize = bounds.size
        let format = UIGraphicsImageRendererFormat(); format.scale = window?.screen.scale ?? 3
        let snapshot = UIGraphicsImageRenderer(size: bounds.size, format: format).image { _ in
            presenting.drawHierarchy(in: CGRect(origin: presenting.convert(.zero, to: self), size: presenting.bounds.size), afterScreenUpdates: false)
        }
        guard let image = CIImage(image: snapshot) else { return }
        let blurred = image.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 2 * format.scale]).cropped(to: image.extent)
        guard let result = Self.context.createCGImage(blurred, from: image.extent) else { return }
        imageView.image = UIImage(cgImage: result, scale: format.scale, orientation: .up)
    }
}
