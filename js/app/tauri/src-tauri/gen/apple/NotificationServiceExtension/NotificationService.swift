import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        bestAttemptContent = request.content.mutableCopy() as? UNMutableNotificationContent

        guard let content = bestAttemptContent else {
            contentHandler(request.content)
            return
        }

        guard let payload = request.content.userInfo["payload"] as? [String: Any],
              let urlString = payload["senderProfilePictureUrl"] as? String,
              let url = URL(string: urlString)
        else {
            contentHandler(content)
            return
        }

        URLSession.shared.downloadTask(with: url) { location, _, error in
            defer { contentHandler(content) }

            guard let location = location, error == nil else { return }

            let tempDir = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            try? FileManager.default.createDirectory(
                at: tempDir,
                withIntermediateDirectories: true
            )
            let fileURL = tempDir.appendingPathComponent("profile.jpg")
            try? FileManager.default.moveItem(at: location, to: fileURL)

            if let attachment = try? UNNotificationAttachment(
                identifier: "sender-profile-picture",
                url: fileURL
            ) {
                content.attachments = [attachment]
            }
        }.resume()
    }

    override func serviceExtensionTimeWillExpire() {
        if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
            contentHandler(bestAttemptContent)
        }
    }
}
