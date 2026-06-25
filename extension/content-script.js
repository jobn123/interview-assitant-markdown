/**
 * Interview Assistant — Content Script
 *
 * 检测页面中的 Markdown Q&A 内容，注入交互式答案切换功能。
 * 支持：GitHub blob、GitLab blob、file:// 本地 .md 文件、raw 文本
 */

(function() {
  'use strict';

  // 防止重复处理
  if (document.documentElement.hasAttribute('data-ia-processed')) return;
  document.documentElement.setAttribute('data-ia-processed', 'true');

  // ==================== 页面类型检测 ====================
  const url = window.location.href;

  function isGitHubBlob() {
    return url.includes('github.com') && url.includes('/blob/');
  }

  function isGitLabBlob() {
    return url.includes('gitlab.com') && url.includes('/blob/');
  }

  function isRawMarkdown() {
    return url.includes('raw.githubusercontent.com') ||
           url.endsWith('.md') || url.endsWith('.markdown');
  }

  function isFileProtocol() {
    return url.startsWith('file://');
  }

  // ==================== 标题检测（与 parser.js 归一化逻辑一致） ====================

  /**
   * 判断标题文字是否匹配"问题"模式
   * 支持：Q:/Q：/问题：/Question:/Q1:/1./1、等所有归一化格式
   */
  function isQuestionHeading(text) {
    const t = text.trim();
    if (!t) return false;

    // 标准 Q: 格式
    if (/^Q:?\s/i.test(t)) return true;

    // 应用归一化后检测
    let n = t
      .replace(/：/g, ':')
      .replace(/^问题\d*\s*:?\s*/i, 'Q: ')
      .replace(/^Question\s*:?\s*/i, 'Q: ')
      .replace(/^Q\d+\s*:?\s*/i, 'Q: ')
      .replace(/^\*{1,3}\s*(Q:?)\s*\*{1,3}\s*/i, 'Q: ');

    // 归一化后是 Q: 格式？
    if (/^Q:?\s/i.test(n)) return true;

    // 阿拉伯数字编号：1. / 2、/ 3) / 10 标题
    if (/^\d+[\.、．)\-]?\s/.test(n)) return true;

    // 纯文本标题 → 隐式问题（兜底规则）
    // 排除中文数字章节和非问题标记
    {
      const isChineseSection = /^[一二三四五六七八九十百]+\s*[、，,.]/.test(n);
      const isNonQuestion = /^(参考|总结|附录|小结|参考资料|References|前言|后记|致谢|鸣谢)/i.test(n);
      if (!isChineseSection && !isNonQuestion) return true;
    }

    return false;
  }

  /**
   * 从标题文字中提取纯问题文本（去掉 Q: 前缀或编号）
   */
  function extractQuestionText(text) {
    const t = text.trim();

    // 标准 Q: 格式
    let m = t.match(/^Q:?\s+(.+)/i);
    if (m) return m[1];

    // 归一化后提取
    let n = t
      .replace(/：/g, ':')
      .replace(/^问题\d*\s*:?\s*/i, 'Q: ')
      .replace(/^Question\s*:?\s*/i, 'Q: ')
      .replace(/^Q\d+\s*:?\s*/i, 'Q: ')
      .replace(/^\*{1,3}\s*(Q:?)\s*\*{1,3}\s*/i, 'Q: ');

    m = n.match(/^Q:?\s+(.+)/i);
    if (m) return m[1];

    // 阿拉伯数字编号
    m = n.match(/^\d+[\.、．)\-]?\s*(.+)/);
    if (m) return m[1];

    return t;
  }

  /** 简化版 markdown → HTML 渲染 */
  function simpleMarkdownToHTML(md) {
    if (!md) return '';
    let html = md;

    // 保存代码块
    const blocks = [];
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const idx = blocks.length;
      blocks.push({ lang, code: code.trimEnd() });
      return `%%CB${idx}%%`;
    });

    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    html = html.replace(/^(?!<[houlbip1-6]|<pre)(.+)$/gm, '<p>$1</p>');
    html = html.replace(/<p><(h[1-6]|ul|ol|pre)/g, '<$1');
    html = html.replace(/<\/(h[1-6]|ul|ol|pre)><\/p>/g, '</$1>');

    // 还原代码块
    html = html.replace(/%%CB(\d+)%%/g, (_, idx) => {
      const cb = blocks[idx];
      return `<pre><code>${escapeHTML(cb.code)}</code></pre>`;
    });

    return html;
  }

  // ==================== 工具函数 ====================
  function escapeHTML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ==================== Raw Text 模式 ====================
  function processAsRawText() {
    let rawText = '';

    // 优先找 <pre> 标签
    const preTag = document.querySelector('pre');
    if (preTag && preTag.textContent.length > 100) {
      rawText = preTag.textContent;
    } else {
      rawText = document.body.textContent;
    }

    const result = parseMarkdown(rawText);

    if (result.pairs.length === 0) return false;

    // 构建完整 HTML
    let html = '<div id="ia-root" style="max-width:900px;margin:0 auto;padding:20px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif;">';

    // Toolbar
    html += `
      <div id="ia-toolbar" style="position:sticky;top:0;z-index:100;background:#f8f9fa;padding:14px 18px;border-radius:10px;margin-bottom:24px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px solid #dee2e6;">
        <button id="ia-show-all" style="padding:8px 16px;background:#4361ee;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;">显示全部</button>
        <button id="ia-hide-all" style="padding:8px 16px;background:transparent;color:#4361ee;border:2px solid #4361ee;border-radius:6px;cursor:pointer;font-weight:600;">隐藏全部</button>
        <span id="ia-counter" style="margin-left:auto;color:#6c757d;font-size:0.85rem;"></span>
      </div>`;

    if (result.preamble) {
      html += `<div style="padding:12px 0;color:#6c757d;">${simpleMarkdownToHTML(result.preamble)}</div>`;
    }

    result.pairs.forEach((pair, idx) => {
      const hTag = 'h' + Math.min(pair.level, 6);
      html += `
        <div class="ia-card" data-ia-id="${pair.id}" style="margin-bottom:16px;border:1px solid #dee2e6;border-radius:10px;overflow:hidden;">
          <div class="ia-header" style="display:flex;align-items:flex-start;gap:10px;padding:14px 18px;background:#f0f4ff;cursor:pointer;user-select:none;">
            <span class="ia-toggle-icon" style="flex-shrink:0;width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:#4361ee;color:#fff;border-radius:50%;font-weight:700;font-size:1rem;transition:transform 0.3s;">+</span>
            <${hTag} style="font-size:1.02rem;font-weight:700;margin:0;padding-top:1px;">${escapeHTML(pair.question)}</${hTag}>
          </div>
          <div class="ia-body" style="max-height:0;overflow:hidden;transition:max-height 0.45s ease-out;">
            <div style="padding:18px;line-height:1.8;">${simpleMarkdownToHTML(pair.answer) || '<em style="color:#999;">（未填写答案）</em>'}</div>
          </div>
        </div>`;
    });

    if (result.postamble) {
      html += `<div style="margin-top:24px;padding-top:20px;border-top:1px solid #dee2e6;color:#6c757d;">${simpleMarkdownToHTML(result.postamble)}</div>`;
    }

    html += '</div>';

    // 替换 body 内容
    document.body.innerHTML = html;

    // 绑定事件
    injectStyles();
    bindToolbarEvents();

    // 委托点击：所有 .ia-header 点击时切换对应答案
    document.getElementById('ia-root').addEventListener('click', (e) => {
      const header = e.target.closest('.ia-header');
      if (!header) return;
      const card = header.closest('.ia-card');
      const body = card ? card.querySelector('.ia-body') : null;
      if (!card || !body) return;

      const isRevealed = card.classList.contains('ia-revealed');
      if (isRevealed) {
        card.classList.remove('ia-revealed');
        body.style.maxHeight = '0';
        body.style.transition = 'max-height 0.45s ease-out';
      } else {
        card.classList.add('ia-revealed');
        body.style.maxHeight = '8000px';
        body.style.transition = 'max-height 0.6s ease-in';
      }
    });

    return true;
  }

  // ==================== DOM 模式 (GitHub/GitLab/已渲染 HTML) ====================
  function getContainer() {
    // GitHub
    const ghArticle = document.querySelector('.markdown-body');
    if (ghArticle) return ghArticle;

    // GitLab
    const glContent = document.querySelector('.file-content');
    if (glContent) return glContent;

    // Generic - look for h1-h6 elements
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headings.length > 0) {
      // Find the closest common ancestor... or just use the first heading's parent
      // Better: use the body
      return document.body;
    }

    return null;
  }

  function processAsDOM() {
    const container = getContainer();
    if (!container) return false;

    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');

    const qHeadings = [];
    headings.forEach(h => {
      const text = (h.textContent || '').trim();
      if (isQuestionHeading(text)) {
        qHeadings.push(h);
      }
    });

    if (qHeadings.length === 0) return false;

    // 对于每个 Q 标题：
    // - 包装标题，添加切换按钮
    // - 收集后续兄弟节点直到下一个标题（任意级别）
    // - 包装为答案容器
    qHeadings.forEach((qH, idx) => {
      const qText = extractQuestionText(qH.textContent || '');

      // 查找下一个标题（任意级别）
      let nextHeading = null;
      let current = qH.nextElementSibling;
      while (current) {
        if (/^H[1-6]$/.test(current.tagName)) {
          nextHeading = current;
          break;
        }
        current = current.nextElementSibling;
      }

      // 收集 Q 标题和下一个标题之间的兄弟节点
      const answerNodes = [];
      let node = qH.nextElementSibling;
      while (node && node !== nextHeading) {
        answerNodes.push(node);
        node = node.nextElementSibling;
      }

      // 包装 Q 标题
      const wrapper = document.createElement('div');
      wrapper.className = 'ia-card';
      wrapper.setAttribute('data-ia-id', 'q-' + idx);
      qH.parentNode.insertBefore(wrapper, qH);
      wrapper.appendChild(qH);

      // 创建 header wrapper
      const headerWrapper = document.createElement('div');
      headerWrapper.className = 'ia-header';
      wrapper.insertBefore(headerWrapper, qH);
      headerWrapper.appendChild(qH);

      // 添加切换图标
      const toggleIcon = document.createElement('span');
      toggleIcon.className = 'ia-toggle-icon';
      toggleIcon.textContent = '+';
      headerWrapper.insertBefore(toggleIcon, qH);

      // 修改 Q 标题：移除 Q: 前缀，只显示问题文本
      // (保留原有的 .textContent 更新可能影响 GitHub anchor)
      // 不修改 DOM 文本，保持与页面原生样式一致

      // 包装答案节点
      const answerContainer = document.createElement('div');
      answerContainer.className = 'ia-body';
      // 用 inline style 确保隐藏，不受页面 CSS 干扰
      answerContainer.style.maxHeight = '0';
      answerContainer.style.overflow = 'hidden';
      answerContainer.style.transition = 'max-height 0.45s ease-out';

      const answerInner = document.createElement('div');
      answerInner.className = 'ia-answer-inner';

      if (answerNodes.length > 0) {
        answerNodes.forEach(n => answerInner.appendChild(n));
      } else {
        answerInner.innerHTML = '<em style="color:#999;">（未填写答案）</em>';
      }
      answerContainer.appendChild(answerInner);
      wrapper.appendChild(answerContainer);

      // 点击切换：直接操作 inline style，最可靠
      let isRevealed = false;
      headerWrapper.addEventListener('click', () => {
        isRevealed = !isRevealed;
        if (isRevealed) {
          wrapper.classList.add('ia-revealed');
          answerContainer.style.maxHeight = '8000px';
          answerContainer.style.transition = 'max-height 0.6s ease-in';
        } else {
          wrapper.classList.remove('ia-revealed');
          answerContainer.style.maxHeight = '0';
          answerContainer.style.transition = 'max-height 0.45s ease-out';
        }
      });
    });

    // 注入 Toolbar
    injectToolbar();
    injectStyles();
    bindToolbarEvents();

    return true;
  }

  // ==================== Toolbar ====================
  function injectToolbar() {
    if (document.getElementById('ia-toolbar')) return;

    const toolbar = document.createElement('div');
    toolbar.id = 'ia-toolbar';
    toolbar.innerHTML = `
      <button id="ia-toggle-all">👁️ 显示全部</button>
      <span id="ia-counter"></span>
    `;
    document.body.insertBefore(toolbar, document.body.firstChild);
  }

  function bindToolbarEvents() {
    const toggleAllBtn = document.getElementById('ia-toggle-all');
    const counter = document.getElementById('ia-counter');

    if (!toggleAllBtn) return;

    // 检测当前模式
    const isCardMode = document.querySelectorAll('.ia-card').length > 0;
    const isLightMode = document.querySelectorAll('.ia-inline-toggle').length > 0;

    // 暴露给 toggle 按钮用的更新函数
    window.__ia_updateToolbarUI = function() {
      const total = getTotal();
      const shown = getShownCount();
      if (counter) counter.textContent = shown + '/' + total + ' 已显示';
      toggleAllBtn.textContent = (shown === total && total > 0) ? '🙈 隐藏全部' : '👁️ 显示全部';
    };

    function getShownCount() {
      if (isCardMode) {
        return document.querySelectorAll('.ia-card.ia-revealed').length;
      }
      if (isLightMode) {
        // 检查有多少组答案已显示
        const toggles = document.querySelectorAll('.ia-inline-toggle');
        let shown = 0;
        toggles.forEach(function(b) {
          if (b.textContent.trim() === '−') shown++;
        });
        return shown;
      }
      return 0;
    }

    function getTotal() {
      if (isCardMode) return document.querySelectorAll('.ia-card').length;
      if (isLightMode) {
        const targets = new Set();
        document.querySelectorAll('.ia-inline-toggle').forEach(function(b) {
          targets.add(b.getAttribute('data-ia-target'));
        });
        return targets.size;
      }
      return 0;
    }

    function updateUI() {
      window.__ia_updateToolbarUI();
    }

    function showAll() {
      if (isCardMode) {
        document.querySelectorAll('.ia-card .ia-body').forEach(function(body) {
          body.style.maxHeight = '8000px';
          body.style.transition = 'max-height 0.6s ease-in';
        });
        document.querySelectorAll('.ia-card').forEach(function(c) { c.classList.add('ia-revealed'); });
      }
      if (isLightMode) {
        document.querySelectorAll('[data-ia-answer]').forEach(function(el) { el.style.display = ''; });
        document.querySelectorAll('.ia-inline-toggle').forEach(function(b) { b.textContent = '− '; });
      }
      updateUI();
    }

    function hideAll() {
      if (isCardMode) {
        document.querySelectorAll('.ia-card .ia-body').forEach(function(body) {
          body.style.maxHeight = '0';
          body.style.transition = 'max-height 0.45s ease-out';
        });
        document.querySelectorAll('.ia-card').forEach(function(c) { c.classList.remove('ia-revealed'); });
      }
      if (isLightMode) {
        document.querySelectorAll('[data-ia-answer]').forEach(function(el) {
          el.style.setProperty('display', 'none', 'important');
        });
        document.querySelectorAll('.ia-inline-toggle').forEach(function(b) { b.textContent = '+ '; });
      }
      updateUI();
    }

    function toggleAll() {
      const total = getTotal();
      const shown = getShownCount();
      console.log('[IA] toggleAll: shown=' + shown + ' total=' + total);
      if (shown === total && total > 0) {
        hideAll();
      } else {
        showAll();
      }
    }

    toggleAllBtn.addEventListener('click', toggleAll);
    console.log('[IA] Toolbar bound. isCardMode:', isCardMode, 'isLightMode:', isLightMode);
    updateUI();
  }

  // ==================== 注入样式 ====================
  function injectStyles() {
    if (document.getElementById('ia-styles')) return;

    const style = document.createElement('style');
    style.id = 'ia-styles';
    style.textContent = `
      /* Toolbar */
      #ia-toolbar {
        position: fixed !important;
        top: 16px !important;
        right: 16px !important;
        z-index: 99999 !important;
        background: #ffffff !important;
        padding: 12px 16px !important;
        border-radius: 12px !important;
        display: flex !important;
        gap: 8px !important;
        align-items: center !important;
        flex-wrap: wrap !important;
        border: 1px solid #dee2e6 !important;
        box-shadow: 0 4px 24px rgba(0,0,0,0.12) !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif !important;
        font-size: 14px !important;
        max-width: calc(100vw - 32px) !important;
      }

      #ia-toolbar button {
        padding: 8px 16px !important;
        border: none !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        font-weight: 600 !important;
        font-size: 0.85rem !important;
        font-family: inherit !important;
        transition: all 0.2s ease !important;
        white-space: nowrap !important;
      }

      #ia-show-all {
        background: #4361ee !important;
        color: #fff !important;
      }
      #ia-show-all:hover { background: #3a56d4 !important; }

      #ia-hide-all {
        background: transparent !important;
        color: #4361ee !important;
        border: 2px solid #4361ee !important;
      }
      #ia-hide-all:hover { background: #f0f4ff !important; }

      #ia-counter {
        color: #6c757d !important;
        font-size: 0.82rem !important;
        margin-left: 4px !important;
      }

      /* Q&A Cards */
      .ia-card {
        margin-bottom: 16px !important;
        border: 1px solid #dee2e6 !important;
        border-radius: 10px !important;
        overflow: hidden !important;
        background: #fff !important;
      }

      .ia-header {
        display: flex !important;
        align-items: flex-start !important;
        gap: 10px !important;
        padding: 14px 18px !important;
        background: #f0f4ff !important;
        cursor: pointer !important;
        user-select: none !important;
        transition: background 0.2s ease !important;
      }

      .ia-header:hover { background: #e0e8ff !important; }

      .ia-toggle-icon {
        flex-shrink: 0 !important;
        width: 26px !important;
        height: 26px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        background: #4361ee !important;
        color: #fff !important;
        border-radius: 50% !important;
        font-weight: 700 !important;
        font-size: 1rem !important;
        transition: transform 0.3s ease !important;
      }

      .ia-card.ia-revealed .ia-toggle-icon {
        transform: rotate(45deg) !important;
      }

      .ia-header h1, .ia-header h2, .ia-header h3,
      .ia-header h4, .ia-header h5, .ia-header h6 {
        margin: 0 !important;
        padding-top: 1px !important;
        font-size: 1.02rem !important;
        font-weight: 700 !important;
        border: none !important;
      }

      /* Inline toggle button inside Q headings */
      .ia-inline-toggle {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        flex-shrink: 0 !important;
        vertical-align: middle !important;
      }

      /* Remove GitHub anchor margin from heading inside header */
      .ia-header .anchor { display: none !important; }

      .ia-body {
        max-height: 0 !important;
        overflow: hidden !important;
        transition: max-height 0.45s ease-out !important;
      }

      .ia-card.ia-revealed .ia-body {
        max-height: 8000px !important;
        transition: max-height 0.6s ease-in !important;
      }

      .ia-answer-inner {
        padding: 18px !important;
        line-height: 1.8 !important;
      }

      /* Dark mode awareness for GitHub */
      @media (prefers-color-scheme: dark) {
        #ia-toolbar {
          background: #1a1a2e !important;
          border-color: #2a2a4a !important;
        }
        #ia-counter { color: #a0a0b0 !important; }
        #ia-hide-all { color: #6c8aff !important; border-color: #6c8aff !important; }
        #ia-hide-all:hover { background: #1e2a45 !important; }
        .ia-card { background: #1a1a2e !important; border-color: #2a2a4a !important; }
        .ia-header { background: #1e2a45 !important; }
        .ia-header:hover { background: #253355 !important; }
        .ia-header h1, .ia-header h2, .ia-header h3,
        .ia-header h4, .ia-header h5, .ia-header h6 { color: #e8e8e8 !important; }
      }
    `;
    document.head.appendChild(style);
  }

  // ==================== 主流程 ====================

  /** 把 GitHub blob URL 转为 raw URL */
  function githubBlobToRaw(url) {
    // github.com/owner/repo/blob/branch/path → raw.githubusercontent.com/owner/repo/branch/path
    return url.replace(/github\.com\/([^\/]+)\/([^\/]+)\/blob\//, 'raw.githubusercontent.com/$1/$2/');
  }

  /** 从页面获取原始 markdown 文本 */
  async function fetchRawMarkdown() {
    // GitHub blob 页面 → 用 raw URL fetch
    if (isGitHubBlob()) {
      const rawUrl = githubBlobToRaw(window.location.href);
      const resp = await fetch(rawUrl);
      if (!resp.ok) throw new Error('Raw URL not accessible (repo may be private): ' + resp.status);
      return await resp.text();
    }

    // file:// 或 raw URL → 从 DOM 中提取
    if (isFileProtocol() || isRawMarkdown()) {
      const pre = document.querySelector('pre');
      if (pre && pre.textContent.length > 50) {
        return pre.textContent;
      }
      return document.body.textContent;
    }

    // GitLab blob → fetch raw
    if (isGitLabBlob()) {
      const rawUrl = window.location.href.replace(/\/-\/blob\//, '/-/raw/');
      const resp = await fetch(rawUrl);
      if (!resp.ok) throw new Error('GitLab raw URL not accessible: ' + resp.status);
      return await resp.text();
    }

    // 其他情况
    throw new Error('Unknown page type, try DOM mode');
  }

  /** 处理：解析 markdown 文本，生成交互式 Q&A 页面 */
  function processWithRawMarkdown(rawText) {
    const result = parseMarkdown(rawText);
    if (result.pairs.length === 0) return false;

    // 替换 body 内容
    let html = '<div id="ia-root" style="max-width:900px;margin:0 auto;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif;color:#1a1a2e;">';

    // Toolbar
    html += `
      <div id="ia-toolbar" style="position:sticky;top:0;z-index:100;background:#fff;padding:14px 18px;border-radius:10px;margin-bottom:24px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px solid #dee2e6;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <button id="ia-toggle-all" style="padding:8px 16px;background:#4361ee;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:0.88rem;">👁️ 显示全部</button>
        <span id="ia-counter" style="margin-left:auto;color:#6c757d;font-size:0.85rem;"></span>
      </div>`;

    if (result.preamble) {
      html += `<div style="padding:12px 0;color:#6c757d;line-height:1.8;">${simpleMarkdownToHTML(result.preamble)}</div>`;
    }

    result.pairs.forEach((pair) => {
      const hTag = 'h' + Math.min(pair.level, 6);
      html += `
        <div class="ia-card" data-ia-id="${pair.id}" style="margin-bottom:16px;border:1px solid #dee2e6;border-radius:10px;overflow:hidden;background:#fff;">
          <div class="ia-header" style="display:flex;align-items:flex-start;gap:10px;padding:14px 18px;background:#f0f4ff;cursor:pointer;user-select:none;">
            <span class="ia-toggle-icon" style="flex-shrink:0;width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:#4361ee;color:#fff;border-radius:50%;font-weight:700;font-size:1rem;transition:transform 0.3s;">+</span>
            <${hTag} style="font-size:1.02rem;font-weight:700;margin:0;padding-top:1px;">${escapeHTML(pair.question)}</${hTag}>
          </div>
          <div class="ia-body" style="max-height:0;overflow:hidden;transition:max-height 0.45s ease-out;">
            <div style="padding:18px;line-height:1.8;">${simpleMarkdownToHTML(pair.answer) || '<em style="color:#999;">（未填写答案）</em>'}</div>
          </div>
        </div>`;
    });

    if (result.postamble) {
      html += `<div style="margin-top:24px;padding-top:20px;border-top:1px solid #dee2e6;color:#6c757d;line-height:1.8;">${simpleMarkdownToHTML(result.postamble)}</div>`;
    }

    html += '</div>';

    document.body.innerHTML = html;

    // 绑定事件
    injectStyles();
    bindToolbarEvents();

    // 委托点击：切换答案
    document.getElementById('ia-root').addEventListener('click', (e) => {
      const header = e.target.closest('.ia-header');
      if (!header) return;
      const card = header.closest('.ia-card');
      const body = card ? card.querySelector('.ia-body') : null;
      if (!card || !body) return;

      const isRevealed = card.classList.contains('ia-revealed');
      if (isRevealed) {
        card.classList.remove('ia-revealed');
        body.style.maxHeight = '0';
        body.style.transition = 'max-height 0.45s ease-out';
      } else {
        card.classList.add('ia-revealed');
        body.style.maxHeight = '8000px';
        body.style.transition = 'max-height 0.6s ease-in';
      }
    });

    return true;
  }

  /**
   * DOM 轻量模式：不重组 DOM，只切换答案元素的可见性
   * 适用于已渲染的 HTML 页面（GitHub 等）
   */
  function processAsDOMLight() {
    console.log('[IA] processAsDOMLight starting...');
    const container = getContainer();
    console.log('[IA] container:', container ? (container.className || container.tagName) : 'NULL');
    if (!container) return false;

    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
    console.log('[IA] Total headings in container:', headings.length);
    // Log heading texts for diagnosis
    Array.from(headings).forEach((h, i) => {
      if (i < 8) console.log('[IA]   heading', i, h.tagName, ':', (h.textContent || '').trim().slice(0, 80));
    });

    const qHeadings = [];
    headings.forEach(h => {
      const raw = (h.textContent || '').trim();
      const isQ = isQuestionHeading(raw);
      if (isQ) {
        console.log('[IA] Q heading detected:', raw.slice(0, 80));
        qHeadings.push(h);
      }
    });

    console.log('[IA] Q headings found:', qHeadings.length);
    if (qHeadings.length === 0) return false;

    // 更新问题标题文本（保留子元素如 anchor，只改文本节点）
    qHeadings.forEach(h => {
      // 递归找最后一个文本节点并修改
      const walk = (node) => {
        for (let i = node.childNodes.length - 1; i >= 0; i--) {
          const child = node.childNodes[i];
          if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
            child.textContent = extractQuestionText(h.textContent || '');
            return true;
          }
          if (child.nodeType === Node.ELEMENT_NODE && walk(child)) return true;
        }
        return false;
      };
      walk(h);
    });

    // 对于每个 Q 标题，找到它到下一个 Q 标题之间的所有元素，全部标记为"答案"
    // A 标题不算边界，A 标题及其后的内容都属于当前问题的答案
    //
    // GitHub 会把每个标题包裹在 .markdown-heading div 中，结构如：
    //   <div class="markdown-heading"><h2>Q: xxx</h2><a>#</a></div>
    //   <p>答案内容</p>
    // 所以不能只用 nextElementSibling 从 h2 出发——那样只会遍历到 wrapper 内部。
    // 需要找到标题的"有效祖先"（container 的直接子级），从那里展开遍历。
    // ============================================================
    let totalAnswerEls = 0;
    qHeadings.forEach((qH, idx) => {
      // 找到 Q 标题在 container 直接子级中的"锚点"元素
      let anchor = qH;
      while (anchor.parentElement && anchor.parentElement !== container) {
        anchor = anchor.parentElement;
      }
      console.log('[IA] Q#' + idx, 'anchor tag:', anchor.tagName, anchor.className || '');

      // 从锚点出发，找下一个 Q 标题的锚点（作为真正的边界），跳过 A 标题锚点
      let boundary = null;
      let node = anchor.nextElementSibling;
      while (node) {
        // 检查这个元素是否包含标题
        const innerHeading = node.matches('h1,h2,h3,h4,h5,h6')
          ? node
          : node.querySelector('h1, h2, h3, h4, h5, h6');

        if (innerHeading) {
          const nodeText = (innerHeading.textContent || '').trim();
          if (isQuestionHeading(nodeText)) {
            // Q 标题 → 边界
            boundary = node;
            break;
          }
          if (!/^A:?\s/i.test(nodeText)) {
            // 普通标题 → 边界
            boundary = node;
            break;
          }
          // A 标题 → 不是边界，继续
        }
        node = node.nextElementSibling;
      }

      // 收集锚点之后、边界之前的所有兄弟元素作为答案
      const elements = [];
      node = anchor.nextElementSibling;
      while (node && node !== boundary) {
        elements.push(node);
        node = node.nextElementSibling;
      }

      console.log('[IA] Q#' + idx, '"' + extractQuestionText(qH.textContent || '') + '"', '→', elements.length, 'answer elements, boundary:', boundary ? (boundary.tagName + ':' + (boundary.textContent||'').trim().slice(0,40)) : 'NONE');

      // 给每个答案元素加上可切换的隐藏（用 !important 确保不被页面 CSS 覆盖）
      elements.forEach(el => {
        el.setAttribute('data-ia-answer', 'q-' + idx);
        el.style.setProperty('display', 'none', 'important');
        totalAnswerEls++;
      });

      // 在 Q 标题前面加上切换按钮
      const btn = document.createElement('span');
      btn.className = 'ia-inline-toggle';
      btn.textContent = '+ ';
      btn.style.cssText = 'display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;background:#4361ee;color:#fff;border-radius:50%;cursor:pointer;font-size:14px;font-weight:700;margin-right:6px;vertical-align:middle;flex-shrink:0;';
      btn.setAttribute('data-ia-target', 'q-' + idx);

      // 用一个闭包保存当前 idx 和 elements 引用
      (function(targetId, answerEls) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          e.preventDefault();
          const els = answerEls.length > 0
            ? answerEls
            : document.querySelectorAll('[data-ia-answer="' + targetId + '"]');
          const isHidden = els.length > 0 && els[0].style.display === 'none';
          console.log('[IA] Toggle', targetId, 'isHidden:', isHidden, 'count:', els.length);

          els.forEach(function(el) {
            if (isHidden) {
              el.style.display = '';
            } else {
              el.style.setProperty('display', 'none', 'important');
            }
          });
          btn.textContent = isHidden ? '− ' : '+ ';
          // 更新 toolbar 计数
          if (window.__ia_updateToolbarUI) window.__ia_updateToolbarUI();
        });
      })('q-' + idx, elements);

      qH.insertBefore(btn, qH.firstChild);
    });

    console.log('[IA] Total answer elements hidden:', totalAnswerEls);

    // 注入工具栏
    injectToolbar();
    injectStyles();
    bindToolbarEvents();

    return true;
  }

  // 启动
  async function main() {
    // 先检查页面是否有 Q&A 内容（用已有的检测函数）
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const hasQ = Array.from(headings).some(h => isQuestionHeading(h.textContent || ''));
    if (!hasQ) return false;

    // 尝试用 raw URL fetch 原始 markdown（最佳体验：完全自定义渲染）
    let rawText = null;
    if (isGitHubBlob()) {
      try {
        const rawUrl = githubBlobToRaw(window.location.href);
        const resp = await fetch(rawUrl);
        if (resp.ok) rawText = await resp.text();
      } catch (e) { /* 忽略 */ }
    }
    if (isFileProtocol() || isRawMarkdown()) {
      const pre = document.querySelector('pre');
      rawText = pre ? pre.textContent : document.body.textContent;
    }

    // 策略1: 拿到了原始 markdown → 完全重新渲染（最佳体验）
    if (rawText && processWithRawMarkdown(rawText)) return true;

    // 策略2: 原地修改 DOM，隐藏答案、添加切换按钮（最可靠，不丢内容）
    if (processAsDOMLight()) return true;

    // 策略3: 最后兜底 —— 浮动按钮，点击后生成 blob URL 复习页面
    injectLaunchButton();
    return true;
  }

  /**
   * 注入浮动按钮：点击后用 blob URL 打开复习页面
   * 直接从 DOM 提取 HTML 片段，不经过文本转换，保留所有格式
   */
  function injectLaunchButton() {
    if (document.getElementById('ia-launch-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'ia-launch-btn';
    btn.innerHTML = '📋 在 Interview Assistant 中复习';
    btn.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;padding:12px 20px;background:#4361ee;color:#fff;border:none;border-radius:30px;cursor:pointer;font-size:15px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 4px 16px rgba(67,97,238,0.35);transition:transform 0.2s,box-shadow 0.2s;';
    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.05)'; btn.style.boxShadow = '0 6px 24px rgba(67,97,238,0.5)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; btn.style.boxShadow = '0 4px 16px rgba(67,97,238,0.35)'; });

    btn.addEventListener('click', () => {
      // 直接从 DOM 提取 Q&A 数据（保留 HTML 结构）
      const container = getContainer() || document.body;
      const allHeadings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');

      const pairs = [];
      let preamble = '';

      allHeadings.forEach(h => {
        const text = (h.textContent || '').trim();
        if (!isQuestionHeading(text)) {
          // 第一个 Q 之前的非 Q 标题是 preamble
          if (pairs.length === 0) {
            preamble += h.outerHTML;
          }
          return;
        }

        const question = extractQuestionText(text);
        const level = parseInt(h.tagName[1]);

        // 收集后续元素的 HTML，直到下一个 Q 标题（跳过中间的 A 标题）
        const answerParts = [];
        let node = h.nextElementSibling;
        while (node) {
          if (/^H[1-6]$/.test(node.tagName)) {
            const nodeText = (node.textContent || '').trim();
            // Q 标题 → 边界，停止收集
            if (isQuestionHeading(nodeText)) break;
            // A 标题 → 不是边界，包含在答案中，继续
            if (/^A:?\s/i.test(nodeText)) {
              answerParts.push(node.outerHTML);
              node = node.nextElementSibling;
              continue;
            }
            // 普通标题 → 边界，停止
            break;
          }
          answerParts.push(node.outerHTML);
          node = node.nextElementSibling;
        }

        pairs.push({
          id: 'q-' + pairs.length,
          question: question,
          answerHTML: answerParts.join('\n'),
          level: level
        });
      });

      if (pairs.length === 0) {
        alert('未检测到 Q&A 格式的内容。');
        return;
      }

      const pageHTML = buildReviewPageFromDOM(pairs, preamble, window.location.href);
      const blob = new Blob([pageHTML], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    });

    document.body.appendChild(btn);
  }

  /**
   * 从 DOM 数据构建复习页面（保留原始 HTML 结构）
   */
  function buildReviewPageFromDOM(pairs, preamble, sourceUrl) {
    const pairsJSON = JSON.stringify(pairs);
    const preambleJSON = JSON.stringify(preamble || '');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Interview Assistant — 复习模式</title>
<style>
:root { --bg:#fff;--bg2:#f8f9fa;--text:#1a1a2e;--text2:#6c757d;--border:#dee2e6;--accent:#4361ee;--qbg:#f0f4ff;--qhover:#e0e8ff; }
@media(prefers-color-scheme:dark){:root{--bg:#1a1a2e;--bg2:#16213e;--text:#e8e8e8;--text2:#a0a0b0;--border:#2a2a4a;--accent:#6c8aff;--qbg:#1e2a45;--qhover:#253355;}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);line-height:1.7;padding:24px;max-width:900px;margin:0 auto}
.toolbar{position:sticky;top:0;z-index:100;background:var(--bg2);padding:14px 18px;border-radius:10px;margin-bottom:24px;display:flex;gap:10px;align-items:center;border:1px solid var(--border)}
.toolbar button{padding:8px 16px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:.88rem}
.toolbar .counter{margin-left:auto;color:var(--text2);font-size:.85rem}
.card{margin-bottom:16px;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--bg)}
.header{display:flex;align-items:flex-start;gap:10px;padding:14px 18px;background:var(--qbg);cursor:pointer;user-select:none;transition:background .2s}
.header:hover{background:var(--qhover)}
.toggle-icon{flex-shrink:0;width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:var(--accent);color:#fff;border-radius:50%;font-weight:700;font-size:1rem;transition:transform .3s}
.card.revealed .toggle-icon{transform:rotate(45deg)}
.header h1,.header h2,.header h3,.header h4,.header h5,.header h6{font-size:1.02rem;font-weight:700;margin:0;padding-top:2px}
.body{max-height:0;overflow:hidden;transition:max-height .45s ease-out}
.card.revealed .body{max-height:8000px;transition:max-height .6s ease-in}
.body-inner{padding:18px;line-height:1.8}
.body-inner p,.body-inner li,.body-inner pre,.body-inner ul,.body-inner ol,.body-inner table,.body-inner blockquote,.body-inner div{margin-bottom:12px}
.body-inner p:last-child,.body-inner li:last-child{margin-bottom:0}
.preamble{padding:12px 0;color:var(--text2);line-height:1.8;margin-bottom:16px}
.source{font-size:.75rem;color:var(--text2);margin-bottom:16px;word-break:break-all}
@media print{
  .toolbar{display:none}
  .body{max-height:none!important}
  .card{break-inside:avoid}
}
</style>
</head>
<body>
<div class="source">来源: ${escapeHTML(sourceUrl)}</div>
<div class="toolbar">
  <button id="toggle-all-btn">👁️ 显示全部</button>
  <span class="counter" id="counter"></span>
</div>
<div id="qa-container"></div>
<script>
(function(){
  var pairs = ${pairsJSON};
  var preamble = ${preambleJSON};
  var container = document.getElementById('qa-container');
  var html = '';

  if (preamble) {
    html += '<div class="preamble">' + preamble + '</div>';
  }

  pairs.forEach(function(pair, idx) {
    var hTag = 'h' + Math.min(pair.level || 2, 6);
    html += '<div class="card" data-id="' + pair.id + '">' +
      '<div class="header">' +
        '<span class="toggle-icon">+</span>' +
        '<' + hTag + ' style="font-size:1.02rem;font-weight:700;margin:0;padding-top:2px;">' + esc(pair.question) + '</' + hTag + '>' +
      '</div>' +
      '<div class="body"><div class="body-inner">' + (pair.answerHTML || '<em>（未填写答案）</em>') + '</div></div>' +
    '</div>';
  });

  container.innerHTML = html;

  // Toggle
  document.getElementById('qa-container').addEventListener('click', function(e) {
    var header = e.target.closest('.header');
    if (!header) return;
    var card = header.closest('.card');
    card.classList.toggle('revealed');
    updateUI();
  });

  // Toolbar
  var toggleAllBtn = document.getElementById('toggle-all-btn');
  var counter = document.getElementById('counter');

  function updateUI() {
    var total = document.querySelectorAll('.card').length;
    var revealed = document.querySelectorAll('.card.revealed').length;
    counter.textContent = revealed + '/' + total + ' 已显示';
    toggleAllBtn.textContent = (revealed === total && total > 0) ? '🙈 隐藏全部' : '👁️ 显示全部';
  }

  toggleAllBtn.addEventListener('click', function() {
    var total = document.querySelectorAll('.card').length;
    var revealed = document.querySelectorAll('.card.revealed').length;
    if (revealed === total && total > 0) {
      document.querySelectorAll('.card').forEach(function(c) { c.classList.remove('revealed'); });
    } else {
      document.querySelectorAll('.card').forEach(function(c) { c.classList.add('revealed'); });
    }
    updateUI();
  });

  updateUI();

  function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
})();
</script>
</body>
</html>`;
  }

  main().then(success => {
    if (!success) {
      document.documentElement.removeAttribute('data-ia-processed');
      // 诊断横幅：插件已加载但未找到 Q&A 内容
      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#ff6b35;color:#fff;padding:8px 16px;font-size:14px;font-family:sans-serif;text-align:center;';
      banner.textContent = '⚠️ Interview Assistant 已加载，但未检测到 Q&A 内容。URL: ' + window.location.href;
      document.body.insertBefore(banner, document.body.firstChild);
    }
  }).catch(err => {
    // 诊断横幅：插件加载出错
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc3545;color:#fff;padding:8px 16px;font-size:14px;font-family:sans-serif;text-align:center;';
    banner.textContent = '❌ Interview Assistant 出错: ' + err.message;
    document.body.insertBefore(banner, document.body.firstChild);
    document.documentElement.removeAttribute('data-ia-processed');
  });
})();
