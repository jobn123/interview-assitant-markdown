/**
 * core/parser.js 单元测试
 * 运行方式：node core/parser.test.js
 */

const { parseMarkdown, normalizeMarkdown } = require('./parser.js');

let passed = 0;
let failed = 0;
let testNum = 0;

function test(name, fn) {
  testNum++;
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`  FAIL test #${testNum}: ${name}`);
    console.error(`    ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg || `expected "${expected}", got "${actual}"`);
  }
}

function assertDeepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(msg || `expected ${b}, got ${a}`);
  }
}

// ==================== 基础测试 ====================

test('单个隐式答案 (## Q:)', () => {
  const input = `## Q: 什么是闭包？
闭包是指函数能够访问其外部作用域变量的能力。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, '什么是闭包？');
  assert(result.pairs[0].answer.includes('闭包是指函数'));
  assertEqual(result.pairs[0].type, 'implicit');
  assertEqual(result.pairs[0].level, 2);
});

test('单个显式答案 (## Q: + ## A:)', () => {
  const input = `## Q: 什么是闭包？
## A: 闭包是指函数能够访问其外部作用域变量的能力。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, '什么是闭包？');
  assertEqual(result.pairs[0].answer, '闭包是指函数能够访问其外部作用域变量的能力。');
  assertEqual(result.pairs[0].type, 'explicit');
});

test('多个 Q&A 对', () => {
  const input = `## Q: Q1?
答案一。

## Q: Q2?
答案二。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 2);
  assertEqual(result.pairs[0].question, 'Q1?');
  assert(result.pairs[0].answer.includes('答案一'));
  assertEqual(result.pairs[1].question, 'Q2?');
  assert(result.pairs[1].answer.includes('答案二'));
});

// ==================== 标题级别测试 ====================

test('H1 级别问题 (# Q:)', () => {
  const input = `# Q: 大问题？
这是答案。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].level, 1);
  assertEqual(result.pairs[0].question, '大问题？');
});

test('H3 级别问题 (### Q:)', () => {
  const input = `### Q: 子问题？
这是答案。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].level, 3);
  assertEqual(result.pairs[0].question, '子问题？');
});

test('H6 级别问题 (###### Q:)', () => {
  const input = `###### Q: 小问题？
答案。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].level, 6);
});

test('混用不同标题级别', () => {
  const input = `## Q: 类别一问题？
答案一。

### Q: 子问题？
子答案。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 2);
  assertEqual(result.pairs[0].level, 2);
  assertEqual(result.pairs[0].question, '类别一问题？');
  assertEqual(result.pairs[1].level, 3);
  assertEqual(result.pairs[1].question, '子问题？');
});

// ==================== Q: 格式变体 ====================

test('Q 后无冒号', () => {
  const input = `## Q 什么是闭包？
答案。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, '什么是闭包？');
});

test('Q 大小写不敏感', () => {
  const input = `## q: what is closure?
Answer.`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, 'what is closure?');
});

test('A 大小写不敏感', () => {
  const input = `## Q: test?
## a: Answer text.`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].answer, 'Answer text.');
  assertEqual(result.pairs[0].type, 'explicit');
});

// ==================== 边界情况 ====================

test('空答案', () => {
  const input = `## Q: Empty?
## Q: Next?
有答案。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 2);
  assertEqual(result.pairs[0].answer, '');
  assertEqual(result.pairs[1].question, 'Next?');
  assert(result.pairs[1].answer.includes('有答案'));
});

test('完全没有 Q 标题', () => {
  const input = `这是一段普通的 Markdown 文本。
没有任何问答内容。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 0);
  assert(result.preamble.includes('普通的 Markdown'));
});

test('preamble 出现在第一个 Q 之前', () => {
  const input = `# 面试笔记

这是一些介绍内容。

## Q: 第一题？
答案。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assert(result.preamble.includes('面试笔记'));
  assert(result.preamble.includes('介绍内容'));
});

test('postamble 出现在普通标题之后', () => {
  // postamble 是指 Q&A 对之后、非 Q/A 的标题及其后续内容
  // 需要有一个普通标题来界定 Q&A 的结束
  const input = `## Q: 唯一问题？
## A: 答案是如此。

## 参考资料
- 参考链接一
- 参考链接二`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assert(result.pairs[0].answer.includes('答案是如此'));
  assert(result.postamble.includes('参考资料'));
  assert(result.postamble.includes('参考链接一'));
});

test('代码块中的 # 不会被误解析', () => {
  const input = `## Q: 这段代码输出什么？
\`\`\`js
## Q: 这不是一个问题
console.log("hello");
# 这也不是
\`\`\`
答案是输出 hello。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1, '代码块中的 ## Q: 不应被解析为问题');
  assert(result.pairs[0].answer.includes('```'));
  assert(result.pairs[0].answer.includes('## Q: 这不是一个问题'));
});

test('多个显式 A: 标题，最后一个生效', () => {
  const input = `## Q: 问题？
## A: 第一个答案
## A: 第二个答案`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].answer, '第二个答案');
});

