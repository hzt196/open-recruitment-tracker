import { basicSetup } from "codemirror";
import { EditorState, Compartment, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder, ViewPlugin, Decoration } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting, indentUnit, syntaxTree } from "@codemirror/language";
import { autocompletion, CompletionContext, completionKeymap, acceptCompletion, closeCompletion,
  snippetCompletion, nextSnippetField, prevSnippetField, clearSnippet, insertCompletionText } from "@codemirror/autocomplete";
import { tags } from "@lezer/highlight";
import { python, localCompletionSource } from "@codemirror/lang-python";
import { cpp } from "@codemirror/lang-cpp";

// C 与 C++ 共用词法解析器；可选语言、模板和补全内容只提供 C。
const languages = { python, c: cpp };
const languageSupport = (name) => languages[name]?.() || [];

function functionCompletion(label, detail, template = `${label}(\${1})\${0}`, boost = 20, type = "function") {
  const completion = snippetCompletion(template, { label, type, detail, boost });
  const applySnippet = completion.apply;
  completion.apply = (view, item, from, to) => {
    // 已经手动输入括号时只补全名称，避免生成 input()()。
    to = completionWordEnd(view.state, to);
    const opening = /^[\t ]*\(/.exec(view.state.sliceDoc(to, view.state.doc.lineAt(to).to));
    if (opening) {
      view.dispatch({ ...insertCompletionText(view.state, label, from, to), selection: { anchor: from + label.length + opening[0].length } });
    } else applySnippet(view, item, from, to);
  };
  return completion;
}
function completionWordEnd(state, pos) {
  const suffix = /^\w*/.exec(state.sliceDoc(pos, state.doc.lineAt(pos).to))[0];
  return pos + suffix.length;
}
function wholeWordCompletion(item) {
  const apply = item.apply;
  return { ...item, apply(view, completion, from, to) {
    const end = completionWordEnd(view.state, to);
    if (typeof apply === "function") apply(view, completion, from, end);
    else view.dispatch(insertCompletionText(view.state, apply || item.label, from, end));
  } };
}
const keywords = (text) => text.split(" ").map((label) => ({ label, type: "keyword", boost: label === "in" ? -99 : 0 }));
const pythonCompletions = [
  ...keywords("and as assert async await break class continue del elif else except False finally from global import in is lambda None nonlocal not or pass raise return True try with yield"),
  ...[
    ["input", "读取一行", undefined, 70], ["print", "输出结果"], ["int", "转为整数"], ["float", "转为浮点数"],
    ["str", "转为字符串"], ["len", "元素个数"], ["range", "生成整数序列"], ["map", "映射元素"],
    ["list", "构造列表"], ["tuple", "构造元组"], ["set", "构造集合"], ["dict", "构造字典"],
    ["sorted", "排序并返回列表"], ["sum", "求和"], ["min", "最小值"], ["max", "最大值"],
    ["abs", "绝对值"], ["enumerate", "下标与元素"], ["zip", "组合序列"], ["reversed", "反向迭代"],
    ["round", "四舍五入"], ["ord", "字符编码"], ["chr", "编码转字符"], ["bool", "转为布尔值"],
    ["open", "打开文件"], ["next", "迭代下一项"], ["isinstance", "检查类型"]
  ].map((args) => functionCompletion(...args)),
  snippetCompletion("for ${item} in ${items}:\n\t${}", { label: "for", type: "snippet", detail: "遍历循环", boost: 40 }),
  snippetCompletion("if ${condition}:\n\t${}", { label: "if", type: "snippet", detail: "条件判断", boost: 40 }),
  snippetCompletion("while ${condition}:\n\t${}", { label: "while", type: "snippet", detail: "条件循环", boost: 40 }),
  snippetCompletion("def ${solve}(${}):\n\t${pass}", { label: "def", type: "snippet", detail: "定义函数", boost: 40 })
];
const pythonMethods = [
  ["split", "拆分字符串"], ["strip", "去除两端空白"], ["join", "连接字符串"], ["append", "添加元素"],
  ["pop", "移除并返回元素"], ["sort", "原地排序"], ["extend", "追加多个元素"], ["get", "读取字典值"],
  ["items", "键值对"], ["keys", "所有键"], ["values", "所有值"], ["count", "统计出现次数"],
  ["index", "查找位置"], ["replace", "替换字符串"], ["lower", "转为小写"], ["upper", "转为大写"]
].map(([label, detail]) => functionCompletion(label, detail, undefined, 20, "method"));
const cCompletions = [
  ...keywords("auto break case char const continue default do double else enum extern float goto int long register return short signed sizeof static struct switch typedef union unsigned void volatile _Bool"),
  ...[
    ["printf", "格式化输出", 'printf("${1}")${0}', 50], ["scanf", "读取输入", 'scanf("${1:format}", &${2:value})${0}', 50],
    ["getchar", "读取一个字符"], ["putchar", "输出一个字符"], ["puts", "输出一行"],
    ["fgets", "读取一行"], ["strlen", "字符串长度"], ["strcmp", "比较字符串"], ["strcpy", "复制字符串"],
    ["memset", "填充内存"], ["memcpy", "复制内存"], ["malloc", "分配内存"], ["calloc", "分配并清零"],
    ["realloc", "重新分配内存"], ["free", "释放内存"], ["qsort", "数组排序"], ["abs", "整数绝对值"],
    ["sqrt", "平方根"], ["pow", "乘方"], ["atoi", "字符串转整数"]
  ].map((args) => functionCompletion(...args)),
  { label: "NULL", type: "constant", detail: "空指针" }, { label: "EOF", type: "constant", detail: "输入结束" },
  snippetCompletion("for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}", { label: "for", type: "snippet", detail: "计数循环", boost: 40 }),
  snippetCompletion("if (${condition}) {\n\t${}\n}", { label: "if", type: "snippet", detail: "条件判断", boost: 40 }),
  snippetCompletion("while (${condition}) {\n\t${}\n}", { label: "while", type: "snippet", detail: "条件循环", boost: 40 }),
  snippetCompletion("include <${1:stdio.h}>${0}", { label: "include", type: "snippet", detail: "引入头文件", boost: 40 })
];

function codeCompletions(context, name) {
  if (!languages[name]) return null;
  const word = context.matchBefore(/[A-Za-z_]\w*/);
  if (!word && !context.explicit) return null;
  const from = word?.from ?? context.pos;
  const tree = syntaxTree(context.state);
  for (let node = tree.resolveInner(context.pos, -1); node; node = node.parent) {
    if (/Comment|String|CharLiteral/.test(node.name)) return null;
  }
  const before = context.state.sliceDoc(Math.max(0, from - 2), from);
  const member = /\.\s*$/.test(before);
  if (member && name !== "python") return null;
  const options = new Map((member ? pythonMethods : name === "python" ? pythonCompletions : cCompletions).map((item) => [item.label, item]));
  if (name === "c" && !before.endsWith("#")) options.delete("include");
  if (!member && name === "python") {
    const token = tree.resolveInner(context.pos, -1);
    const linePrefix = context.state.sliceDoc(context.state.doc.lineAt(from).from, from);
    // 表达式中的 in 前缀优先 input；循环与比较运算中的 in 保留关键字。
    if (/^\s*(?:async\s+)?for\s+\w+(?:\s*,\s*\w+)*\s+$/.test(linePrefix) ||
        token.name === "in" && /ForStatement|BinaryExpression/.test(token.parent?.name || "")) {
      options.set("in", { label: "in", type: "keyword", boost: 99 });
    }
  }
  if (!member && name === "python") {
    for (const item of localCompletionSource(context)?.options || []) {
      options.set(item.label, { ...item, detail: "当前代码", boost: 30 });
    }
  } else if (!member) {
    tree.iterate({ from: Math.max(0, context.pos - 20000), to: context.pos,
      enter(node) {
        if (/Comment|String|CharLiteral/.test(node.name)) return false;
        if (node.name !== "Identifier" || node.to > from || options.size >= 150) return;
        const label = context.state.sliceDoc(node.from, node.to);
        if (!options.has(label)) options.set(label, { label, type: "variable", detail: "当前代码", boost: 30 });
      }
    });
  }
  // 候选按光标左边的前缀过滤，接受候选时再替换整个单词（包括右边的残余字符）。
  return { from, options: [...options.values()].map(wholeWordCompletion), validFor: (text) => /^[A-Za-z_]\w*$/.test(text) && text !== "in" };
}

function completeWithTab(view, name) {
  if (nextSnippetField(view) || acceptCompletion(view)) return true;
  if (view.state.selection.ranges.length !== 1 || !view.state.selection.main.empty) return indentWithTab.run(view);
  const context = new CompletionContext(view.state, view.state.selection.main.head, false, view);
  const result = codeCompletions(context, name);
  const prefix = result && view.state.sliceDoc(result.from, context.pos);
  const candidates = prefix ? result.options.filter((item) => item.label.startsWith(prefix)) : [];
  const score = (item) => (item.label === prefix ? 0 : -100) + (item.boost || 0);
  candidates.sort((a, b) => score(b) - score(a) || a.label.localeCompare(b.label));
  const item = candidates[0];
  if (!item) return indentWithTab.run(view);
  closeCompletion(view);
  item.apply(view, item, result.from, context.pos);
  return true;
}
const colors = HighlightStyle.define([
  { tag: tags.keyword, color: "#164ad8" },
  { tag: tags.comment, color: "#217a3c" },
  { tag: tags.string, color: "#b34221" },
  { tag: [tags.number, tags.bool, tags.null], color: "#7940bd" },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: "#8c5c00" },
  { tag: [tags.typeName, tags.className], color: "#006f87" },
  { tag: [tags.variableName, tags.propertyName], color: "#142b51" },
  { tag: tags.operator, color: "#425774" }
]);

