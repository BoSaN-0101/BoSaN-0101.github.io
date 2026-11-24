declare module 'tesseract.js' {
  export interface Worker {
    recognize(image: Buffer | string): Promise<{ data: { text: string } }>;
    terminate(): Promise<unknown>;
  }
  export function createWorker(lang: string, oem?: number, options?: Record<string, unknown>): Promise<Worker>;
}
