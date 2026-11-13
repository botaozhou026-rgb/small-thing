"""ZRead: a dependency-free desktop reader for TXT and EPUB books."""

from __future__ import annotations

import json
import os
from pathlib import Path
import posixpath
import re
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from html.parser import HTMLParser
from urllib.parse import unquote
import xml.etree.ElementTree as ET
import zipfile


THEMES = {
    "纸白": ("#f5f2eb", "#242b32", "#e7e2d8", "#366b59"),
    "护眼": ("#dfe9dc", "#263b2d", "#ccd9c8", "#366b59"),
    "夜间": ("#20252c", "#d5dbe2", "#2b323b", "#89bea5"),
}
CHAPTER_RE = re.compile(
    r"^\s*(?:第[零〇一二三四五六七八九十百千万两\d]+[章节卷部回集].{0,60}"
    r"|(?:chapter|part)\s+[\divxlc]+\b.{0,60}|序章|序言|前言|楔子|尾声|后记)\s*$", re.I)


class PlainHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "head"):
            self.hidden += 1
        if not self.hidden and tag in ("p", "div", "br", "li", "h1", "h2", "h3", "section"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "head"):
            self.hidden = max(0, self.hidden - 1)
        if not self.hidden and tag in ("p", "div", "li", "h1", "h2", "h3", "section"):
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)

    def text(self):
        return re.sub(r"\n[ \t]*\n(?:[ \t]*\n)+", "\n\n", "".join(self.parts)).strip()


def load_book(path):
    """Return title, plain text, and (chapter title, character offset) pairs."""
    path = Path(path)
    if path.suffix.lower() == ".txt":
        raw = path.read_bytes()
        if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
            text = raw.decode("utf-16")
        else:
            for encoding in ("utf-8-sig", "gb18030", "big5"):
                try:
                    text = raw.decode(encoding)
                    break
                except UnicodeDecodeError:
                    continue
            else:
                raise ValueError("无法识别文本编码，请将文件另存为 UTF-8 后重试。")
        text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
        chapters, offset = [], 0
        for line in text.splitlines(keepends=True):
            if CHAPTER_RE.fullmatch(line.rstrip("\n")):
                chapters.append((line.strip(), offset))
            offset += len(line)
        if not text.strip():
            raise ValueError("这份文件没有可阅读的文字。")
        return path.stem, text, chapters
    if path.suffix.lower() != ".epub":
        raise ValueError("目前支持 TXT 和 EPUB 文件。")
    with zipfile.ZipFile(path) as archive:
        container = ET.fromstring(archive.read("META-INF/container.xml"))
        rootfile = container.find(".//{*}rootfile")
        if rootfile is None:
            raise ValueError("EPUB 缺少书籍索引。")
        package_path = rootfile.attrib["full-path"]
        package = ET.fromstring(archive.read(package_path))
        title = package.find(".//{*}metadata/{*}title")
        title = title.text if title is not None and title.text else path.stem
        manifest = {item.attrib["id"]: item.attrib
                    for item in package.findall(".//{*}manifest/{*}item")}
        chapters, pieces, offset = [], [], 0
        for ref in package.findall(".//{*}spine/{*}itemref"):
            item = manifest.get(ref.attrib.get("idref"), {})
            if ref.attrib.get("linear") == "no" or not item.get("href"):
                continue
            href = unquote(item["href"].split("#", 1)[0])
            member = posixpath.normpath(posixpath.join(posixpath.dirname(package_path), href))
            markup = archive.read(member).decode("utf-8-sig")
            parser = PlainHTML()
            parser.feed(markup)
            body = parser.text()
            if not body:
                continue
            heading = re.search(r"<h[1-3]\b[^>]*>(.*?)</h[1-3]>", markup, re.I | re.S)
            label = PlainHTML()
            label.feed(heading.group(1) if heading else body.splitlines()[0])
            chapters.append((label.text()[:80] or f"第 {len(chapters) + 1} 节", offset))
            pieces.append(body + "\n\n")
            offset += len(pieces[-1])
        if not pieces:
            raise ValueError("没有找到可阅读的正文。该 EPUB 可能使用了加密保护或不受支持的格式。")
        return title, "".join(pieces), chapters


