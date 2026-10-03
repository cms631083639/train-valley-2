# UI 开发规则（强制参考）

> 本文件由项目维护者制定。**任何涉及 UI 改动（新增/修改组件、样式、交互）必须先读完本文件再动手。**
> 它会被 Trae 在每次新对话加载规则时自动带上，确保风格一致。

---

## 1. 先去 Tailwind UI Blocks 找参考

**每次做 UI 前，先打开这个页面找对应组件的源码结构：**

```
https://tailwindcss.com/plus/ui-blocks
```

应用工具类项目重点看 **Application UI** 分类：
- Application Shells（布局骨架：Stacked / Sidebar / Multi-Column）
- Headings（页面标题）
- Text Inputs / Select Menus / Checkboxes / Radio Groups（表单控件）
- Buttons（按钮样式）
- Cards（卡片）
- Tables（表格 —— 我们项目里大量用 flex 自己画表格，参考它的行/列/hover 技巧）
- Dropdowns / Menus（我们项目自定义下拉的结构模板）
- Modals / Dialogs（弹窗）
- Navigation（标签页、侧边栏）
- Lists（列表）

URL 模式：`https://tailwindcss.com/plus/ui-blocks/application-ui/<category>/<subcategory>`

**操作方式**：在 Tailwind UI Blocks 找到视觉上和我要做的组件最接近的那个 → 把它的类名组合当作起点 → 再用项目 token 替换颜色和间距。

---

## 2. 项目设计令牌（Tailwind v4 @theme）

颜色在 `src/styles/tailwind.css` 的 `@theme { ... }` 块里。**禁止写任何不在下面表里的颜色值**（包括硬编码 #xxx 和 RGB）。

| Token | 色值 | 用途 |
|---|---|---|
| `ink-900` | `#12161c` | 页面背景 |
| `ink-800` | `#1b212a` | 卡片、面板底色 |
| `ink-700` | `#232b36` | 输入框底色、悬浮态 |
| `ink-600` | `#2f3947` | 边框、分隔线 |
| `ink-500` | `#3a4656` | 次要边框、禁用边框 |
| `fog-100` | `#e6ebf2` | 主文字 |
| `fog-400` | `#8b98a9` | 次要文字（表头、提示） |
| `amber-brand` | `#e8a33d` | 琥珀色强调（⚡️ 电力、hover 高亮） |
| `steel-brand` | `#4f9dd9` | 钢蓝色强调（选中态、焦点环） |
| `station-sel` | `#608dd0` | 站点按钮选中态背景 |
| `stack-sel` | `#ffd157` | 栈按钮选中态背景 |
| `good` | `#58b368` | 原料类型标签 |
| `warn` | `#d9822b` | 警告 |
| `bad` | `#d9534f` | 错误、危险操作 |

字体：`'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif`

---

## 3. 基础控件基底样式（@layer base 已全局注册）

`input`, `select` 的默认样式已经在 base 层统一了：
- bg `ink-700`、border `ink-600`、color `fog-100`
- rounded `0.375rem`（6px）、px `0.625rem` py `0.25rem`、font `13px`
- focus ring：`1px solid steel-brand`

如果做自定义控件（步进器、自定义下拉、搜索框），**必须对齐这套圆角 / 边框 / 焦点环 / 字号**。

---

## 4. 已确认的组件约定

### 按钮（.btn 组件类）
如果元素上有 `.btn` 类，它的风格就是项目标准按钮，不要再叠额外 border-radius / background 除非确实要覆盖。

### 自定义下拉（代替原生 select）
结构必须是：
```html
<div class="relative w-[Wpx] shrink-0">
  <button class="...trigger类..." @click="toggle()">文本 ▾</button>
  <ul v-if="open" class="absolute left-0 top-full z-20 mt-0.5 max-h-[220px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg">
    <li v-for="..." :class="光标类" @mousedown.prevent="pick()">...</li>
  </ul>
</div>
```
- trigger 按钮要有 `:data-row="idx"` 方便 `document.querySelector` 定位
- ul 必须比 trigger 宽（`min-w-[220px]`），左边对齐 trigger
- 键盘：↑↓ 导航、Enter 展开/选中、Escape 关闭
- 失焦延迟 150ms 再收起（让 mousedown 能先触发 pick）

### 数字步进器（代替原生 type=number）
结构：
```html
<div class="flex h-7 w-[64px] overflow-hidden rounded border border-ink-500 bg-ink-800 text-[11px]">
  <button class="shrink-0 w-5 hover:text-amber-brand">−</button>
  <input type="text" inputmode="numeric" class="border-x border-ink-600 bg-transparent text-center outline-none" />
  <button class="shrink-0 w-5 hover:text-amber-brand">+</button>
</div>
```
- − 按钮在 qty<=1 时 `disabled:opacity-30`
- input 用 `type="text" + inputmode="numeric"`（彻底消掉系统 spinner）
- focus 自动选中方便覆盖

### 类型标签（raw / processed / compound）
```html
<span class="rounded px-1.5 py-0.5 text-center text-[11px] font-medium whitespace-nowrap border
  {{ raw:        'bg-good/15 text-good border-good/30' }}
  {{ processed:  'bg-steel-brand/15 text-steel-brand border-steel-brand/30' }}
  {{ compound:   'bg-amber-brand/15 text-amber-brand border-amber-brand/30' }}">
  {{ 原料/加工品/复合品 }}
</span>
```

---

## 5. 代码规范

- Vue 3 `<script setup>` + Composition API
- 组件拆分粒度：一个 .vue 一个语义块，不做过度拆分
- 状态来源：Pinia store → props → 组件内 reactive；**绝不跨层直接 import store**
- 模板里的内联事件处理如果超过 1 行就抽成函数
- 注释用中文（项目团队母语）

---

## 6. 构建命令

```bash
npm run build    # vue-tsc --noEmit && vite build
npm run dev      # Vite HMR
```

改动后先 `npm run build` 再交付，不允许构建失败就结束。
