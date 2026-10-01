import { NativeModules } from 'react-native';

const { PdfTextExtractor } = NativeModules;

/** Rejects with code 'ERR_PDF_LOCKED' (needs a password) or 'ERR_PDF_PASSWORD' (wrong one). */
export const extractTextFromPdf = async (filePath: string, password?: string): Promise<string> => {
  if (!PdfTextExtractor) {
    throw new Error('PdfTextExtractor native module is not linked.');
  }
  return await PdfTextExtractor.extractText(filePath, password ?? null);
};
