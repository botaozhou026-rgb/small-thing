"""Run reader regression checks with: python -m unittest -v."""

from pathlib import Path
import tempfile
import unittest
import zipfile

from zread import ZRead, load_book


class ReaderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)

    def test_txt_encodings_and_chapter_offsets(self):
        content = "第一章 开始\n正文内容。\n第二章 继续\n故事继续。"
        for encoding in ("utf-8-sig", "gb18030", "utf-16"):
            with self.subTest(encoding=encoding):
                path = self.folder / "sample.txt"
                path.write_bytes(content.encode(encoding))
                _, text, chapters = load_book(path)
                self.assertEqual(text, content)
                self.assertEqual(len(chapters), 2)
                self.assertTrue(text[chapters[1][1]:].startswith("第二章"))

    def test_empty_and_unsupported_files(self):
        path = self.folder / "empty.txt"
        path.write_text("  \n", encoding="utf-8")
        with self.assertRaises(ValueError):
            load_book(path)
        with self.assertRaises(ValueError):
            load_book(self.folder / "unsupported.pdf")

    def test_epub_spine_order_and_html(self):
        path = self.folder / "sample.epub"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>')
            archive.writestr("OPS/book.opf", '<package><metadata><title>测试书</title></metadata><manifest><item id="b" href="b.xhtml"/><item id="a" href="a.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>')
            archive.writestr("OPS/a.xhtml", '<html><head><style>hidden</style></head><body><h1>第一章</h1><p>你好 &amp; 世界</p></body></html>')
            archive.writestr("OPS/b.xhtml", '<h1>第二章</h1><p>继续阅读</p>')
        title, text, chapters = load_book(path)
        self.assertEqual(title, "测试书")
        self.assertNotIn("hidden", text)
        self.assertIn("你好 & 世界", text)
        self.assertLess(text.index("第一章"), text.index("第二章"))
        self.assertTrue(text[chapters[1][1]:].startswith("第二章"))

    def test_window_search_and_progress_restore(self):
        path = self.folder / "sample.txt"
        path.write_text("第一章 开始\n" + "阅读测试正文。\n" * 150 + "第二章 继续\n结束。", encoding="utf-8")
        state = self.folder / "library.json"
        app = ZRead(state_path=state)
        try:
            app.update()
            app.open_book(path)
            app.update()
            app.search_term.set("阅读测试")
            app.search()
            self.assertTrue(app.text.tag_ranges("found"))
            app.chapter_list.selection_set(1)
            app.jump_chapter()
            app.update()
            position = app.text.index("@0,0")
            self.assertNotEqual(position, "1.0")
            app.theme.set("夜间")
            app.apply_style()
            app.save()
        finally:
            app.destroy()
        restored = ZRead(state_path=state)
        try:
            restored.update()
            restored.open_book(path)
            restored.update()
            self.assertEqual(restored.text.index("@0,0"), position)
            self.assertEqual(restored.theme.get(), "夜间")
        finally:
            restored.destroy()


if __name__ == "__main__":
    unittest.main()
