export interface Anchor { offset: number; inset: number }
export interface ReaderState { file: string | null; fontSize: number; anchor: Anchor }
export interface Book { path: string; name: string; text: string; encoding: string }
export interface Result { book?: Book; error?: string; cancelled?: boolean }
export interface ReaderAPI {
  initialize(): Promise<{ state: ReaderState; result: Result; warning?: string }>;
  open(): Promise<Result>;
  save(state: ReaderState): Promise<{ error?: string }>;
  onClose(callback: () => void): void;
  closeReady(): void;
}
declare global { interface Window { reader: ReaderAPI } }