test('嵌套标题 (###) 在答案中', () => {
  // 纯文本子标题会被兜底规则转为 Q:，不再视为答案的一部分
  const input = `## Q: 问题？
### 子标题
子内容。

更多内容。`;
  const result = parseMarkdown(input);
  // 子标题被识别为新问题，所以现在是 2 对 Q&A
  assertEqual(result.pairs.length, 2);
  assertEqual(result.pairs[0].question, '问题？');
  assertEqual(result.pairs[1].question, '子标题');
  assert(result.pairs[1].answer.includes('子内容'));
  assert(result.pairs[1].answer.includes('更多内容'));
});

test('Q: 后有额外内容再换行', () => {
  const input = `## Q: 什么是闭包？
第一段答案。

第二段答案。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assert(result.pairs[0].answer.includes('第一段答案'));
  assert(result.pairs[0].answer.includes('第二段答案'));
});

test('Q: 标题后的同段落文本', () => {
  const input = `## Q: 问题？一些额外文字
接下来是答案。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, '问题？一些额外文字');
});

// ==================== 换行符处理 ====================

test('Windows 换行符 (\\r\\n)', () => {
  const input = '## Q: 问题？\r\n答案行一。\r\n\r\n答案行二。';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assert(result.pairs[0].answer.includes('答案行一'));
  assert(result.pairs[0].answer.includes('答案行二'));
});

test('BOM 字符处理', () => {
  const input = '﻿## Q: 问题？\n答案。';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, '问题？');
});

// ==================== 带编号的问题 ====================

test('Q1, Q2 格式（归一化后支持）', () => {
  const input = `## Q1: 第一题？
答案一。

## Q2: 第二题？
答案二。`;
  const result = parseMarkdown(input);
  // Q1:, Q2: 经归一化转为 Q:，现在可以正确识别
  assertEqual(result.pairs.length, 2, 'Q1:/Q2: 经归一化后应被识别');
  assertEqual(result.pairs[0].question, '第一题？');
  assertEqual(result.pairs[1].question, '第二题？');
});

// ==================== 压力测试 ====================

test('1000 个 Q&A 对', () => {
  let input = '';
  for (let i = 0; i < 1000; i++) {
    input += `## Q: 问题 ${i}？\n答案 ${i} 的内容。\n\n`;
  }
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1000);
  assertEqual(result.pairs[0].question, '问题 0？');
  assertEqual(result.pairs[999].question, '问题 999？');
});

// ==================== 包含 Markdown 格式的答案 ====================

test('答案包含列表和代码', () => {
  const input = `## Q: 什么是 Promise？
Promise 是 JavaScript 中处理异步操作的对象。

特点：
- 有三种状态：pending, fulfilled, rejected
- 状态不可逆

\`\`\`js
const p = new Promise((resolve, reject) => {
  setTimeout(() => resolve('done'), 1000);
});
\`\`\``;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assert(result.pairs[0].answer.includes('- 有三种状态'));
  assert(result.pairs[0].answer.includes('```js'));
});

test('答案包含 HTML', () => {
  const input = `## Q: HTML 是什么？
<div class="example">
  <p>HTML 是超文本标记语言。</p>
</div>`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assert(result.pairs[0].answer.includes('<div'));
});

// ==================== Unicode/CJK ====================

test('中文问题和答案', () => {
  const input = `## Q: 什么是闭包？
闭包是指函数能够访问其外部作用域变量的能力。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, '什么是闭包？');
});

test('混合中英文', () => {
  const input = `## Q: 什么是 HTTPS？
HTTPS 是 HTTP + SSL/TLS 加密层。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, '什么是 HTTPS？');
});

// ==================== 格式归一化测试 ====================

test('归一化：中文全角冒号 Q： → Q:', () => {
  const input = '## Q：什么是闭包？\n答案内容。';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, '什么是闭包？');
});

test('归一化：中文"问题：" → Q:', () => {
  const input = '## 问题：什么是闭包？\n答案内容。';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, '什么是闭包？');
});

test('归一化：中文"问题"（无冒号） → Q:', () => {
  const input = '## 问题 什么是闭包？\n答案内容。';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, '什么是闭包？');
});

test('归一化：编号问题 Q1: Q2: → Q:', () => {
  const input = '## Q1: 第一题？\n答案一。\n\n## Q2: 第二题？\n答案二。';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 2);
  assertEqual(result.pairs[0].question, '第一题？');
  assertEqual(result.pairs[1].question, '第二题？');
});

test('归一化：英文 Question: → Q:', () => {
  const input = '## Question: What is closure?\nAnswer text.';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, 'What is closure?');
});

test('归一化：中文"答案：" → A:', () => {
  const input = '## Q: 问题？\n## 答案：这是答案。';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].answer, '这是答案。');
  assertEqual(result.pairs[0].type, 'explicit');
});

test('归一化：英文 Answer: → A:', () => {
  const input = '## Q: Question?\n## Answer: The answer.';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].answer, 'The answer.');
  assertEqual(result.pairs[0].type, 'explicit');
});

test('归一化：标题中的加粗 **Q:** → Q:', () => {
  const input = '## **Q:** 什么是闭包？\n答案。';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, '什么是闭包？');
});

