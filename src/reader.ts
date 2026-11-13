import fs from 'node:fs';
import path from 'node:path';
import type { Anchor, Book, ReaderState } from './shared';

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
  warning?: string;
  currentFile: string | null = null;
  constructor(readonly stateFile: string) {
    try { this.state = sanitizeState(JSON.parse(fs.readFileSync(stateFile, 'utf8'))); }
    catch (error) {
      this.state = sanitizeState(DEFAULT_STATE);
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warning = '上次的阅读记录无法读取，已使用默认设置。';
    }
  }
  open(file: string): Book {
    const book = readBook(file);
    this.currentFile = book.path;
    return book;
  }
  save(input: unknown): void {
    const state = sanitizeState(input);
    if (state.file !== this.currentFile) throw new Error('阅读文件已切换，请稍后重试。');
    const temporary = `${this.stateFile}.tmp`;
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(temporary, this.stateFile);
    this.state = state;
  }
}
