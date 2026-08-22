import { NativeModules } from 'react-native';

const { PdfTextExtractor } = NativeModules;

export const extractTextFromPdf = async (filePath: string): Promise<string> => {
  if (!PdfTextExtractor) {
    throw new Error('PdfTextExtractor native module is not linked.');
  }
  return await PdfTextExtractor.extractText(filePath);
};
