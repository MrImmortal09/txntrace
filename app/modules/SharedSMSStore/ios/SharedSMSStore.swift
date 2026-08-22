import Foundation

@objc(SharedSMSStore)
class SharedSMSStore: NSObject {
    
    private let suiteName = "group.org.mrimmortal09.txntrace"
    private let savedMessagesKey = "saved_bank_messages"
    
    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }
    
    @objc
    func readNewMessages(_ resolve: @escaping (Any?) -> Void, rejecter reject: @escaping (String?, String?, Error?) -> Void) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            reject("ERR_USERDEFAULTS", "Could not initialize UserDefaults for App Group: \(suiteName)", nil)
            return
        }
        
        let savedMessages = defaults.array(forKey: savedMessagesKey) as? [[String: Any]] ?? []
        defaults.removeObject(forKey: savedMessagesKey)
        resolve(savedMessages)
    }
    
    // Read without clearing — for diagnostics only
    @objc
    func peekMessages(_ resolve: @escaping (Any?) -> Void, rejecter reject: @escaping (String?, String?, Error?) -> Void) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            reject("ERR_USERDEFAULTS", "Could not initialize UserDefaults for App Group: \(suiteName)", nil)
            return
        }
        let savedMessages = defaults.array(forKey: savedMessagesKey) as? [[String: Any]] ?? []
        resolve(savedMessages)
    }
    
    // Write a test value — to verify App Group is accessible from main app
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
    
    // Check the last time the extension ran (extension stamps this on every invocation)
    @objc
    func getExtensionLastRun(_ resolve: @escaping (Any?) -> Void, rejecter reject: @escaping (String?, String?, Error?) -> Void) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            reject("ERR_USERDEFAULTS", "Could not initialize UserDefaults for App Group: \(suiteName)", nil)
            return
        }
        let lastRun = defaults.string(forKey: "extension_last_run") ?? "never"
        resolve(lastRun)
    }
}
