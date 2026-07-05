# EchoDistill · AI 评论总结助手

> 一个 Tampermonkey 油猴脚本，自动抓取当前页面的评论区，调用任意 OpenAI 兼容 LLM，输出结构化的中文 Markdown 舆情报告，并附带 AI 对抗性审视。

- 版本：`1.6.0`
- 作者：Kerinlin
- 协议：MIT
- 单文件零依赖：`ai-comment-summarizer.user.js`

---

## ✨ 核心特性

- **9 大平台专属抓取器**：YouTube、Reddit、Bilibili、知乎、小红书、X(Twitter)、Hacker News、微博、linux.do，各平台使用独立 DOM/Shadow DOM/JSON API 策略。
- **两段式 AI 输出**
  - **中立归纳报告**：讨论主题 / 核心观点 / 共识 / 分歧与争议 / 情绪与风向 / 高赞金句。
  - **对抗性审视（独立段落）**：AI 主动站到反方位置——质疑高赞、指出盲点、给出押注式判断与信心程度（高/中/低），失败自动重试一次。
- **智能分页与加载**：自动滚动加载、Shadow DOM 遍历、「查看更多」按钮自动点击；针对 Hacker News 用 `GM_xmlhttpRequest` 拉取分页 HTML 后合并 DOM；针对 linux.do 走 `/t/{id}.json` 全量拉取并按 `reply_to_post_number` 计算回复深度。
- **可中断**：抓取/推理任意阶段点击「停止总结」即时终止，请求通过 `AbortSignal` 一路下传。
- **高度可配置**：自定义 API Key、Endpoint、模型、最大评论数、最小点赞过滤、System Prompt 全部可改，支持重置默认 Prompt。
- **模型列表自动补全**：在设置面板输入框 focus 时自动请求 `{endpoint}/v1/models` 拉取模型列表，按输入实时过滤；获取失败可手动输入。
- **零依赖渲染**：内置轻量 Markdown 渲染器（标题/列表/引用/代码块/链接/删除线/加粗斜体），不引入任何外部 UI 库。
- **沉浸式 UI**：羊皮纸 + 墨蓝主题，悬浮 FAB、骨架屏加载态、一键复制原始 Markdown、Trusted Types 兼容。

---



## 🌐 支持平台


| 平台          | 域名匹配                      | 抓取策略                                               |
| ----------- | ------------------------- | -------------------------------------------------- |
| YouTube     | `*.youtube.com/*`         | `ytd-comment-thread-renderer` DOM 查询               |
| Reddit      | `*.reddit.com/*`          | `shreddit-comment` Web Component 属性解析              |
| Bilibili    | `*.bilibili.com/*`        | `bili-comments` Shadow Root 多层穿透                   |
| 知乎          | `*.zhihu.com/*`           | `.ContentItem.AnswerItem` DOM，自动展开全文+加载更多回答        |
| 小红书         | `*.xiaohongshu.com/*`     | 评论容器滚动加载 + 去重                                      |
| X (Twitter) | `*.twitter.com`、`*.x.com` | `article[data-testid="tweet"]` + ARIA 点赞数解析，滚动往返去重 |
| Hacker News | `news.ycombinator.com`    | 专属分页抓取（`GM_xmlhttpRequest` + DOM 合并），保留回复深度        |
| 微博          | `*.weibo.com/*`           | 评论区 DOM 查询                                         |
| linux.do    | `linux.do`、`*.linux.do`   | Discourse `/t/{id}.json` 全量分页拉取 + 回复深度计算           |


---



## 📦 安装



### 1. 安装用户脚本管理器

任选其一（推荐 ScriptCat）：

