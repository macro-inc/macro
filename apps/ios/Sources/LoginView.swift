import SwiftUI

struct LoginView: View {
    @Bindable var session: NativeSession
    @State private var email = ""
    @State private var code = ""
    @State private var sentCode = false
    @State private var working = false
    @State private var error: String?
    @FocusState private var field: Field?
    private enum Field { case email, code }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    Spacer(minLength: 50)
                    MacroMark().fill(.primary).frame(width: 64, height: 64)
                    VStack(alignment: .leading, spacing: 12) {
                        Text(sentCode ? "Check your inbox." : "A little closer.\nA lot faster.")
                            .font(.system(size: 39, weight: .semibold, design: .rounded))
                            .tracking(-1.5)
                        Text(sentCode ? "Enter the sign-in code sent to \(email)." : "Your people and conversations.\nMacro, made for iPhone.")
                            .font(.body).foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 16) {
                        Text(sentCode ? "SIGN-IN CODE" : "WORK EMAIL")
                            .font(.caption.weight(.semibold)).tracking(1.5).foregroundStyle(.secondary)
                        Group {
                            if sentCode {
                                TextField("000000", text: $code)
                                    .keyboardType(.numberPad).textContentType(.oneTimeCode)
                                    .focused($field, equals: .code)
                                    .accessibilityIdentifier("login-code")
                            } else {
                                TextField("you@company.com", text: $email)
                                    .keyboardType(.emailAddress).textContentType(.emailAddress)
                                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                                    .focused($field, equals: .email)
                                    .submitLabel(.continue).onSubmit(submit)
                                    .accessibilityIdentifier("login-email")
                            }
                        }
                        .font(.title3).padding(18)
                        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
                        if let error {
                            Text(error).font(.callout).foregroundStyle(.red).accessibilityIdentifier("login-error")
                        }
                        Button(action: submit) {
                            HStack {
                                Spacer()
                                if working { ProgressView().tint(.black) }
                                Text(sentCode ? "Sign in" : "Continue with email").fontWeight(.semibold)
                                Image(systemName: "arrow.right")
                                Spacer()
                            }.padding(18)
                        }
                        .foregroundStyle(.black).background(MacroTheme.green, in: RoundedRectangle(cornerRadius: 18))
                        .disabled(working || (sentCode ? code.isEmpty : !email.contains("@")))
                        .opacity(working ? 0.65 : 1)
                        .accessibilityIdentifier("login-submit")
                        if sentCode {
                            Button("Use a different email") { sentCode = false; code = ""; error = nil; field = .email }
                                .font(.callout).disabled(working)
                        }
                    }
                    Spacer(minLength: 20)
                    HStack(spacing: 8) {
                        Image(systemName: "lock.shield")
                        Text("Your existing Macro account. Your conversations.")
                    }.font(.footnote).foregroundStyle(.secondary)
                }.padding(28)
            }
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        ForEach(MacroEnvironment.allCases, id: \.self) { environment in
                            Button(environment.rawValue.capitalized) {
                                Task { await session.selectEnvironment(environment); sentCode = false; error = nil }
                            }
                        }
                    } label: {
                        Text(session.environment == .production ? "MACRO" : "DEVELOPMENT")
                            .font(.caption2.weight(.semibold)).tracking(2).foregroundStyle(.secondary)
                    }.disabled(working)
                }
            }
        }
    }

    private func submit() {
        guard !working else { return }
        working = true; error = nil
        Task {
            defer { working = false }
            do {
                if sentCode {
                    try await session.verifyCode(code.trimmingCharacters(in: .whitespacesAndNewlines))
                } else {
                    email = email.trimmingCharacters(in: .whitespacesAndNewlines)
                    sentCode = try await session.sendCode(email: email)
                    if sentCode { field = .code }
                }
            } catch { self.error = error.localizedDescription }
        }
    }
}
