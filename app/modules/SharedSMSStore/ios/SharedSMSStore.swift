import Foundation

@objc(SharedSMSStore)
class SharedSMSStore: NSObject {

    private let suiteName = "group.b96296c92bb96aa2.1"
    private let savedMessagesKey = "saved_bank_messages"
    private let inboxFileName = "sms-inbox.jsonl"
    private let shortcutLastRunKey = "shortcut_last_run"
    private let extensionLastRunKey = "extension_last_run"

    private var inboxURL: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: suiteName)?
            .appendingPathComponent(inboxFileName)
    }

    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }

    /// Drains both ingestion paths and clears them.
    ///
    /// - `sms-inbox.jsonl` is written by the Shortcuts automation via IngestSMSIntent.
    /// - The UserDefaults array is written by the message filter extension. That write
    ///   is currently a no-op — extensions run in a sandbox that blocks persistence —
    ///   but it is kept wired so the network-defer path can land here later without
    ///   another change on the JS side.
    @objc
    func readNewMessages(_ resolve: @escaping (Any?) -> Void, rejecter reject: @escaping (String?, String?, Error?) -> Void) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            reject("ERR_USERDEFAULTS", "Could not initialize UserDefaults for App Group: \(suiteName)", nil)
            return
        }

        var messages = drainInbox()

        let fromExtension = defaults.array(forKey: savedMessagesKey) as? [[String: Any]] ?? []
        if !fromExtension.isEmpty {
            messages.append(contentsOf: fromExtension.map { tag($0, source: "filter") })
            defaults.removeObject(forKey: savedMessagesKey)
            defaults.synchronize()
        }

        resolve(messages)
    }

    /// Read without clearing — for diagnostics only.
    @objc
    func peekMessages(_ resolve: @escaping (Any?) -> Void, rejecter reject: @escaping (String?, String?, Error?) -> Void) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            reject("ERR_USERDEFAULTS", "Could not initialize UserDefaults for App Group: \(suiteName)", nil)
            return
        }

        var messages = readInbox()
        let fromExtension = defaults.array(forKey: savedMessagesKey) as? [[String: Any]] ?? []
        messages.append(contentsOf: fromExtension.map { tag($0, source: "filter") })
        resolve(messages)
    }

    /// Write a test value — verifies the App Group is reachable from the main app.
    @objc
    func writeTestValue(_ resolve: @escaping (Any?) -> Void, rejecter reject: @escaping (String?, String?, Error?) -> Void) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            reject("ERR_USERDEFAULTS", "Could not initialize UserDefaults for App Group: \(suiteName)", nil)
            return
        }
        defaults.set("test_ok_\(Date().timeIntervalSince1970)", forKey: "debug_test")
        defaults.synchronize()
        let readBack = defaults.string(forKey: "debug_test") ?? "nil"
        resolve("wrote and read back: \(readBack)")
    }

    @objc
    func getExtensionLastRun(_ resolve: @escaping (Any?) -> Void, rejecter reject: @escaping (String?, String?, Error?) -> Void) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            reject("ERR_USERDEFAULTS", "Could not initialize UserDefaults for App Group: \(suiteName)", nil)
            return
        }
        resolve(defaults.string(forKey: extensionLastRunKey) ?? "never")
    }

    /// Per-path health, so an empty ledger can be diagnosed as "automation never
    /// fired" vs "automation fired but nothing parsed".
    @objc
    func getIngestStats(_ resolve: @escaping (Any?) -> Void, rejecter reject: @escaping (String?, String?, Error?) -> Void) {
        let defaults = UserDefaults(suiteName: suiteName)
        let pending = readInbox()
        let stats: [String: Any] = [
            "shortcutLastRun": defaults?.string(forKey: shortcutLastRunKey) ?? "never",
            "extensionLastRun": defaults?.string(forKey: extensionLastRunKey) ?? "never",
            "pendingFromShortcut": pending.count,
            "pendingFromExtension": (defaults?.array(forKey: savedMessagesKey) as? [[String: Any]] ?? []).count,
            "inboxPath": inboxURL?.path ?? "unavailable",
            "inboxExists": inboxURL.map { FileManager.default.fileExists(atPath: $0.path) } ?? false,
        ]
        resolve(stats)
    }

    // MARK: - Inbox file

    private func readInbox() -> [[String: Any]] {
        guard let url = inboxURL, FileManager.default.fileExists(atPath: url.path) else { return [] }
        var contents = ""
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { target in
            contents = (try? String(contentsOf: target, encoding: .utf8)) ?? ""
        }
        return parse(contents)
    }

    /// Reads and truncates under a single write coordination so a message arriving
    /// mid-drain is not silently discarded.
    private func drainInbox() -> [[String: Any]] {
        guard let url = inboxURL, FileManager.default.fileExists(atPath: url.path) else { return [] }
        var messages: [[String: Any]] = []
        var coordinationError: NSError?

        NSFileCoordinator().coordinate(writingItemAt: url, options: [], error: &coordinationError) { target in
            guard let contents = try? String(contentsOf: target, encoding: .utf8) else { return }
            messages = parse(contents)
            // Truncate the inbox file in-place once read so processed or corrupt lines do not persist
            if !contents.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                if let handle = try? FileHandle(forWritingTo: target) {
                    try? handle.truncate(atOffset: 0)
                    try? handle.synchronize()
                    try? handle.close()
                } else {
                    try? Data().write(to: target)
                }
            }
        }

        return messages
    }

    private func parse(_ contents: String) -> [[String: Any]] {
        contents
            .split(separator: "\n")
            .compactMap { line -> [String: Any]? in
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return nil }
                guard let data = trimmed.data(using: .utf8),
                      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                else { return nil }
                return object
            }
    }

    private func tag(_ message: [String: Any], source: String) -> [String: Any] {
        var copy = message
        if copy["source"] == nil { copy["source"] = source }
        return copy
    }
}
