import IdentityLookup
import Foundation

final class MessageFilterExtension: ILMessageFilterExtension {}

@available(iOS 16.0, *)
extension MessageFilterExtension: ILMessageFilterQueryHandling, ILMessageFilterCapabilitiesQueryHandling {
    
    func handle(_ capabilitiesQueryRequest: ILMessageFilterCapabilitiesQueryRequest, context: ILMessageFilterExtensionContext, completion: @escaping (ILMessageFilterCapabilitiesQueryResponse) -> Void) {
        let response = ILMessageFilterCapabilitiesQueryResponse()
        response.transactionalSubActions = [
            .transactionalFinance,
            .transactionalOrders
        ]
        response.promotionalSubActions = [.promotionalOffers]
        completion(response)
    }

    func handle(_ queryRequest: ILMessageFilterQueryRequest, context: ILMessageFilterExtensionContext, completion: @escaping (ILMessageFilterQueryResponse) -> Void) {
        let response = ILMessageFilterQueryResponse()
        response.action = .none
        
        // Always stamp when we run — helps diagnose if iOS is invoking us at all
        if let defaults = UserDefaults(suiteName: "group.org.mrimmortal09.txntrace") {
            defaults.set(ISO8601DateFormatter().string(from: Date()), forKey: "extension_last_run")
            defaults.synchronize()
        }
        
        guard let sender = queryRequest.sender, let body = queryRequest.messageBody else {
            completion(response)
            return
        }
        
        if isBankMessage(sender: sender, body: body) {
            saveMessage(sender: sender, body: body)
        }
        
        completion(response)
    }
    
    private func isBankMessage(sender: String, body: String) -> Bool {
        let keywords = ["debited", "credited", "A/c", "avl bal", "spent", "withdrawn", "payment", "txn", "inr"]
        let bankKeywords = ["HDFC", "ICICI", "SBI", "AXIS", "INDUS", "IDFC", "YES", "KOTAK", "PNB", "BOB"]
        
        let upperSender = sender.uppercased()
        for bank in bankKeywords {
            if upperSender.contains(bank) { return true }
        }
        
        let lowerBody = body.lowercased()
        for keyword in keywords {
            if lowerBody.contains(keyword.lowercased()) { return true }
        }
        
        return false
    }
    
    private func saveMessage(sender: String, body: String) {
        let savedMessagesKey = "saved_bank_messages"
        guard let defaults = UserDefaults(suiteName: "group.org.mrimmortal09.txntrace") else { return }
        
        let newMessage: [String: Any] = [
            "id": UUID().uuidString,
            "sender": sender,
            "body": body,
            "receivedAt": ISO8601DateFormatter().string(from: Date())
        ]
        
        var savedMessages = defaults.array(forKey: savedMessagesKey) as? [[String: Any]] ?? []
        savedMessages.append(newMessage)
        defaults.set(savedMessages, forKey: savedMessagesKey)
        defaults.synchronize()
    }
}
