import AVFoundation
import Foundation
import Observation
import Speech

@MainActor @Observable
final class NativeAgentDictation {
    private(set) var recording = false
    var error: String?
    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private var recognizer = SFSpeechRecognizer(locale: .current)
    @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private var recognition: SFSpeechRecognitionTask?
    @ObservationIgnored private var hasTap = false
    @ObservationIgnored private var audioActive = false
    @ObservationIgnored private var generation = 0

    func start(onText: @escaping (String) -> Void) async {
        guard !recording else { return }
        stop(); generation += 1; let current = generation
        let allowed = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
        }
        guard current == generation, !Task.isCancelled else { return }
        guard allowed else { error = "Allow speech recognition in iPhone Settings to use dictation."; return }
        let microphone = await AVAudioApplication.requestRecordPermission()
        guard current == generation, !Task.isCancelled else { return }
        guard microphone else { error = "Allow microphone access in iPhone Settings to use dictation."; return }
        guard let recognizer, recognizer.isAvailable else { error = "Dictation is unavailable right now."; return }
        error = nil
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try audio.setActive(true, options: .notifyOthersOnDeactivation); audioActive = true
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            self.request = request
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw NSError(domain: "Dictation", code: 1, userInfo: [NSLocalizedDescriptionKey: "The microphone is unavailable."]) }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
            hasTap = true
            recognition = recognizer.recognitionTask(with: request) { [weak self] result, failure in
                Task { @MainActor in
                    guard let self, self.generation == current else { return }
                    if let result { onText(result.bestTranscription.formattedString) }
                    if result?.isFinal == true || failure != nil { self.stop() }
                }
            }
            engine.prepare(); try engine.start(); recording = true
        } catch { self.error = error.localizedDescription; stop() }
    }

    func stop() {
        generation += 1
        engine.stop()
        if hasTap { engine.inputNode.removeTap(onBus: 0); hasTap = false }
        request?.endAudio(); recognition?.cancel(); recognition = nil; request = nil
        if audioActive { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation); audioActive = false }
        recording = false
    }
}
