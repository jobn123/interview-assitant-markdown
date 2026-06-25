# Interview Assistant — 面试助手

一个帮助面试复习的 Markdown 问答工具，支持答案隐藏/显示切换。

## 功能

- 📝 支持 Markdown 格式的问答笔记（`# Q:` ~ `###### Q:` 任意级别标题）
- 👁️ 复习模式默认隐藏答案，点击显示
- 🌓 亮色/暗色主题
- ⌨️ 键盘快捷键
- 🖨️ 打印友好（自测模式）
- 🧩 浏览器插件（支持 file:// 和 GitHub 页面）

## 项目结构

```
├── core/           # 核心 Markdown Q&A 解析器
├── extension/      # Chrome/Edge 浏览器插件
├── web/            # 单文件 Web App
└── README.md
```

## 使用方式

### Web App
直接用浏览器打开 `web/index.html`，粘贴或拖拽 `.md` 文件即可。

### 浏览器插件
1. Chrome 打开 `chrome://extensions`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"，选择 `extension/` 目录
4. 打开本地 `.md` 文件或 GitHub 上的 Markdown 文件
