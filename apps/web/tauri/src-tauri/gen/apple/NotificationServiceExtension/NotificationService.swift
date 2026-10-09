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
        let notificationType = userInfo["notificationType"] as? String
        // Channel-less sender line for the communication layout; the alert
        // title (which may carry a channel suffix) is the fallback.
        let senderName = (userInfo["communicationTitle"] as? String) ?? content.title
        // `#channel` second line for non-DM channel notifications.
        let groupName = userInfo["groupName"] as? String
        let conversationIdentifier = (userInfo["conversationId"] as? String) ?? senderName

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

            // Add profile picture on left side via communication notification (iOS 15+).
            // Without a sender photo, emails fall back to the bundled generic
            // email icon and channel conversations to the generic channel icon.
            var avatarImageData = profileImageURL.flatMap { try? Data(contentsOf: $0) }
            if avatarImageData == nil {
                if notificationType == "new_email" {
                    avatarImageData = NotificationService.genericEmailAvatarData
                } else if groupName != nil {
                    avatarImageData = NotificationService.genericChannelAvatarData
                }
            }

            if #available(iOS 15.0, *), let avatarImageData = avatarImageData {
                self.configureCommunicationNotification(
                    content: content,
                    senderName: senderName,
                    groupName: groupName,
                    conversationIdentifier: conversationIdentifier,
                    avatarImageData: avatarImageData,
                    contentHandler: contentHandler
                )
            } else {
                contentHandler(content)
            }
        }
    }

    /// The bundled fallback avatar shown for email notifications whose sender
    /// has no known profile photo.
    private static let genericEmailAvatarData: Data? = {
        bundledAvatarData(named: "email-generic-avatar")
    }()

    /// The bundled fallback avatar shown for channel notifications whose
    /// sender has no known profile photo.
    private static let genericChannelAvatarData: Data? = {
        bundledAvatarData(named: "channel-generic-avatar")
    }()

    private static func bundledAvatarData(named name: String) -> Data? {
        guard let url = Bundle(for: NotificationService.self)
            .url(forResource: name, withExtension: "png")
        else { return nil }
        return try? Data(contentsOf: url)
    }

    @available(iOS 15.0, *)
    private func configureCommunicationNotification(
        content: UNMutableNotificationContent,
        senderName: String,
        groupName: String?,
        conversationIdentifier: String,
        avatarImageData: Data,
        contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        // Create a unique identifier for the sender
        let handle = INPersonHandle(value: senderName, type: .unknown)

        let personImage = INImage(imageData: avatarImageData)

        // Create the sender person
        let sender = INPerson(
            personHandle: handle,
            nameComponents: nil,
            displayName: senderName,
            image: personImage,
            contactIdentifier: nil,
            customIdentifier: senderName
        )

        // iOS renders the group line (speakableGroupName) only when the
        // intent has at least one recipient besides the sender, so a group
        // conversation carries one placeholder recipient.
        var recipients: [INPerson]? = nil
        var speakableGroupName: INSpeakableString? = nil
        if let groupName = groupName {
            speakableGroupName = INSpeakableString(spokenPhrase: groupName)
            recipients = [
                INPerson(
                    personHandle: INPersonHandle(value: "", type: .unknown),
                    nameComponents: nil,
                    displayName: nil,
                    image: nil,
                    contactIdentifier: nil,
                    customIdentifier: nil
                )
            ]
        }

        // Create a send message intent
        let intent = INSendMessageIntent(
            recipients: recipients,
            outgoingMessageType: .outgoingMessageText,
            content: content.body,
            speakableGroupName: speakableGroupName,
            conversationIdentifier: conversationIdentifier,
            serviceName: nil,
            sender: sender,
            attachments: nil
        )

        // Set the sender's image for the intent
        intent.setImage(personImage, forParameterNamed: \.sender)
        if speakableGroupName != nil {
            // Group notifications take their large avatar from the group
            // parameter; reuse the sender's photo since channels have none.
            intent.setImage(personImage, forParameterNamed: \.speakableGroupName)
        }

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
