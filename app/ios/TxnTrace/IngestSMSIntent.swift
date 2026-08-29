import AppIntents
import Foundation

/// Shared location of the append-only inbox that the Shortcuts automation writes
/// into and the app drains on foreground. Kept as a plain JSON-lines file rather
/// than UserDefaults: the intent can fire twice in quick succession (banks often
/// send debit + balance back to back), and a read-modify-write on an array would
/// drop one of them.
enum SMSInbox {
    static let appGroup = "group.org.mrimmortal09.txntrace"
    static let fileName = "sms-inbox.jsonl"
    static let lastRunKey = "shortcut_last_run"

    static var fileURL: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(fileName)
    }
}

struct IngestSMSError: Error, CustomLocalizedStringResourceConvertible {
    let reason: String
    var localizedStringResource: LocalizedStringResource { "\(reason)" }
}

/// Exposed to the Shortcuts app so a "When I get a message" automation can hand
/// the message straight to TxnTrace without opening it.
struct IngestSMSIntent: AppIntent {
    static var title: LocalizedStringResource = "Save Transaction SMS"
    static var description = IntentDescription(
        "Passes a bank SMS to TxnTrace for parsing. Runs in the background without opening the app."
    )

    // Headless: the whole point is that the automation never interrupts the user.
    static var openAppWhenRun = false

    @Parameter(title: "Message")
    var messageBody: String

    @Parameter(title: "Sender")
    var sender: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Save \(\.$messageBody) from \(\.$sender) to TxnTrace")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<Bool> {
        let trimmed = messageBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            // Nothing to parse — succeed quietly so the automation doesn't surface an error banner.
            return .result(value: false)
        }

        let record: [String: Any] = [
            "id": UUID().uuidString,
            "sender": sender?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            "body": trimmed,
            "receivedAt": ISO8601DateFormatter().string(from: Date()),
            "source": "shortcut",
        ]

        try SMSInboxWriter.append(record)
        SMSInboxWriter.stampLastRun()

        return .result(value: true)
    }
}

enum SMSInboxWriter {
    /// Serializes appends from repeated intent invocations within this process.
    private static let queue = DispatchQueue(label: "org.mrimmortal09.txntrace.smsinbox")

    static func append(_ record: [String: Any]) throws {
        guard let url = SMSInbox.fileURL else {
            throw IngestSMSError(reason: "TxnTrace could not open its shared App Group container.")
        }

        var line = try JSONSerialization.data(withJSONObject: record, options: [])
        line.append(0x0A) // newline

        try queue.sync {
            var writeError: Error?
            var coordinationError: NSError?

            NSFileCoordinator().coordinate(writingItemAt: url, options: [], error: &coordinationError) { target in
                do {
                    if !FileManager.default.fileExists(atPath: target.path) {
                        FileManager.default.createFile(atPath: target.path, contents: nil)
                    }
                    let handle = try FileHandle(forWritingTo: target)
                    defer { try? handle.close() }
                    try handle.seekToEnd()
                    try handle.write(contentsOf: line)
                } catch {
                    writeError = error
                }
            }

            if let coordinationError { throw coordinationError }
            if let writeError { throw writeError }
        }
    }

    /// Lets the in-app diagnostics tell "automation never fired" apart from
    /// "automation fired but nothing parsed" — the two failure modes look
    /// identical from an empty transaction list otherwise.
    static func stampLastRun() {
        guard let defaults = UserDefaults(suiteName: SMSInbox.appGroup) else { return }
        defaults.set(ISO8601DateFormatter().string(from: Date()), forKey: SMSInbox.lastRunKey)
    }
}
