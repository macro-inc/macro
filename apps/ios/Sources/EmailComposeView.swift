import SwiftUI
import UniformTypeIdentifiers

/// The mobile ComposeLayout: compact envelope rows beneath floating header controls.
/// The native controls retain the original wire draft; presentation never rewrites addresses.
struct EmailComposeView: View {
    @State private var model: EmailComposeStore
    let workspace: EmailStore
    var chat: ChatStore?
    @State private var bodyHeight: CGFloat = 144
    @State private var bodyFocused = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.nativeChromeBottom) private var nativeChromeBottom
    @State private var showsCopies = false
    @State private var asksToClose = false
    @State private var importsFiles = false
    @State private var showsSchedule = false
    @State private var asksToUnschedule = false
    @State private var showsSignature = false
    @FocusState private var focusedField: Field?
    private enum Field: Hashable { case to, cc, bcc, subject }

    init(draft: EmailComposition, workspace: EmailStore, chat: ChatStore? = nil) {
        var draft = draft
        if let session = workspace.session { draft.webURL = session.environment.webURL }
        _model = State(initialValue: EmailComposeStore(draft: draft, service: workspace.service))
        self.workspace = workspace; self.chat = chat
    }

    private var copiesVisible: Bool { showsCopies || !model.draft.cc.isEmpty || !model.draft.bcc.isEmpty }
    private var fromAddress: String { workspace.inboxes.first { $0.id == model.draft.inboxID }?.email_address ?? "" }
    private var signatureHTML: String? {
        guard model.draft.includeSignature != false, let settings = workspace.inboxes.first(where: { $0.id == model.draft.inboxID })?.settings,
              model.draft.replyingToID == nil || settings.signature_on_replies_forwards == true else { return nil }
        return settings.signature.flatMap { $0.isEmpty ? nil : $0 }
    }
    private var canSend: Bool { !model.isWorking && model.draft.scheduledAt == nil && (try? model.draft.input(requireRecipients: true)) != nil }

    var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if let scheduled = model.draft.scheduledAt {
                    Text("Scheduled for " + scheduled.formatted(date: .abbreviated, time: .shortened)).font(.system(size: 13)).foregroundStyle(MacroTheme.accent).padding(.vertical, 8)
                }
                VStack(spacing: 8) {
                    recipientRow("To", field: .to, text: $model.draft.to)
                    if copiesVisible {
                        recipientRow("Cc", field: .cc, text: $model.draft.cc)
                        recipientRow("Bcc", field: .bcc, text: $model.draft.bcc)
                        fromRow
                    } else {
                        Button { showsCopies = true } label: {
                            HStack(spacing: 8) {
                                Text("Cc/Bcc, From:").foregroundStyle(.secondary)
                                Text(fromAddress).foregroundStyle(Color.primary.opacity(0.88)).lineLimit(1)
                                Spacer(minLength: 0)
                            }.font(.system(size: 14.875)).frame(minHeight: 44).contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityIdentifier("email-copies")
                            .overlay(alignment: .bottom) { separator }
                    }
                }
                HStack(alignment: .center, spacing: 8) {
                    Text("Subject:").font(.system(size: 14.875)).foregroundStyle(.secondary)
                    TextField("", text: $model.draft.subject, axis: .vertical)
                        .font(.system(size: 15.9375)).lineLimit(focusedField == .subject ? 1...6 : 1...1)
                        .focused($focusedField, equals: .subject).accessibilityLabel("Subject")
                        .accessibilityIdentifier("email-subject")
                }.frame(minHeight: 44).padding(.vertical, 2).overlay(alignment: .bottom) { separator }

                if let error = model.error {
                    Text(error).font(.system(size: 13)).foregroundStyle(.red).padding(.vertical, 12).accessibilityIdentifier("email-send-error")
                }
                attachments
                ZStack(alignment: .topLeading) {
                    NativeMentionEditor(wire: $model.draft.body, height: $bodyHeight, channel: Channel(id: "", name: "Email"), store: chat,
                        session: workspace.session, plain: true, includeGroups: false, accessibilityID: "email-body", compact: true,
                        minimumHeight: 140, maximumHeight: 900, onFocusChange: { focused in
                            bodyFocused = focused
                            if focused, model.draft.cc.isEmpty, model.draft.bcc.isEmpty { showsCopies = false }
                        })
                        .frame(height: bodyHeight)
                    if model.draft.body.isEmpty {
                        Text(verbatim: "Use `@` to reference files").font(.system(size: 15.9375)).foregroundStyle(.tertiary)
                            .padding(.top, 13).padding(.leading, 5).allowsHitTesting(false)
                    }
                }.padding(.top, 17).padding(.horizontal, -5)
            }.disabled(model.draft.scheduledAt != nil).padding(.horizontal, 17).padding(.top, 12.75).padding(.bottom, nativeChromeBottom + 20)
        }
        .accessibilityIdentifier("email-compose-fullscreen")
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .top, spacing: 0) { header }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if bodyFocused, let signatureHTML {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 10) {
                        Button { showsSignature.toggle() } label: {
                            HStack(spacing: 8) { MacroIcon(name: showsSignature ? "caret-down" : "caret-right", size: 13); Text("Signature").font(.system(size: 14.875, weight: .medium)); Spacer() }
                        }.accessibilityIdentifier("email-signature-preview")
                        NativeAgentFooterButton(image: "x", pointSize: 15, title: "Don't include signature", identifier: "email-signature-remove", tint: .secondaryLabel) {
                            model.draft.includeSignature = false
                        }.frame(width: 28, height: 28)
                    }
                    if showsSignature { Text(EmailPlainText.fromHTML(signatureHTML)).font(.system(size: 14.875)).textSelection(.enabled).frame(maxHeight: 120) }
                }.buttonStyle(.plain).foregroundStyle(.secondary).padding(.horizontal, 12).padding(.vertical, 1)
                    .overlay(RoundedRectangle(cornerRadius: 8.5).strokeBorder(Color.primary.opacity(0.08)))
                    .padding(.horizontal, 17).padding(.vertical, 17)
            }
        }
        .background(MacroTheme.background.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .disabled(model.isWorking)
        .confirmationDialog("Keep this draft?", isPresented: $asksToClose, titleVisibility: .visible) {
            Button("Save draft") { Task { await save() } }
            Button("Keep on this device") { workspace.localDraft = model.draft; close() }
            Button("Discard changes", role: .destructive) { model.discardChanges(); close() }
        }
        .confirmationDialog("Scheduled email", isPresented: $asksToUnschedule) {
            Button("Cancel scheduled send", role: .destructive) { Task { await model.cancelSchedule() } }
        } message: { Text("Cancel its scheduled delivery to make changes. The saved email stays in Drafts.") }
        .fullScreenCover(isPresented: $showsSchedule) {
            EmailScheduleDrawer(selection: model.draft.sendTime, onSelect: { model.draft.sendTime = $0; showsSchedule = false }, onClose: { showsSchedule = false }).presentationBackground(.clear)
        }
        .fileImporter(isPresented: $importsFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls): Task { await model.addFiles(urls) }
            case .failure(let error): model.error = error.localizedDescription
            }
        }
        .interactiveDismissDisabled(!model.draft.isEmpty || model.isWorking)
        .onChange(of: focusedField) { _, field in
            if let field, [.to, .subject].contains(field), model.draft.cc.isEmpty, model.draft.bcc.isEmpty { showsCopies = false }
        }
        .onDisappear { if !model.completed && model.draft.scheduledAt == nil && !model.draft.isEmpty { workspace.localDraft = model.draft } }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Button {
                if model.draft.isEmpty || model.draft.scheduledAt != nil { close() } else { asksToClose = true }
            } label: { MacroIcon(name: "caret-left", size: 24).frame(width: 46, height: 42.5).contentShape(Rectangle()) }
                .nativeGlass().accessibilityLabel("Close email draft").accessibilityIdentifier("email-compose-close")
            Spacer(minLength: 8)
            HStack(spacing: 0) {
                Button { importsFiles = true } label: { MacroIcon(name: "paperclip", size: 25.5).frame(width: 42.5, height: 46).contentShape(Rectangle()) }
                    .disabled(model.draft.scheduledAt != nil).accessibilityLabel("Attach").accessibilityIdentifier("email-attach")
                Button { if model.draft.scheduledAt != nil { asksToUnschedule = true } else { showsSchedule = true } } label: {
                    MacroIcon(name: "clock", size: 15).foregroundStyle(model.draft.sendTime == nil ? Color.secondary : MacroTheme.accent)
                        .frame(width: 42.5, height: 46).contentShape(Rectangle())
                }.accessibilityLabel("Schedule send").accessibilityIdentifier("email-schedule")
                Button { Task { if await model.send() { workspace.composed(sent: true, scheduled: model.draft.sendTime != nil) } } } label: {
                    Group {
                        if model.isWorking { ProgressView().tint(MacroTheme.background) }
                        else { MacroIcon(name: "arrow-up", size: 25.5) }
                    }.foregroundStyle(canSend ? MacroTheme.background : Color.primary.opacity(0.10))
                        .frame(width: 32, height: 32).background(canSend ? Color.primary : Color.clear, in: Circle())
                        .frame(width: 42.5, height: 46).contentShape(Rectangle())
                }.disabled(!canSend).accessibilityLabel("Send email").accessibilityIdentifier("email-send")
            }.padding(.horizontal, 3).nativeGlass()
        }.buttonStyle(.plain).foregroundStyle(.primary).padding(.horizontal, 12).padding(.top, 2).padding(.bottom, 6)
            .background { LinearGradient(colors: [MacroTheme.background, MacroTheme.background.opacity(0)], startPoint: .top, endPoint: .bottom) }
    }

    private var fromRow: some View {
        @Bindable var model = model
        return HStack(spacing: 8) {
            Text("From:").foregroundStyle(.secondary)
            Menu {
                ForEach(workspace.inboxes.filter { !$0.needs_reauth }) { inbox in
                    Button { model.draft.inboxID = inbox.id } label: {
                        if inbox.id == model.draft.inboxID { Label(inbox.email_address, systemImage: "checkmark") }
                        else { Text(inbox.email_address) }
                    }
                }
            } label: {
                HStack(spacing: 5) { Text(fromAddress).lineLimit(1); MacroIcon(name: "caret-down", size: 12) }
                    .foregroundStyle(.primary)
            }.disabled(model.draft.threadID != nil || model.draft.draftID != nil).accessibilityIdentifier("email-from")
            Spacer(minLength: 0)
        }.font(.system(size: 14.875)).frame(minHeight: 44).overlay(alignment: .bottom) { separator }
    }

    private func recipientRow(_ label: String, field: Field, text: Binding<String>) -> some View {
        let recipients = (try? EmailRecipients.parse(text.wrappedValue)) ?? []
        return HStack(alignment: .center, spacing: 8) {
            Text(label + ":").font(.system(size: 14.875)).foregroundStyle(.secondary)
            if focusedField != field && !recipients.isEmpty {
                Button { focusedField = field } label: {
                    Text(EmailRecipientSummary.label(recipients)).font(.system(size: 15.9375)).lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("email-\(label.lowercased())")
            } else {
                TextField("", text: text, axis: .vertical).font(.system(size: 15.9375))
                    .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .focused($focusedField, equals: field).frame(minHeight: 36)
                    .accessibilityLabel(label).accessibilityIdentifier("email-\(label.lowercased())")
            }
        }.padding(.vertical, 4).frame(minHeight: 44).overlay(alignment: .bottom) { separator }
    }

    @ViewBuilder private var attachments: some View {
        if !model.draft.forwardedAttachments.isEmpty {
            Label("\(model.draft.forwardedAttachments.count) forwarded attachment\(model.draft.forwardedAttachments.count == 1 ? "" : "s")", systemImage: "paperclip")
                .font(.system(size: 12)).foregroundStyle(.secondary).padding(.top, 12)
        }
        ForEach(model.draft.localAttachments) { attachment in
            attachmentRow(attachment.name) { model.removeLocalAttachment(attachment) }
        }
        ForEach(model.draft.existingAttachments) { attachment in
            attachmentRow(attachment.file_name) {
                model.draft.removedAttachments.insert(attachment.id)
                model.draft.existingAttachments.removeAll { $0.id == attachment.id }
            }
        }
        ForEach(model.draft.existingForwards) { attachment in
            attachmentRow(attachment.filename ?? "Forwarded attachment") {
                model.draft.removedForwards.insert(attachment.id)
                model.draft.existingForwards.removeAll { $0.id == attachment.id }
            }
        }
    }
    private var separator: some View { Rectangle().fill(Color.primary.opacity(0.10)).frame(height: 0.5) }
    private func attachmentRow(_ name: String, remove: @escaping () -> Void) -> some View {
        HStack(spacing: 7) {
            MacroIcon(name: "paperclip", size: 16); Text(name).lineLimit(1); Spacer()
            Button(action: remove) { MacroIcon(name: "x", size: 14).frame(width: 32, height: 32) }.accessibilityLabel("Remove \(name)")
        }.font(.system(size: 13)).padding(.leading, 10).background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8)).padding(.top, 8)
    }
    private func close() {
        workspace.composition = nil
        dismiss()
    }
    private func save() async {
        if await model.save() { workspace.composed(sent: false) }
    }
}