- [Tampermonkey](https://www.tampermonkey.net/)
- [Violentmonkey](https://violentmonkey.github.io/)
- [ScriptCat](https://docs.scriptcat.org/)



### 2. 安装脚本

1. 新建一个用户脚本。
2. 将本仓库 `ai-comment-summarizer.user.js` 全部内容粘贴进去并保存（Ctrl/Cmd+S）。
3. 刷新目标网页，右下角会出现 ✨ 悬浮按钮即安装成功。

---



## 🚀 使用



### 配置 AI 接口

1. 点击页面右下角 ✨ 按钮打开面板。
2. 点击右上角 ⚙ 进入设置。
3. 填入：
  - **API Key**：你的 LLM 服务密钥。
  - **API Endpoint**：OpenAI 兼容接口基址，**不含** `/v1` **路径**，例如 `http://localhost:8317` 或 `https://api.openai.com`。
  - **模型**：focus 后会自动拉取下拉候选，也可手动输入。
  - **最大评论数** / **最小点赞数过滤**：按需调整。
  - **自定义 Prompt**：默认 Prompt 已含完整输出格式约束，如需改造可在此编辑或点击「重置 Prompt」。
4. 保存。

默认配置（脚本内硬编码）：

```js
{
  apiKey: 'sk-sOisCHwyDG3GIhUvL',
  apiEndpoint: 'http://localhost:8317',
  model: 'MiniMax-M3',
  maxComments: 500,
  minLikes: 0,
  customPrompt: DEFAULT_PROMPT
}
```

> ⚠️ 默认 `apiKey` 与 `endpoint` 仅为开发占位，请务必替换为你自己的服务。



### 运行

在任意支持平台的帖子/视频页：

1. 点击 ✨ 按钮打开面板。
2. 点击底部「✨ 开始总结」。
3. 脚本会自动滚动加载评论 → 实时显示已抓取数量 → 调用 AI 生成中立归纳 → 再次调用 AI 生成对抗性审视。
4. 抓取或推理过程中按钮会变为「⏹ 停止总结」，可随时中断。
5. 结果区右下「📋 复制」一键复制完整 Markdown（含对抗性审视段落及来源标注）。

---



## 🧠 架构与数据流

```text
[Platform Scraper] ──► [Auto-Load / Paginate]
                       │
                       ▼
                 [Filter & Sort by likes]
                       │
                       ▼
                 [Context Builder]
                       │
                       ▼
            [LLM: 中立归纳报告]  ──►  [LLM: 对抗性审视]
                       │                       │
                       └─────────┬─────────────┘
                                 ▼
                       [Markdown Renderer]
                                 │
                                 ▼
                          [沉浸式 UI 面板]
```

- **抓取层**：`Scrapers` 对象按平台分发；Shadow DOM 与 Web Component 都做了穿透。
- **加载层**：每平台独立 autoLoad 函数（`autoLoadComments` / `autoLoadHNComments` / `autoLoadZHAnswers` / `autoLoadLinuxdoComments` / `autoLoadXHSComments` / `autoLoadBiliComments` / `autoLoadTwitterComments`），全部支持 `token.aborted` 中断。
- **推理层**：`callAI` 出中立报告，`callAIInsight` 出对抗性审视；均为 OpenAI 兼容 `/v1/chat/completions`，超时 120s。
- **渲染层**：`md()` 把模型返回的 Markdown 转成受控 HTML，对抗性审视段落用独立主题色（赭红 `#8b3a1f`）区分。

---



## 🔧 关键文件


| 文件                              | 说明           |
| ------------------------------- | ------------ |
| `ai-comment-summarizer.user.js` | 全部源码，单文件油猴脚本 |
| `LICENSE`                       | MIT          |
| `README.md`                     | 本文档          |


---



## 📝 默认输出结构（中立归纳报告）

```markdown
## 讨论主题
…

## 核心观点
- 一句话观点：依据/热度

## 共识
- …

## 分歧与争议
- 话题标题：争议点
  - 正方：…
  - 反方：…

## 情绪与风向
关键词 + 1-2 句说明

## 高赞金句
> 原文（👍 点赞数）
```

对抗性审视段落在主报告之后单独渲染，结构为 `### 质疑高赞 / ### 指出盲点 / ### AI 评论 / ### 信心程度`，复制时会被标注为「AI 生成，非社区共识」。

---



## ⚠️ 已知约束

- 抓取依赖目标网站的 DOM 结构，平台改版可能导致抓取器失效，需对应更新选择器。
- 评论去重基于文本完全匹配（小红书、Twitter），对仅空格/标点差异的近似重复不生效。
- 默认 Endpoint `http://localhost:8317` 指向本地代理，部署在无此代理的机器上需要替换为真实可访问的 OpenAI 兼容服务。
- `@connect *` 已放开所有出站域名，请自行确保 Endpoint 可信。

---



## 📜 许可证

[MIT](./LICENSE) © Kerinlin