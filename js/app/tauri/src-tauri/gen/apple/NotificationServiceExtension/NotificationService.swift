import UserNotifications
import Intents

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

        guard let urlString = request.content.userInfo["senderProfilePictureUrl"] as? String,
              let url = URL(string: urlString)
        else {
            contentHandler(content)
            return
        }

        let senderName = content.title

        URLSession.shared.downloadTask(with: url) { location, response, error in
            if let error = error {
                NSLog("NotificationServiceExtension: Download error: \(error.localizedDescription)")
                contentHandler(content)
                return
            }

            guard let location = location else {
                contentHandler(content)
                return
            }

            let tempDir = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString, isDirectory: true)

            do {
                try FileManager.default.createDirectory(
                    at: tempDir,
                    withIntermediateDirectories: true
                )
            } catch {
                contentHandler(content)
                return
            }

            let fileURL = tempDir.appendingPathComponent("profile.jpg")

            do {
                try FileManager.default.moveItem(at: location, to: fileURL)
            } catch {
                contentHandler(content)
                return
            }

            // Create a communication notification with the sender's avatar on the left (iOS 15+)
            // No-op for iOS 14 (feature not supported)
            if #available(iOS 15.0, *) {
                self.configureCommunicationNotification(
                    content: content,
                    senderName: senderName,
                    avatarURL: fileURL,
                    contentHandler: contentHandler
                )
            } else {
                // iOS 14: just deliver the notification without profile picture
                contentHandler(content)
            }
        }.resume()
    }

    @available(iOS 15.0, *)
    private func configureCommunicationNotification(
        content: UNMutableNotificationContent,
        senderName: String,
        avatarURL: URL,
        contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        // Create a unique identifier for the sender
        let handle = INPersonHandle(value: senderName, type: .unknown)

        // Load the avatar image
        var personImage: INImage? = nil
        if let imageData = try? Data(contentsOf: avatarURL) {
            personImage = INImage(imageData: imageData)
        }

        // Create the sender person
        let sender = INPerson(
            personHandle: handle,
            nameComponents: nil,
            displayName: senderName,
            image: personImage,
            contactIdentifier: nil,
            customIdentifier: senderName
        )

        // Create a send message intent
        let intent = INSendMessageIntent(
            recipients: nil,
            outgoingMessageType: .outgoingMessageText,
            content: content.body,
            speakableGroupName: nil,
            conversationIdentifier: senderName,
            serviceName: nil,
            sender: sender,
            attachments: nil
        )

        // Set the sender's image for the intent
        intent.setImage(personImage, forParameterNamed: \.sender)

        // Create an interaction and donate it
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        interaction.donate { error in
            if let error = error {
                NSLog("NotificationServiceExtension: Failed to donate interaction: \(error)")
            }
        }

        // Update the notification content with the intent
        do {
            let updatedContent = try content.updating(from: intent)
            contentHandler(updatedContent)
        } catch {
            contentHandler(content)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
            contentHandler(bestAttemptContent)
        }
    }
}
