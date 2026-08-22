#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PdfTextExtractor, NSObject)

RCT_EXTERN_METHOD(extractText:(NSString *)filePath
                 withResolver:(RCTPromiseResolveBlock)resolve
                 withRejecter:(RCTPromiseRejectBlock)reject)

@end
