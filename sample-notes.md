# 前端面试笔记

这是一份面试复习笔记，用 Interview Assistant 工具可以实现答案的隐藏和显示。

## Q: 什么是闭包？

闭包（Closure）是指函数能够访问其外部作用域中变量的能力。即使外部函数已经执行完毕，内部函数仍然可以访问外部函数的变量。

核心特点：
- 函数嵌套函数
- 内部函数可以访问外部函数的变量
- 外部函数的变量在闭包中被保留，不会被垃圾回收

```js
function outer() {
  let count = 0;
  return function inner() {
    count++;
    return count;
  };
}
const counter = outer();
console.log(counter()); // 1
console.log(counter()); // 2
```

## Q: HTTP 和 HTTPS 的区别是什么？

HTTPS 是在 HTTP 的基础上增加了 SSL/TLS 加密层。

| 对比维度 | HTTP | HTTPS |
|---------|------|-------|
| 安全性 | 明文传输，不安全 | 加密传输，安全 |
| 端口 | 80 | 443 |
| 证书 | 不需要 | 需要 CA 证书 |
| 性能 | 较快 | 略慢（TLS 握手开销） |

## A: HTTPS = HTTP + SSL/TLS

HTTPS 通过 TLS 协议实现了：
1. **加密**：数据在传输过程中被加密
2. **身份验证**：通过证书验证服务器身份
3. **数据完整性**：防止数据被篡改

### Q: 什么是原型链？

JavaScript 中每个对象都有一个 `__proto__` 属性指向它的原型对象，原型对象又有自己的原型，这样层层向上就形成了原型链。

原型链的终点是 `Object.prototype`，它的 `__proto__` 是 `null`。

```js
function Person(name) {
  this.name = name;
}
Person.prototype.sayHi = function() {
  console.log('Hi, ' + this.name);
};

const p = new Person('张三');
p.sayHi(); // 查找过程：p → Person.prototype → Object.prototype
```

### Q: 什么是事件循环（Event Loop）？

事件循环是 JavaScript 的运行机制，用于协调代码执行、事件处理和异步任务。

任务队列分为：
- **宏任务**（Task）：setTimeout、setInterval、I/O、UI 渲染
- **微任务**（Microtask）：Promise.then、MutationObserver、queueMicrotask

执行顺序：同步代码 → 微任务队列清空 → 宏任务（一个）→ 微任务队列清空 → ...

# Q: TypeScript 中 type 和 interface 的区别？

interface 可以被合并声明（declaration merging），type 不行。

interface 只能描述对象结构，type 可以表示联合类型、交叉类型、基本类型别名等。

```ts
// interface 声明合并
interface User {
  name: string;
}
interface User {
  age: number;
}
// 最终 User = { name: string; age: number }

// type 可以表达更复杂的类型
type ID = string | number;
type Point = [number, number];
```

## Q: 这道题没有写答案

---

## 参考资料

- [MDN Web Docs](https://developer.mozilla.org)
- [ECMAScript 规范](https://tc39.es/ecma262/)
