import './style.css';
import type { Anchor, Book, ReaderState } from './shared';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const viewport = element('viewport');
const content = element('content');
const welcome = element('welcome');
const notice = element('notice');
const filename = element('filename');
const progress = element('progress');
const status = element('reading-state');
const smaller = element<HTMLButtonElement>('smaller');
const larger = element<HTMLButtonElement>('larger');
let state: ReaderState = { file: null, fontSize: 20, anchor: { offset: 0, inset: 0 } };
let book: Book | undefined;
let paragraphs: { node: Text; start: number; length: number }[] = [];
let stableAnchor: Anchor = { offset: 0, inset: 0 };
let ready = false;
let opening = false;
let reflowing = false;
let resizeFrame = 0;

function showError(message: string) {
  element('notice-text').textContent = message;
  notice.hidden = false;
}
function updateFont() {
  content.style.fontSize = `${state.fontSize}px`;
  element('font-size').textContent = String(state.fontSize);
  smaller.disabled = state.fontSize <= 14;
  larger.disabled = state.fontSize >= 32;
}
function characterRect(node: Text, offset: number): DOMRect {
  const range = document.createRange();
  range.setStart(node, Math.min(offset, Math.max(0, node.length - 1)));
  range.setEnd(node, Math.min(offset + 1, node.length));
  return range.getBoundingClientRect();
}

// Locate the first visible line by its text offset, independent of font size.
function captureAnchor(): Anchor {
  if (!book || !paragraphs.length) return { offset: 0, inset: 0 };
  const top = viewport.getBoundingClientRect().top;
  let low = 0, high = paragraphs.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (paragraphs[middle].node.parentElement!.getBoundingClientRect().bottom < top) low = middle + 1;
    else high = middle;
  }
  // Blank paragraphs have no character rectangles; advance to the next text.
  while (low < paragraphs.length - 1 && !paragraphs[low].length) low++;
  const paragraph = paragraphs[low];
  let left = 0, right = Math.max(0, paragraph.length - 1);
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (characterRect(paragraph.node, middle).bottom <= top) left = middle + 1;
    else right = middle;
  }
  const rect = characterRect(paragraph.node, left);
  return { offset: paragraph.start + left, inset: Math.max(-100, Math.min(100, rect.top - top)) };
}

function restoreAnchor(anchor: Anchor) {
  if (!book || !paragraphs.length) return;
  const offset = Math.min(Math.max(0, anchor.offset), book.text.length);
  let low = 0, high = paragraphs.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (paragraphs[middle].start <= offset) low = middle;
    else high = middle - 1;
  }
  const paragraph = paragraphs[low];
  const position = Math.min(Math.max(0, offset - paragraph.start), Math.max(0, paragraph.length - 1));
  const rect = paragraph.length ? characterRect(paragraph.node, position)
    : paragraph.node.parentElement!.getBoundingClientRect();
  viewport.scrollTop += rect.top - viewport.getBoundingClientRect().top - anchor.inset;
  stableAnchor = captureAnchor();
  updateProgress();
}

function updateProgress() {
  if (!book) return;
  const atEnd = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2;
  const percent = atEnd ? 100 : (stableAnchor.offset / Math.max(1, book.text.length)) * 100;
  progress.textContent = `已读 ${percent.toFixed(1)}%`;
}

function displayBook(next: Book, anchor: Anchor) {
  reflowing = true;
  book = next;
  state.file = next.path;
  filename.textContent = next.name;
  filename.title = next.path;
  document.title = `${next.name} · ZRead`;
  const fragment = document.createDocumentFragment();
  let offset = 0;
  paragraphs = next.text.split('\n').map((line) => {
    const p = document.createElement('p');
    // Treat TXT as text, never as HTML, even if it contains markup.
    const node = document.createTextNode(line);
    p.append(node);
    fragment.append(p);
    const entry = { node, start: offset, length: line.length };
    offset += line.length + 1;
    return entry;
  });
  content.replaceChildren(fragment);
  welcome.hidden = true;
  content.hidden = false;
  viewport.scrollTop = 0;
  updateFont();
  restoreAnchor(anchor);
  status.textContent = `${next.encoding} · 阅读进度自动保存`;
  reflowing = false;
}

async function save() {
  if (!ready || opening) return;
  state.anchor = book ? captureAnchor() : { offset: 0, inset: 0 };
  const result = await window.reader.save({ ...state, anchor: { ...state.anchor } });
  if (result.error) showError(result.error);
}

async function openBook() {
  if (!ready || opening) return;
  await save();
  opening = true;
  const buttons = [element<HTMLButtonElement>('open'), element<HTMLButtonElement>('welcome-open')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const result = await window.reader.open();
    if (result.error) showError(result.error);
    if (result.book) {
      notice.hidden = true;
      const anchor = result.book.path === state.file ? captureAnchor() : { offset: 0, inset: 0 };
      displayBook(result.book, anchor);
      viewport.focus();
    }
  } catch { showError('打开文件时发生错误，请重试。'); }
  finally {
    opening = false;
    buttons.forEach((button) => { button.disabled = false; });
    await save();
  }
}

function changeFont(delta: number) {
  const anchor = captureAnchor();
  reflowing = true;
  state.fontSize = Math.max(14, Math.min(32, state.fontSize + delta));
  updateFont();
  restoreAnchor(anchor);
  reflowing = false;
  void save();
}

element('open').addEventListener('click', () => void openBook());
element('welcome-open').addEventListener('click', () => void openBook());
element('dismiss').addEventListener('click', () => { notice.hidden = true; });
smaller.addEventListener('click', () => changeFont(-2));
larger.addEventListener('click', () => changeFont(2));
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault(); void openBook();
  }
});
viewport.addEventListener('scroll', () => {
  if (!reflowing && !resizeFrame) { stableAnchor = captureAnchor(); updateProgress(); }
});
let lastWidth = viewport.clientWidth;
new ResizeObserver(() => {
  const width = viewport.clientWidth;
  if (width === lastWidth) return;
  lastWidth = width;
  const anchor = { ...stableAnchor };
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    reflowing = true;
    restoreAnchor(anchor);
    reflowing = false;
    resizeFrame = 0;
  });
}).observe(viewport);

window.reader?.onClose(() => {
  void save().finally(() => window.reader.closeReady());
});
setInterval(() => { void save().catch(() => showError('阅读进度暂时无法保存，请稍后重试。')); }, 2000);

async function initialize() {
  if (!window.reader) return;
  try {
    const initial = await window.reader.initialize();
    element('startup-help').hidden = true;
    element('app').hidden = false;
    state = { ...initial.state, file: null };
    updateFont();
    if (initial.result.book) displayBook(initial.result.book, initial.state.anchor);
    if (initial.result.error || initial.warning) showError(initial.result.error || initial.warning!);
    ready = true;
    document.body.dataset.ready = 'true';
  } catch {
    element('app').hidden = true;
    element('startup-help').hidden = false;
    element('startup-help').setAttribute('role', 'alert');
  }
}
void initialize();
