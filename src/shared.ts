export interface Anchor { offset: number; inset: number }
export interface ReaderState { file: string | null; fontSize: number; anchor: Anchor }
export interface HistoryEntry { file: string; name: string; anchor: Anchor; progress: number; lastOpened: number }
export interface Book { path: string; name: string; text: string; encoding: string }
export interface Result { book?: Book; anchor?: Anchor; history?: HistoryEntry[]; error?: string; cancelled?: boolean }
export interface ReaderAPI {
  initialize(): Promise<{ state: ReaderState; result: Result; history: HistoryEntry[]; warning?: string }>;
  open(): Promise<Result>;
  openRecent(file: string): Promise<Result>;
  removeRecent(file: string): Promise<{ history?: HistoryEntry[]; error?: string }>;
  save(state: ReaderState & { progress?: number }): Promise<{ history?: HistoryEntry[]; error?: string }>;
  onClose(callback: () => void): void;
  closeReady(): void;
}
declare global { interface Window { reader: ReaderAPI } }
