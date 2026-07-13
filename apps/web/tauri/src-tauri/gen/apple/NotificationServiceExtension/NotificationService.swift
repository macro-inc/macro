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

        let userInfo = request.content.userInfo
        let senderName = content.title

        // Track pending downloads
        let group = DispatchGroup()
        var profileImageURL: URL?
        var attachmentImageURL: URL?

        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)

        do {
            try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        } catch {
            contentHandler(content)
            return
        }

        // Download profile picture for left side (communication notification)
        if let urlString = userInfo["senderProfilePictureUrl"] as? String,
           let url = URL(string: urlString) {
            group.enter()
            URLSession.shared.downloadTask(with: url) { location, _, error in
                defer { group.leave() }
                guard error == nil, let location = location else { return }
                let fileURL = tempDir.appendingPathComponent("profile.jpg")
                try? FileManager.default.moveItem(at: location, to: fileURL)
                profileImageURL = fileURL
            }.resume()
        }

        // Download attachment image for right side
        if let urlString = userInfo["attachmentImageUrl"] as? String,
           let url = URL(string: urlString) {
            group.enter()
            URLSession.shared.downloadTask(with: url) { location, _, error in
                defer { group.leave() }
                guard error == nil, let location = location else { return }
                let fileURL = tempDir.appendingPathComponent("attachment.jpg")
                try? FileManager.default.moveItem(at: location, to: fileURL)
                attachmentImageURL = fileURL
            }.resume()
        }

        group.notify(queue: .main) {
            // Add attachment image on right side if available
            if let attachmentURL = attachmentImageURL,
               let attachment = try? UNNotificationAttachment(
                   identifier: "attachment-image",
                   url: attachmentURL
               ) {
                content.attachments = [attachment]
            }

            // Add profile picture on left side via communication notification (iOS 15+)
            if let profileURL = profileImageURL {
                if #available(iOS 15.0, *) {
                    self.configureCommunicationNotification(
                        content: content,
                        senderName: senderName,
                        avatarURL: profileURL,
                        contentHandler: contentHandler
                    )
                } else {
                    contentHandler(content)
                }
            } else {
                contentHandler(content)
            }
        }
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