class ZRead(tk.Tk):
    def __init__(self, state_path=None):
        super().__init__()
        self.title("ZRead · 留一点时间给阅读")
        self.geometry("1120x780")
        self.minsize(820, 540)
        self.state_path = Path(state_path) if state_path else Path(
            os.environ.get("LOCALAPPDATA", str(Path.home()))) / "ZRead" / "library.json"
        try:
            self.saved = json.loads(self.state_path.read_text(encoding="utf-8"))
            if not isinstance(self.saved, dict):
                self.saved = {}
        except (OSError, ValueError):
            self.saved = {}
        self.library = self.saved.get("library", {})
        if not isinstance(self.library, dict):
            self.library = {}
        self.library = {key: value for key, value in self.library.items() if isinstance(value, dict)}
        self.current = None
        self.chapters = []
        self.book_text = ""
        try:
            size = max(12, min(36, int(self.saved.get("font_size", 19))))
        except (ValueError, TypeError):
            size = 19
        self.font_size = tk.IntVar(value=size)
        self.theme = tk.StringVar(value=self.saved.get("theme", "纸白"))
        if self.theme.get() not in THEMES:
            self.theme.set("纸白")
        self.search_term = tk.StringVar()
        self.status = tk.StringVar(value="打开一本书，开始阅读。支持 TXT / EPUB")
        self.build_ui()
        self.apply_style()
        self.refresh_library()
        self.bind("<Control-o>", lambda _: self.choose_book())
        self.bind("<Control-f>", lambda _: self.search_entry.focus_set())
        self.bind("<F11>", lambda _: self.toggle_fullscreen())
        self.bind("<Escape>", lambda _: self.attributes("-fullscreen", False))
        self.protocol("WM_DELETE_WINDOW", self.close)
        self.after(3000, self.autosave)
        last = self.saved.get("last_book")
        if isinstance(last, str) and Path(last).is_file():
            self.after(100, lambda: self.open_book(last))

    def toggle_fullscreen(self):
        self.attributes("-fullscreen", not self.attributes("-fullscreen"))

    def build_ui(self):
        self.toolbar = tk.Frame(self, padx=18, pady=14)
        self.toolbar.pack(fill="x")
        self.brand = tk.Label(self.toolbar, text="ZRead", font=("Segoe UI", 22, "bold"))
        self.brand.pack(side="left", padx=(0, 24))
        ttk.Button(self.toolbar, text="＋ 打开书籍", command=self.choose_book).pack(side="left")
        ttk.Label(self.toolbar, text="  字号 ").pack(side="left", padx=(18, 0))
        ttk.Spinbox(self.toolbar, from_=12, to=36, width=4, textvariable=self.font_size,
                    command=self.apply_style, state="readonly").pack(side="left")
        theme = ttk.Combobox(self.toolbar, values=list(THEMES), textvariable=self.theme,
                             width=6, state="readonly")
        theme.pack(side="left", padx=12)
        theme.bind("<<ComboboxSelected>>", lambda _: self.apply_style())
        ttk.Button(self.toolbar, text="全屏 F11", command=self.toggle_fullscreen).pack(side="right")
        self.panes = tk.PanedWindow(self, orient="horizontal", sashwidth=5, borderwidth=0)
        self.panes.pack(fill="both", expand=True, padx=18)
        self.sidebar = tk.Frame(self.panes, width=230)
        self.panes.add(self.sidebar, minsize=180, width=230)
        self.tabs = ttk.Notebook(self.sidebar)
        self.tabs.pack(fill="both", expand=True)
        self.shelf, self.toc = tk.Frame(self.tabs), tk.Frame(self.tabs)
        self.tabs.add(self.shelf, text="  我的书架  ")
        self.tabs.add(self.toc, text="  章节目录  ")
        self.books = self.make_list(self.shelf)
        self.books.bind("<Double-Button-1>", self.open_selected)
        self.books.bind("<Return>", self.open_selected)
        ttk.Button(self.shelf, text="阅读选中书籍", command=self.open_selected).pack(fill="x", pady=6)
        ttk.Button(self.shelf, text="从书架移除", command=self.remove_selected).pack(fill="x", pady=(0, 6))
        self.chapter_list = self.make_list(self.toc)
        self.chapter_list.bind("<<ListboxSelect>>", self.jump_chapter)
        self.reading = tk.Frame(self.panes)
        self.panes.add(self.reading, minsize=440)
        self.book_label = tk.Label(self.reading, text="你的下一段旅程，从这里开始", anchor="w",
                                   font=("Microsoft YaHei UI", 13, "bold"), padx=28, pady=14)
        self.book_label.pack(fill="x")
        search_bar = ttk.Frame(self.reading, padding=(20, 0, 20, 8))
        search_bar.pack(fill="x")
        self.search_entry = ttk.Entry(search_bar, textvariable=self.search_term)
        self.search_entry.pack(side="left", fill="x", expand=True)
        self.search_entry.bind("<Return>", lambda _: self.search())
        ttk.Button(search_bar, text="查找下一处", command=self.search).pack(side="left", padx=(8, 0))
        body = tk.Frame(self.reading)
        body.pack(fill="both", expand=True)
        scrollbar = ttk.Scrollbar(body)
        scrollbar.pack(side="right", fill="y")
        self.text = tk.Text(body, wrap="word", borderwidth=0, highlightthickness=0,
                            padx=38, pady=22, cursor="arrow", state="disabled", undo=False,
                            yscrollcommand=lambda a, b: self.on_scroll(scrollbar, a, b))
        self.text.pack(fill="both", expand=True)
        scrollbar.configure(command=self.text.yview)
        self.text.bind("<space>", lambda _: self.page(1))
        self.text.bind("<Prior>", lambda _: self.page(-1))
        self.text.bind("<Next>", lambda _: self.page(1))
        self.text.tag_configure("found", background="#edc66b", foreground="#20252c")
        self.set_text("\n欢迎来到 ZRead\n\n打开一本喜欢的书，让阅读回归简单。\n\n"
                      "支持 TXT 文本和 EPUB 电子书\n自动识别常见中文文本编码\n"
                      "书架、章节目录、全文搜索\n字体大小、三种阅读主题、自动记忆进度\n\n"
                      "Ctrl+O 打开书籍    Ctrl+F 搜索\n空格 / PageDown 下一页    PageUp 上一页\nF11 全屏    Esc 退出全屏")
        footer = ttk.Frame(self, padding=(20, 12))
        footer.pack(fill="x")
        ttk.Label(footer, textvariable=self.status).pack(side="left")
        ttk.Button(footer, text="下一页 →", command=lambda: self.page(1)).pack(side="right")
        ttk.Button(footer, text="← 上一页", command=lambda: self.page(-1)).pack(side="right", padx=8)

    @staticmethod
    def make_list(parent):
        frame = tk.Frame(parent)
        frame.pack(fill="both", expand=True)
        scroll = ttk.Scrollbar(frame)
        scroll.pack(side="right", fill="y")
        box = tk.Listbox(frame, borderwidth=0, highlightthickness=0, activestyle="none",
                         font=("Microsoft YaHei UI", 10), exportselection=False, yscrollcommand=scroll.set)
        box.pack(fill="both", expand=True)
        scroll.configure(command=box.yview)
        return box

    def apply_style(self):
        bg, fg, panel, accent = THEMES[self.theme.get()]
        self.configure(bg=bg)
        for widget in (self.toolbar, self.sidebar, self.reading, self.panes):
            widget.configure(bg=bg)
        for label in (self.brand, self.book_label):
            label.configure(bg=bg, fg=accent)
        for box in (self.books, self.chapter_list):
            box.configure(bg=panel, fg=fg, selectbackground=accent, selectforeground=bg)
        self.text.configure(bg=bg, fg=fg, insertbackground=fg,
                            font=("Microsoft YaHei", self.font_size.get()), spacing1=5, spacing3=10, spacing2=5)
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("TFrame", background=bg)
        style.configure("TLabel", background=bg, foreground=fg)
        style.configure("TButton", padding=(10, 6), background=panel, foreground=fg)
        style.configure("TNotebook", background=bg, borderwidth=0)
        style.configure("TNotebook.Tab", background=panel, foreground=fg, padding=(6, 8))

    def set_text(self, content):
        self.text.configure(state="normal")
        self.text.delete("1.0", "end")
        self.text.insert("1.0", content)
        self.text.configure(state="disabled")

    def choose_book(self):
        path = filedialog.askopenfilename(title="选择一本书", filetypes=[
            ("电子书", "*.txt *.epub"), ("TXT 文本", "*.txt"), ("EPUB 电子书", "*.epub")])
        if path:
            self.open_book(path)

    def open_book(self, path):
        try:
            title, content, chapters = load_book(path)
        except (OSError, ValueError, KeyError, ET.ParseError, zipfile.BadZipFile) as error:
            messagebox.showerror("无法打开书籍", str(error))
            return
        self.remember_position()
        self.current = str(Path(path).resolve())
        self.book_text, self.chapters = content, chapters
        entry = self.library.setdefault(self.current, {})
        entry["title"] = title
        self.book_label.configure(text=title)
        self.title(f"{title} · ZRead")
        self.set_text(content)
        self.text.mark_set("search_from", "1.0")
        self.chapter_list.delete(0, "end")
        for label, _ in chapters:
            self.chapter_list.insert("end", label)
        self.refresh_library()
        self.update_idletasks()
        try:
            self.text.yview(entry.get("position", "1.0"))
        except tk.TclError:
            self.text.yview("1.0")
        self.text.focus_set()

    def refresh_library(self):
        self.library_paths = list(self.library)
        self.books.delete(0, "end")
        for path in self.library_paths:
            self.books.insert("end", self.library[path].get("title", Path(path).stem))

    def open_selected(self, event=None):
        selection = self.books.curselection()
        if selection:
            self.open_book(self.library_paths[selection[0]])

    def remove_selected(self):
        selection = self.books.curselection()
        if selection:
            del self.library[self.library_paths[selection[0]]]
            self.refresh_library()
            self.save()

    def jump_chapter(self, event=None):
        selection = self.chapter_list.curselection()
        if selection:
            offset = self.chapters[selection[0]][1]
            self.text.yview(f"1.0 + {offset} chars")

    def search(self):
        term = self.search_term.get()
        if not term or not self.current:
            return
        start = self.text.index("search_from")
        found = self.text.search(term, start, stopindex="end", nocase=True, exact=True)
        if not found:
            found = self.text.search(term, "1.0", stopindex=start, nocase=True, exact=True)
        self.text.tag_remove("found", "1.0", "end")
        if found:
            end = f"{found} + {len(term)} chars"
            self.text.tag_add("found", found, end)
            self.text.mark_set("search_from", end)
            self.text.see(found)
            self.status.set(f"找到「{term}」 · 第 {found.split('.')[0]} 行")
        else:
            self.status.set(f"未找到「{term}」")

    def page(self, direction):
        self.text.yview_scroll(direction, "pages")
        return "break"

    def on_scroll(self, scrollbar, first, last):
        scrollbar.set(first, last)
        if self.current:
            progress = 100 if float(last) >= 1 else float(first) * 100
            self.status.set(f"阅读进度 {progress:.1f}% · {len(self.book_text):,} 字 · 自动保存进度")

    def remember_position(self):
        if self.current and self.current in self.library:
            self.library[self.current]["position"] = self.text.index("@0,0")

    def save(self):
        self.remember_position()
        state = {"library": self.library, "last_book": self.current if self.current in self.library else None,
                 "theme": self.theme.get(), "font_size": self.font_size.get()}
        try:
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.state_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
            temporary.replace(self.state_path)
        except OSError:
            self.status.set("进度暂时无法保存，请检查本地存储权限。")

    def autosave(self):
        self.save()
        self.after(3000, self.autosave)

    def close(self):
        self.save()
        self.destroy()


if __name__ == "__main__":
    ZRead().mainloop()
