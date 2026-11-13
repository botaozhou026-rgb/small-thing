import fs from 'node:fs';
import path from 'node:path';
import type { Anchor, Book, HistoryEntry, ReaderState } from './shared';

export const DEFAULT_STATE: ReaderState = { file: null, fontSize: 20, anchor: { offset: 0, inset: 0 } };

export function sanitizeState(value: unknown): ReaderState {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<ReaderState>;
  const anchor = (input.anchor && typeof input.anchor === 'object' ? input.anchor : {}) as Partial<Anchor>;
  return {
    file: typeof input.file === 'string' && path.isAbsolute(input.file) ? input.file : null,
    fontSize: typeof input.fontSize === 'number' && Number.isFinite(input.fontSize)
      ? Math.max(14, Math.min(32, Math.round(input.fontSize))) : 20,
    anchor: {
      offset: typeof anchor.offset === 'number' && Number.isFinite(anchor.offset) ? Math.max(0, Math.floor(anchor.offset)) : 0,
      inset: typeof anchor.inset === 'number' && Number.isFinite(anchor.inset) ? Math.max(-100, Math.min(100, anchor.inset)) : 0,
    },
  };
}

export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  let text: string;
  let encoding = 'UTF-8';
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    encoding = 'GBK';
    try { text = new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
    catch { throw new Error('无法识别文本编码，请将文件另存为 UTF-8 或 GBK 后重试。'); }
  }
  if (/[\x00-\x08\x0e-\x1f]/.test(text)) throw new Error('文件包含非文本内容，请选择 UTF-8 或 GBK 编码的 TXT 文件。');
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new Error('这个 TXT 文件没有可阅读的文字。');
  return { text, encoding };
}

export function readBook(file: string): Book {
  if (path.extname(file).toLowerCase() !== '.txt') throw new Error('目前只支持 TXT 文本文件。');
  let bytes: Buffer;
  try {
    const info = fs.statSync(file);
    if (!info.isFile()) throw new Error('not a file');
    if (info.size > 50 * 1024 * 1024) throw new Error('too large');
    bytes = fs.readFileSync(file);
  } catch (error) {
    if (error instanceof Error && error.message === 'too large') throw new Error('文件超过 50 MB，请先拆分为较小的 TXT 文件。');
    throw new Error('无法读取文件，文件可能已被移动、删除，或没有读取权限。');
  }
  return { path: path.resolve(file), name: path.basename(file), ...decodeText(bytes) };
}

export class ReaderSession {
  state: ReaderState;
  history: HistoryEntry[] = [];
  currentLength = 0;
  warning?: string;
  currentFile: string | null = null;
  constructor(readonly stateFile: string) {
    try {
      const stored = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      this.state = sanitizeState(stored);
      const entries = Array.isArray(stored?.history) ? stored.history : [];
      for (const entry of entries) {
        const safe = sanitizeState(entry);
        if (!safe.file || this.history.some((item) => this.sameFile(item.file, safe.file!))) continue;
        this.history.push({ file: safe.file, name: path.basename(safe.file), anchor: safe.anchor,
          progress: this.progress(entry?.progress),
          lastOpened: typeof entry?.lastOpened === 'number' && Number.isFinite(entry.lastOpened) ? entry.lastOpened : 0 });
      }
      // Migrate the original single-book state without losing its reading position.
      if (!Array.isArray(stored?.history) && this.state.file) {
        this.history.push({ file: this.state.file, name: path.basename(this.state.file),
          anchor: this.state.anchor, progress: 0, lastOpened: 0 });
      }
      this.history.sort((a, b) => b.lastOpened - a.lastOpened);
    }
    catch (error) {
      this.state = sanitizeState(DEFAULT_STATE);
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warning = '上次的阅读记录无法读取，已使用默认设置。';
    }
  }
  open(file: string): Book {
    const book = readBook(file);
    const previous = this.history.find((entry) => this.sameFile(entry.file, book.path));
    const anchor = previous?.anchor ?? { offset: 0, inset: 0 };
    this.history = [{ file: book.path, name: book.name, anchor,
      progress: previous?.progress ?? 0, lastOpened: Date.now() },
    ...this.history.filter((entry) => !this.sameFile(entry.file, book.path))];
    this.currentFile = book.path;
    this.currentLength = book.text.length;
    this.state = { ...this.state, file: book.path, anchor };
    return book;
  }
  private sameFile(a: string, b: string): boolean {
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
  private progress(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  }
  private write(state: ReaderState, history: HistoryEntry[]): void {
    const temporary = `${this.stateFile}.tmp`;
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify({ ...state, history }, null, 2), 'utf8');
    fs.renameSync(temporary, this.stateFile);
  }
  remove(file: string): void {
    const history = this.history.filter((entry) => !this.sameFile(entry.file, file));
    const state = this.state.file && this.sameFile(this.state.file, file)
      ? { ...this.state, file: null } : this.state;
    this.write(state, history);
    this.state = state;
    this.history = history;
  }
  save(input: unknown): void {
    const state = sanitizeState(input);
    if (state.file !== this.currentFile) throw new Error('阅读文件已切换，请稍后重试。');
    const record = this.history.find((entry) => state.file && this.sameFile(entry.file, state.file));
    const history = this.history.map((entry) => entry === record ? { ...entry, anchor: state.anchor,
      progress: this.progress((input as { progress?: number })?.progress ?? state.anchor.offset / Math.max(1, this.currentLength) * 100) } : entry);
    // A removed current book remains readable, but autosave must not recreate its record.
    const stored = { ...state, file: record ? state.file : null };
    this.write(stored, history);
    this.state = stored;
    this.history = history;
  }
}
