# ZRead

一个本地 Windows TXT 阅读器，基于 Electron + TypeScript + Vite。

第一版仅包含打开 TXT、明亮主题、自动换行与滚动阅读、字号调整，以及上次阅读状态恢复。无需登录和联网，原始文件只读。

## 直接启动

双击项目根目录的 `Start-ZRead.cmd`。它优先运行已打包的 `release/ZRead-win32-x64/ZRead.exe`；没有打包文件时，会通过 Node.js 构建并启动。首次安装依赖需要联网。

也可以直接双击 `release/ZRead-win32-x64/ZRead.exe`。请保留其所在文件夹内的其他文件。

`index.html` 是界面源码，不是程序入口，不能直接用 Chrome 或其他浏览器打开来使用。直接打开时，页面会显示正确的启动方式。

## 开发与运行

需要 Node.js 22.12+（或兼容的更新 LTS 版本）和 npm。

```powershell
npm install
npm run dev
```

`npm run dev` 提供界面热更新；修改主进程或 preload 后需重新启动。首次安装依赖需要联网下载 Electron。

构建并启动正式界面：

```powershell
npm start
```

生成 Windows x64 应用文件夹：

```powershell
npm run pack
```

生成后运行 `release/ZRead-win32-x64/ZRead.exe`。分发时需要保留整个应用文件夹。

## 测试

```powershell
npm run check
```

包含 TypeScript 检查、生产构建、文件解析及状态存储单元测试、真实 Electron 窗口端到端测试。不需要另外下载浏览器；端到端测试使用 Electron 自带浏览器，在临时目录保存独立测试数据。

## 使用与数据

- 点击“打开 TXT”，或按 Ctrl+O 打开文件；点击 A− / A＋调整字号（14–32）。
- 支持 UTF-8（含 BOM）与 GBK / GB18030；无编码标记的文本无法保证完全自动判别，乱码时建议另存为 UTF-8。
- 单文件上限 50 MB，超出时提示拆分；此版本不面向超大日志文件。
- 阅读状态每 2 秒保存一次，正常关闭窗口时再保存一次。异常退出可能丢失最近几秒的进度。
- 以正文字符位置保存进度；改变字号或窗口宽度时尽量保持原文附近的位置。修改原始 TXT 内容后，恢复位置可能偏移。
- 设置保存在 Electron 用户数据目录中的 `reading-state.json`（Windows 通常为 `%APPDATA%/zread/reading-state.json`）。只记录上次一本书，不复制或修改原文件。
- 文件读取失败时保留当前正文；上次文件无法恢复时回到欢迎界面，可继续选择其他文件。

产品范围见 [PRODUCT_DESIGN.md](PRODUCT_DESIGN.md)。原 Python 原型已由此版本替换。
