import Foundation
import PDFKit

@objc(PdfTextExtractor)
class PdfTextExtractor: NSObject {
  
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  /// Card statements are usually password-protected (name + date of birth). A locked PDF with no
  /// password rejects with ERR_PDF_LOCKED and a wrong one with ERR_PDF_PASSWORD, so JS can ask the user.
  @objc(extractText:password:withResolver:withRejecter:)
  func extractText(filePath: String, password: String?, resolve: @escaping (Any?) -> Void, reject: @escaping (String?, String?, Error?) -> Void) -> Void {
    // A file:// URI from the document picker is percent-encoded ("My%20Statement.pdf").
    let url: URL
    if filePath.hasPrefix("file://"), let parsed = URL(string: filePath) {
      url = parsed
    } else {
      url = URL(fileURLWithPath: filePath)
    }
    
    guard let pdf = PDFDocument(url: url) else {
      reject("ERR_PDF_OPEN", "Cannot open PDF at path: \(url.path)", nil)
      return
    }

    if pdf.isLocked {
      guard let password = password, !password.isEmpty else {
        reject("ERR_PDF_LOCKED", "This PDF is password-protected.", nil)
        return
      }
      guard pdf.unlock(withPassword: password) else {
        reject("ERR_PDF_PASSWORD", "Wrong password for this PDF.", nil)
        return
      }
    }
    
    var text = ""
    for i in 0..<pdf.pageCount {
      if let page = pdf.page(at: i) {
        text += page.string ?? ""
        text += "\n"
      }
    }
    
    resolve(text)
  }
}
