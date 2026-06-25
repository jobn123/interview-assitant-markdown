/**
 * Interview Assistant — Markdown Q&A Parser
 *
 * 纯函数，零依赖。输入 Markdown 字符串，输出解析后的 Q&A 结构化数据。
 *
 * 原生支持的格式：
 *   # Q: 问题文本        (h1 级别问题)
 *   ## Q: 问题文本       (h2 级别问题)
 *   ### Q: 问题文本      (h3 级别问题)
 *
 * 自动归一化的格式（在解析前自动转换为标准格式）：
 *   中文全角冒号：  ## Q：问题  →  ## Q: 问题
 *   中文标记：      ## 问题：xxx  →  ## Q: xxx
 *   编号问题：      ## Q1: xxx   →  ## Q: xxx
 *   英文全称：      ## Question: xxx → ## Q: xxx
 *   答案同理：      ## 答案：xxx / Answer: xxx → ## A: xxx
 */

/**
 * 【新增】在解析前对 Markdown 文本做格式归一化
 * 只处理标题行（#{1,6} 开头），不触碰正文内容
 */
function normalizeMarkdown(text) {
  const lines = text.split('\n');
  let inFence = false;
  let fenceChar = '';

  const result = lines.map(line => {
    // 跟踪围栏代码块，代码块内的内容不归一化
    if (/^```/.test(line) || /^~~~/.test(line)) {
      if (!inFence) {
        inFence = true;
        fenceChar = line.trim().slice(0, 3);
      } else if (line.trim().startsWith(fenceChar)) {
        inFence = false;
        fenceChar = '';
      }
      return line;
    }
    if (inFence) return line;

    // 只处理标题行
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (!headingMatch) return line;

    const hashes = headingMatch[1];
    let content = headingMatch[2];

    // 1. 全角冒号 → 半角冒号
    content = content.replace(/：/g, ':');

    // 2. 中文"问题"标记 → Q:
    //    问题：xxx / 问题:xxx / 问题 xxx / 问题1：xxx / 问题1: xxx
    content = content.replace(/^问题\d*\s*:?\s*/i, 'Q: ');

    // 3. 中文"答案"标记 → A:
    content = content.replace(/^答案\d*\s*:?\s*/i, 'A: ');

    // 4. 英文 Question / Answer → Q: / A:
    content = content.replace(/^Question\s*:?\s*/i, 'Q: ');
    content = content.replace(/^Answer\s*:?\s*/i, 'A: ');

    // 5. 编号 Q1:/Q2:/Q01: → Q:
    content = content.replace(/^Q\d+\s*:?\s*/i, 'Q: ');

    // 6. 删除标题中 Q: / A: 周围的加粗/斜体标记
    content = content.replace(/^\*{1,3}\s*(Q:?|A:?)\s*\*{1,3}\s*/i, '$1 ');

    // 7. 【新增】阿拉伯数字编号标题 → 隐式问题
    //    仅在尚未识别为 Q:/A: 时生效
    //    "1. 事件循环" / "2、原型链" / "3) this指向" / "10 其他"
    //    但跳过中文数字 "一、" / "二、" 避免误伤章节标题
    if (!/^(Q|A):\s/i.test(content)) {
      // 数字 + (分隔符+可选空格 | 纯空格) + 文本
      // 有分隔符时后面可不加空格（如中文顿号 2、原型链）
      // 无分隔符时必须有空格（区分 "10 标题" 和纯数字 "10"）
      const numberedMatch = content.match(/^(\d+)(?:[\.、．)\-]\s*|\s+)(.+)/);
      if (numberedMatch) {
        content = 'Q: ' + numberedMatch[2];
      }
    }

    // 8. Q 后跟中文冒号再次确保
    content = content.replace(/^Q\s*：\s*/i, 'Q: ');
    content = content.replace(/^A\s*：\s*/i, 'A: ');

    // 9. 确保 Q: / A: 后面有空格（Q:xxx → Q: xxx）
    content = content.replace(/^(Q:)\s*/i, '$1 ');
    content = content.replace(/^(A:)\s*/i, '$1 ');

    return hashes + ' ' + content;
  });

  return result.join('\n');
}

/**
 * 检查一行是否是围栏代码块标记 (``` 或 ~~~)
 */
function isFence(line) {
  return /^```/.test(line) || /^~~~/.test(line);
}

/**
 * 检查一行是否是任意级别的 Markdown 标题
 * 返回匹配结果：{ level: 1-6, heading: "Q: ...", content: "..." } 或 null
 */
function parseHeading(line) {
  const match = line.match(/^(#{1,6})\s+(.*)/);
  if (!match) return null;
  return {
    level: match[1].length,
    raw: line,
    content: match[2].trim()
  };
}

/**
 * 检查标题内容是否是问题标记 (Q:? 或 Q ?)
 * 返回问题文本（去掉 Q: 前缀），或 null
 */
function extractQuestion(headingContent) {
  const match = headingContent.match(/^Q:?\s+/i);
  if (!match) return null;
  return headingContent.slice(match[0].length).trim();
}

/**
 * 检查标题内容是否是答案标记 (A:? 或 A ?)
 * 返回答案文本（去掉 A: 前缀），或 null
 */
function extractAnswer(headingContent) {
  const match = headingContent.match(/^A:?\s+/i);
  if (!match) return null;
  return headingContent.slice(match[0].length).trim();
}

/**
 * 解析 Markdown 文本，提取 Q&A 对
 *
 * @param {string} text - Markdown 原始文本
 * @returns {{ pairs: Array, preamble: string, postamble: string }}
 *   pairs: [{ id, question, answer, type, level }]
 *   preamble: 第一个 Q 之前的内容
 *   postamble: 最后一个 Q&A 之后的内容
 */
function parseMarkdown(text) {
  // 预处理
  let normalized = text
    .replace(/^﻿/, '')        // 移除 BOM
    .replace(/\r\n/g, '\n')        // 统一换行符
    .replace(/\r/g, '\n');

  // 格式归一化：将非标准格式转为标准 Q:/A: 格式
  normalized = normalizeMarkdown(normalized);

  const lines = normalized.split('\n');
  const pairs = [];
  let preamble = '';
  let postamble = '';
  let sawFirstQuestion = false;

  // 当前正在收集的问题（尚未遇到下一个 Q 或结束）
  let currentQuestion = null;
  // 当前问题之后是否已经遇到显式 A: 标题
  let hasExplicitAnswer = false;
  // 累积隐式答案内容
  let implicitBuffer = [];

  // 围栏代码块状态
  let inFence = false;
  let fenceChar = '';

  // 临时存储：按顺序收集的段落
  // 每个段落 = { type: 'heading'|'content', heading?: {}, lines: [] }
  const segments = [];
  let currentSegment = { type: 'content', lines: [] };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 跟踪围栏代码块
    if (isFence(line)) {
      if (!inFence) {
        // 进入代码块
        inFence = true;
        fenceChar = line.trim().slice(0, 3);
        currentSegment.lines.push(line);
      } else if (line.trim().startsWith(fenceChar)) {
        // 退出代码块
        inFence = false;
        fenceChar = '';
        currentSegment.lines.push(line);
      } else {
        // 围栏内其他内容
        currentSegment.lines.push(line);
      }
      continue;
    }

    // 如果在围栏内，直接追加到当前段落
    if (inFence) {
      currentSegment.lines.push(line);
      continue;
    }

    // 检查是否是标题行
    const heading = parseHeading(line);
    if (heading) {
      // 保存之前的段落
      if (currentSegment.lines.length > 0 || currentSegment.type === 'heading') {
        segments.push(currentSegment);
      }
      // 开始新段落
      currentSegment = { type: 'heading', heading, lines: [line] };
    } else {
      currentSegment.lines.push(line);
    }
  }
  // 保存最后一个段落
  if (currentSegment.lines.length > 0 || currentSegment.type === 'heading') {
    segments.push(currentSegment);
  }

  // 第二遍：分类每个段落，构建 Q&A 对
  for (const seg of segments) {
    if (seg.type === 'heading') {
      const h = seg.heading;
      const qText = extractQuestion(h.content);
      const aText = extractAnswer(h.content);

      if (qText !== null) {
        // === 问题标题 ===
        // 先结束上一个问题
        finalizeCurrentQuestion();

        sawFirstQuestion = true;
        currentQuestion = {
          id: 'q-' + pairs.length,
          question: qText,
          answer: '',
          type: null,
          level: h.level
        };
        hasExplicitAnswer = false;
        implicitBuffer = [];
        // 标题行之后的内容（同段落剩余部分）加入隐式缓冲
        const rest = seg.lines.slice(1).join('\n').trim();
        if (rest) {
          implicitBuffer.push(rest);
        }
        pairs.push(currentQuestion);

      } else if (aText !== null && currentQuestion) {
        // === 显式答案标题 ===
        // 多个 A: 标题：后面的覆盖前面的
        // A: 标题行自身的文本即为答案的起始
        let answerParts = [];
        // 如果之前已经通过隐式方式收集了一些内容，
        // 且这是第一个 A:，则保留隐式内容作为答案的一部分
        if (!hasExplicitAnswer && implicitBuffer.length > 0) {
          answerParts.push(implicitBuffer.join('\n\n').trim());
        }
        // A: 标题行自身的文本
        if (aText) {
          answerParts.push(aText);
        }
        // A: 标题之后的内容
        const explicitStart = seg.lines.slice(1).join('\n').trim();
        if (explicitStart) {
          answerParts.push(explicitStart);
        }
        currentQuestion.answer = answerParts.join('\n\n').trim();
        currentQuestion.type = 'explicit';
        hasExplicitAnswer = true;
        implicitBuffer = [];

      } else {
        // === 普通标题 ===
        if (currentQuestion && !hasExplicitAnswer) {
          // 当前问题的隐式答案的一部分
          implicitBuffer.push(seg.lines.join('\n'));
        } else if (!sawFirstQuestion) {
          preamble += seg.lines.join('\n') + '\n';
        } else {
          // 已经有过问题了，且当前没在收集答案
          // → postamble 或继续追加到上一个已完成的答案
          // 实际上这应该属于 postamble
          postamble += seg.lines.join('\n') + '\n';
        }
      }
    } else {
      // === 非标题段落（纯内容）===
      if (currentQuestion && !hasExplicitAnswer) {
        // 隐式答案内容
        implicitBuffer.push(seg.lines.join('\n'));
      } else if (!sawFirstQuestion) {
        preamble += seg.lines.join('\n') + '\n';
      } else {
        postamble += seg.lines.join('\n') + '\n';
      }
    }
  }

  // 结束最后一个问题
  finalizeCurrentQuestion();

  function finalizeCurrentQuestion() {
    if (currentQuestion && !hasExplicitAnswer) {
      currentQuestion.answer = implicitBuffer.join('\n\n').trim();
      currentQuestion.type = currentQuestion.answer ? 'implicit' : 'implicit';
    }
    // 如果 currentQuestion 存在但 answer 为空，也保留（空答案）
  }

  return {
    pairs: pairs.map(p => ({ id: p.id, question: p.question, answer: p.answer, type: p.type || 'implicit', level: p.level })),
    preamble: preamble.trim(),
    postamble: postamble.trim()
  };
}

// 如果是 Node.js 环境，导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseMarkdown, normalizeMarkdown, parseHeading, extractQuestion, extractAnswer, isFence };
}