function guides(view) {
  const ranges = [];
  for (const { from, to } of view.visibleRanges) {
    let line = view.state.doc.lineAt(from);
    while (line.from <= to) {
      const length = /^[\t ]+/.exec(line.text)?.[0].length || 0;
      if (length) ranges.push(Decoration.mark({ class: "cm-indent-guide" }).range(line.from, line.from + length));
      if (line.to >= view.state.doc.length) break;
      line = view.state.doc.line(line.number + 1);
    }
  }
  return Decoration.set(ranges, true);
}

const indentGuides = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = guides(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged) this.decorations = guides(update.view);
  }
}, { decorations: (plugin) => plugin.decorations });

export function create(parent, options = {}) {
  const language = new Compartment();
  let currentLanguage = options.language || "python";
  let silent = false;
  const state = (value, name) => EditorState.create({
    doc: value,
    extensions: [
      basicSetup,
      language.of(languageSupport(name)),
      autocompletion({
        override: [(context) => codeCompletions(context, currentLanguage)],
        defaultKeymap: false, icons: false, filterStrict: true, maxRenderedOptions: 30,
        activateOnTypingDelay: 120, interactionDelay: 0,
        tooltipClass: () => "code-completion-menu",
        addToOptions: [{ position: 20, render(item, _state, view) {
          const badge = view.dom.ownerDocument.createElement("span");
          const labels = { function: "函数", method: "方法", keyword: "关键字", variable: "变量", snippet: "片段", constant: "常量", class: "类型", namespace: "模块" };
          badge.className = `code-completion-kind code-completion-${item.type || "variable"}`;
          badge.textContent = labels[item.type] || "名称";
          return badge;
        } }]
      }),
      indentUnit.of("    "), EditorState.tabSize.of(4),
      syntaxHighlighting(colors), indentGuides,
      placeholder("在这里编写代码"),
      EditorView.contentAttributes.of({ "aria-label": "题目代码编辑器", "aria-describedby": "code-keyboard-help", "aria-multiline": "true", spellcheck: "false" }),
      Prec.highest(keymap.of([
        { key: "Mod-s", run: () => { options.onSave?.(); return true; } },
        { key: "Tab", run: (view) => completeWithTab(view, currentLanguage), shift: (view) => prevSnippetField(view) || indentWithTab.shift(view) },
        { key: "Escape", run: (view) => { closeCompletion(view); clearSnippet(view); view.setTabFocusMode(2000); return true; } },
        ...completionKeymap.filter((binding) => binding.key !== "Escape")
      ])),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !silent) options.onChange?.(update.state.doc.toString());
        if (update.selectionSet || update.docChanged) {
          const cursor = update.state.selection.main.head;
          const line = update.state.doc.lineAt(cursor);
          options.onCursor?.(line.number, cursor - line.from + 1);
        }
      }),
      EditorView.theme({
        "&": { height: "100%", backgroundColor: "#fff", color: "#142b51", fontSize: "15px" },
        ".cm-scroller": { minHeight: "0", overflow: "auto", fontFamily: "Consolas, 'Cascadia Code', 'SFMono-Regular', monospace", lineHeight: "1.7" },
        ".cm-content": { padding: "12px 0", minHeight: "100%", userSelect: "text", WebkitUserSelect: "text", cursor: "text" },
        ".cm-line": { padding: "0 14px" },
        ".cm-gutters": { backgroundColor: "#f5f8fd", color: "#667995", borderRight: "1px solid #e5edf7" },
        ".cm-activeLine": { backgroundColor: "transparent", boxShadow: "inset 0 0 0 1px #e5e7eb" },
        ".cm-activeLineGutter": { backgroundColor: "#f3f4f6" },
        ".cm-cursor": { borderLeftColor: "#142b51" },
        ".cm-indent-guide": { backgroundImage: "linear-gradient(to right, #dfe7f3 1px, transparent 1px)", backgroundSize: "4ch 100%" },
        "&.cm-focused": { outline: "none" },
        ".cm-selectionBackground": { backgroundColor: "#d3e5ff" },
        "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "#b8d5ff" },
        ".cm-tooltip.cm-tooltip-autocomplete": { border: "1px solid #cbdcf5", borderRadius: "12px", background: "#fff", color: "#142b51", boxShadow: "0 8px 28px rgba(25, 60, 110, .16)", overflow: "hidden", minWidth: "min(280px, calc(100vw - 32px))", maxWidth: "min(400px, calc(100vw - 32px))" },
        ".cm-tooltip-autocomplete > ul": { padding: "5px", maxHeight: "272px", fontFamily: "Consolas, 'Cascadia Code', monospace", fontSize: "14px", scrollbarWidth: "thin", scrollbarColor: "#bfd1eb transparent" },
        ".cm-tooltip-autocomplete > ul > li": { display: "flex", alignItems: "center", gap: "10px", minHeight: "36px", padding: "7px 9px", margin: "2px 0", borderRadius: "7px", boxSizing: "border-box" },
        ".cm-tooltip-autocomplete > ul > li:hover": { background: "#f3f7fd" },
        ".cm-tooltip-autocomplete > ul > li[aria-selected=true]": { background: "#e9f2ff", color: "#142b51", boxShadow: "inset 2px 0 0 #2563eb" },
        ".cm-completionLabel": { flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis" },
        ".cm-completionMatchedText": { color: "#1d4ed8", fontWeight: "700", textDecoration: "none" },
        ".cm-completionDetail": { color: "#52647d", fontSize: "12px", fontStyle: "normal", marginLeft: "0", fontFamily: "system-ui, sans-serif", maxWidth: "130px", overflow: "hidden", textOverflow: "ellipsis" },
        ".code-completion-kind": { flexShrink: "0", padding: "2px 5px", borderRadius: "4px", background: "#eff4fc", color: "#52647d", fontSize: "12px", lineHeight: "1.5", fontFamily: "system-ui, sans-serif" },
        ".code-completion-function, .code-completion-method": { color: "#1d4ed8", background: "#e7efff" },
        ".code-completion-keyword, .code-completion-snippet": { color: "#7341a7", background: "#f1eafb" },
        ".code-completion-variable": { color: "#21704b", background: "#e9f5ef" },
        ".cm-tooltip-autocomplete::after": { content: '"↑↓ 选择 · Tab 补全 · Esc 关闭"', display: "block", borderTop: "1px solid #e5edf7", padding: "8px 12px", background: "#f7faff", color: "#52647d", fontSize: "12px", fontFamily: "system-ui, sans-serif" },
        ".cm-snippetField": { background: "#e9f2ff", outline: "1px solid #bdd4f6", borderRadius: "2px" },
        "@media (pointer: coarse)": { ".cm-tooltip-autocomplete > ul > li": { minHeight: "44px" } }
      })
    ]
  });
  const view = new EditorView({ state: state(options.value || "", options.language || "python"), parent });
  return {
    getValue: () => view.state.doc.toString(),
    getSelectedText() {
      const ranges = view.state.selection.ranges.filter((range) => !range.empty);
      return ranges.length ? ranges.map((range) => view.state.sliceDoc(range.from, range.to)).join(view.state.lineBreak) : null;
    },
    getPosition() {
      const { anchor, head } = view.state.selection.main;
      return { anchor, head, scrollTop: view.scrollDOM.scrollTop, scrollLeft: view.scrollDOM.scrollLeft };
    },
    setDocument(value, name, position) {
      // 切换题目时重置撤销历史，避免撤销操作把另一题的代码带进来。
      silent = true;
      currentLanguage = name;
      try { view.setState(state(value, name)); } finally { silent = false; }
      if (position) {
        const bound = (pos) => Math.max(0, Math.min(value.length, pos));
        view.dispatch({ selection: { anchor: bound(position.anchor), head: bound(position.head) } });
        const restoredState = view.state;
        const restoreScroll = () => {
          if (view.state !== restoredState) return;
          view.scrollDOM.scrollTop = position.scrollTop; view.scrollDOM.scrollLeft = position.scrollLeft;
        };
        restoreScroll(); view.requestMeasure({ read: () => null, write: restoreScroll });
      }
      const cursor = view.state.selection.main.head, line = view.state.doc.lineAt(cursor);
      options.onCursor?.(line.number, cursor - line.from + 1);
    },
    goToLine(number) {
      if (!Number.isInteger(number) || number < 1 || number > view.state.doc.lines) return false;
      const line = view.state.doc.line(number);
      closeCompletion(view);
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
      view.focus(); return true;
    },
    setLanguage(name) { currentLanguage = name; closeCompletion(view); view.dispatch({ effects: language.reconfigure(languageSupport(name)) }); },
    dismissCompletion: () => closeCompletion(view),
    focus: () => view.focus(),
    refresh: () => view.requestMeasure(),
    destroy: () => view.destroy(),
    view
  };
}
