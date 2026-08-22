import Foundation
import PDFKit

@objc(PdfTextExtractor)
class PdfTextExtractor: NSObject {
  
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc(extractText:withResolver:withRejecter:)
  func extractText(filePath: String, resolve: @escaping (Any?) -> Void, reject: @escaping (String?, String?, Error?) -> Void) -> Void {
    // If the file path comes as a file:// URI, parse it
    let path = filePath.replacingOccurrences(of: "file://", with: "")
    let url = URL(fileURLWithPath: path)
    
    guard let pdf = PDFDocument(url: url) else {
      reject("ERR_PDF_OPEN", "Cannot open PDF at path: \(path)", nil)
      return
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