test('归一化：答案标题中的加粗 **A:** → A:', () => {
  const input = '## Q: 问题？\n## **A:** 答案。';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].answer, '答案。');
  assertEqual(result.pairs[0].type, 'explicit');
});

test('归一化：代码块中的"问题："不被归一化', () => {
  const input = '## Q: 代码输出？\n```\n问题：这不是一个标题\n```\n答案内容。';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  // 代码块中的内容和答案内容应该保持原样
  assert(result.pairs[0].answer.includes('问题：这不是一个标题'));
});

test('归一化：全角冒号的 Q 不加空格', () => {
  const input = '## Q：问题内容？\n答案。';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, '问题内容？');
});

// ==================== 阿拉伯数字编号标题 → 问题 ====================

test('归一化：编号标题 "1. xxx" → Q:', () => {
  const input = '### 1. 事件循环\n答案内容。';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, '事件循环');
});

test('归一化：编号标题 "2、xxx" → Q:', () => {
  const input = '### 2、原型链\n答案内容。';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, '原型链');
});

test('归一化：编号标题 "3) xxx" → Q:', () => {
  const input = '### 3) this 指向\n答案内容。';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, 'this 指向');
});

test('归一化：编号标题 "10 xxx" → Q:', () => {
  const input = '### 10 其他问题\n答案内容。';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, '其他问题');
});

test('归一化：中文数字 "一、" 不被转为问题', () => {
  const input = '## 一、JavaScript 核心\n这是章节介绍。\n\n### 1. 事件循环\n答案。';
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1, '中文数字一、不应被识别为问题');
  assertEqual(result.pairs[0].question, '事件循环');
});

test('归一化：用户实际格式模拟', () => {
  const input = `## 一、JavaScript 核心

### 1. 事件循环（Event Loop）
事件循环是js实现异步的核心机制。

### 2. 闭包、作用域链、this 指向
闭包相关内容...
this 指向规则...`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 2);
  assertEqual(result.pairs[0].question, '事件循环（Event Loop）');
  assertEqual(result.pairs[1].question, '闭包、作用域链、this 指向');
  assert(result.preamble.includes('JavaScript 核心'));
});

// ==================== 纯文本标题 → 隐式问题（兜底规则） ====================

test('兜底规则：纯文本标题自动识别为问题', () => {
  const input = `### 事件循环（Event Loop）
事件循环是js实现异步的核心机制。

### 闭包
闭包是指函数能够访问其外部作用域变量的能力。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 2);
  assertEqual(result.pairs[0].question, '事件循环（Event Loop）');
  assert(result.pairs[0].answer.includes('异步的核心机制'));
  assertEqual(result.pairs[1].question, '闭包');
  assert(result.pairs[1].answer.includes('外部作用域'));
});

test('兜底规则：中文数字章节不被识别为问题', () => {
  const input = `## 一、JavaScript 核心
这是介绍内容。

### 1. 事件循环
答案。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 1, '中文数字一、不应被识别为问题');
  assertEqual(result.pairs[0].question, '事件循环');
  assert(result.preamble.includes('JavaScript 核心'));
});

test('兜底规则：参考资料/总结等不被识别为问题', () => {
  // 这些标题被 isNonQuestion 排除，不会转为 Q:
  // 由于隐式答案模式：Q 后面直至下一个 Q 的内容都算答案
  const input = `## Q: 第一题？
答案一。

## 参考资料
- 链接1
- 链接2`;
  const result = parseMarkdown(input);
  // 参考资料不被识别为新问题，只有第一题是问题
  assertEqual(result.pairs.length, 1, '参考资料不应被识别为问题');
  assertEqual(result.pairs[0].question, '第一题？');
  // 参考资料被吸入隐式答案
  assert(result.pairs[0].answer.includes('参考资料'));
});

test('兜底规则：前言/后记/致谢不被识别为问题', () => {
  const input = `## 前言
这是前言内容。

## Q: 问题？
答案。`;
  const result = parseMarkdown(input);
  // 前言在被排除且出现在第一个 Q 之前 → preamble
  assertEqual(result.pairs.length, 1);
  assertEqual(result.pairs[0].question, '问题？');
  assert(result.preamble.includes('前言'));
});

test('兜底规则：无标记标题，中文全角括号内的内容正常工作', () => {
  const input = `## 构建理念的根本差异
Webpack 的核心思想是"一切皆模块"。

## HMR（热模块替换）机制对比
HMR 是衡量开发体验的核心指标。`;
  const result = parseMarkdown(input);
  assertEqual(result.pairs.length, 2);
  assertEqual(result.pairs[0].question, '构建理念的根本差异');
  assertEqual(result.pairs[1].question, 'HMR（热模块替换）机制对比');
});

// ==================== 结果汇总 ====================

console.log(`\n===== 测试结果 =====`);
console.log(`通过: ${passed}/${testNum}`);
console.log(`失败: ${failed}/${testNum}`);
if (failed > 0) {
  console.log(`\n${failed} 个测试失败！`);
  process.exit(1);
} else {
  console.log(`全部通过！✅`);
}
