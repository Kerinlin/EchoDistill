// ==UserScript==
// @name         AI 评论总结助手
// @namespace    http://tampermonkey.net/
// @version      1.6.0
// @description  自动抓取当前页面的评论并使用 AI 进行总结（Markdown + 主题摘要 + AI 独立洞察）
// @author       Kerinlin
// @match        *://*.youtube.com/*
// @match        *://*.reddit.com/*
// @match        *://*.bilibili.com/*
// @match        *://*.zhihu.com/*
// @match        *://*.xiaohongshu.com/*
// @match        *://*.twitter.com/*
// @match        *://*.x.com/*
// @match        *://news.ycombinator.com/*
// @match        https://linux.do/*
// @match        https://*.linux.do/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      *
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const _ttPolicy = (typeof trustedTypes !== 'undefined' && trustedTypes.createPolicy)
    ? trustedTypes.createPolicy('ai-comment-summarizer', { createHTML: s => s })
    : null;
  function safeHTML(el, html) {
    if (_ttPolicy) el.innerHTML = _ttPolicy.createHTML(html);
    else el.innerHTML = html;
  }

  const CONFIG_KEY = 'ai_comment_summarizer_config';

  const DEFAULT_PROMPT = `你是一位资深的社区舆情分析师。请阅读我提供的「帖子标题 + 评论列表」，输出一份结构化的中文分析报告。

【输出格式（严格使用 Markdown，不要输出任何多余的解释或开场白）】

## 讨论主题
用 1-2 句话概括本次讨论的核心议题，需结合标题与评论整体判断，避免复述标题。

## 核心观点
列出评论中反复出现、最具代表性的观点（3-6 条），格式：
- 一句话观点：补充说明该观点的依据或背景（可标注大致占比 / 热度，如「多数人认为」「少数声音」）。

## 共识
- 评论者普遍认同的 2-4 个点，尽量具体，不要空泛。

## 分歧与争议
列出 2-4 个存在对立的话题，每个话题单独成段，严格按以下格式输出（正方、反方各占一行，不要合并）：
- 话题标题：简述争议点。
  - 正方：正方核心立场，1 句话。
  - 反方：反方核心立场，1 句话。

## 情绪与风向
用 2-4 个关键词概括整体情绪（如：期待、吐槽、质疑、玩梗……），再用 1-2 句话说明原因；若情绪有明显变化或分裂，也请点明。

## 高赞金句
挑选 1-3 条最有代表性、信息量或话题度的原文，用引用块展示（保留原文语言），并在括号内标注点赞数：
> 原文内容（👍 点赞数）

【硬性要求】
1. 全程使用简体中文输出（金句保留原文）。
2. 严格使用 Markdown 语法（##、-、**、>）。
3. 只输出中立归纳，不要给出个人立场或判断（独立判断由系统另行生成）。
4. 不要客气、不要奉承、不要"以上只是个人浅见"之类的自我消解。
5. 证据不足的部分可如实说明「样本有限」。`;

  const INSIGHT_PROMPT = `你是对抗性测试员，不是反方辩手。系统已完成对某帖子评论的中立归纳，现在请对它执行对抗性测试：尝试挑翻高赞、挖出群体盲区，再基于测试结果和全部证据下判断。判断方向不预设——证据支持主流就认同，不支持就反对，但不许为了对抗而对抗。

【输出格式（严格 Markdown，不要任何开场白，不要输出顶层 # 或 ## 标题，直接从 ### 开始）】

### 质疑高赞
挑出归纳中最被高赞但不成立（或有重大遗漏）的一条，1-2 句话直接驳它。如果高赞都站得住，如实说"未找到明显漏洞"。

### 指出盲点
评论中集体遗漏的一个变量（事实、视角、风险），1-2 句话说清。

### AI 评论
基于以上测试和全部证据，1-2 句话给出你的真实判断。可以是认同主流、反对主流、或综合判断，但必须押注一方，不许骑墙、不许"从多个角度看"、不许"仁者见仁"。

### 信心程度
用「高 / 中 / 低」三档之一标注你对上述判断的自信度，格式：信心程度：高

【硬性要求】
1. 全程使用简体中文。
2. 仅基于归纳内容推理，不引入归纳之外的未知事实。
3. 不要客气、不要自我消解、不要"以上仅供参考"。
4. 判断方向不预设——证据支持主流就认同，证据不支持就反对，不允许为了对抗而对抗。`;

  const DEFAULT_CONFIG = {
    apiKey: 'sk-sOisCHwyDG3GIhUvL',
    apiEndpoint: 'http://localhost:8317',
    model: 'MiniMax-M3',
    maxComments: 500,
    minLikes: 0,
    customPrompt: DEFAULT_PROMPT
  };

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function md(input) {
    if (!input) return '';
    const codeBlocks = [];
    input = input.replace(/```([\s\S]*?)```/g, (_, code) => {
      codeBlocks.push(code);
      return '\x00CB' + (codeBlocks.length - 1) + '\x00';
    });
    const inlineCodes = [];
    // 修复 1：补回起始反引号，原代码 `([^\n]+)` 缺少开头的 `
    input = input.replace(/`([^\n]+)`/g, (_, code) => {
      inlineCodes.push(code);
      return '\x00IC' + (inlineCodes.length - 1) + '\x00';
    });
    let html = escapeHtml(input);
    html = html.replace(/^######\s?(.*)$/gm, '<h6>$1</h6>')
               .replace(/^#####\s?(.*)$/gm, '<h5>$1</h5>')
               .replace(/^####\s?(.*)$/gm, '<h4>$1</h4>')
               .replace(/^###\s?(.*)$/gm, '<h3>$1</h3>')
               .replace(/^##\s?(.*)$/gm, '<h2>$1</h2>')
               .replace(/^#\s?(.*)$/gm, '<h1>$1</h1>');
    html = html.replace(/^\s*---\s*$/gm, '<hr>');
    html = html.replace(/(^|\n)((?:&gt; .*(?:\n|$))+)/g, (m, pre, block) => {
      const inner = block.trim().split('\n').map(l => l.replace(/^&gt;\s?/, '')).join('<br>');
      return pre + '<blockquote>' + inner + '</blockquote>';
    });
    html = html.replace(/(^|\n)((?:[-*]\s+.*(?:\n|$))+)/g, (m, pre, block) => {
      const items = block.trim().split('\n').map(l => '<li>' + l.replace(/^[-*]\s+/, '') + '</li>').join('');
      return pre + '<ul>' + items + '</ul>';
    });
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
               .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
               .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>');
    html = html.split(/\n{2,}/).map(p => {
      p = p.trim();
      if (!p) return '';
      if (/^<(h\d|ul|ol|blockquote|hr|pre)/.test(p)) return p;
      return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');
    html = html.replace(/\x00CB(\d+)\x00/g, (_, i) =>
        '<pre><code>' + escapeHtml(codeBlocks[+i]) + '</code></pre>');
    html = html.replace(/\x00IC(\d+)\x00/g, (_, i) =>
        '<code>' + escapeHtml(inlineCodes[+i]) + '</code>');
    return html;
  }

  function loadConfig() {
    try { return Object.assign({}, DEFAULT_CONFIG, JSON.parse(GM_getValue(CONFIG_KEY, '{}'))); }
    catch { return Object.assign({}, DEFAULT_CONFIG); }
  }

  function saveConfig(cfg) { GM_setValue(CONFIG_KEY, JSON.stringify(cfg)); }

  let config = loadConfig();

  GM_addStyle(`
#ai-fab{position:fixed;bottom:24px;right:24px;z-index:999999;width:52px;height:52px;border-radius:50%;background:#1B365D;color:#faf5ea;border:1px solid #14263f;cursor:pointer;box-shadow:0 2px 8px rgba(27,54,93,.22);font-size:22px;display:flex;align-items:center;justify-content:center;transition:transform .2s,box-shadow .2s;font-family:Georgia,"Songti SC","STSong",serif}
#ai-fab:hover{transform:scale(1.06);box-shadow:0 4px 14px rgba(27,54,93,.32)}
#ai-fab:disabled{opacity:.5;cursor:wait}
#ai-panel{position:fixed;bottom:86px;right:24px;z-index:999999;width:460px;max-width:calc(100vw - 40px);max-height:76vh;background:#faf5ea;color:#2a2520;border-radius:4px;box-shadow:0 10px 32px rgba(42,37,32,.18);display:none;flex-direction:column;overflow:hidden;font-family:Georgia,"Songti SC","STSong","Source Han Serif SC",serif;border:1px solid #e0d5c0;animation:ai-pop .18s ease-out}
@keyframes ai-pop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
#ai-panel.open{display:flex}
#ai-panel .ai-hd{padding:12px 16px;background:#f5efe0;border-bottom:1px solid #e0d5c0;display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:14px;min-height:44px;letter-spacing:.01em}
#ai-panel .ai-hd .ai-title{display:flex;align-items:center;gap:7px;line-height:1;color:#1B365D}
#ai-panel .ai-hd .ai-title em{font-style:normal;font-size:11px;background:#1B365D;color:#faf5ea;padding:2px 7px;border-radius:2px;line-height:1.4;display:inline-flex;align-items:center;font-family:Georgia,serif}
#ai-panel .ai-hd .ai-actions{display:flex;align-items:center;gap:5px}
#ai-panel .ai-hd button{background:transparent;border:1px solid transparent;color:#5a5248;cursor:pointer;font-size:13px;width:27px;height:27px;border-radius:3px;display:inline-flex;align-items:center;justify-content:center;transition:background .15s,border-color .15s;font-family:inherit}
#ai-panel .ai-hd button:hover{background:#faf5ea;border-color:#e0d5c0;color:#1B365D}
#ai-panel .ai-meta{padding:10px 16px;background:#faf5ea;border-bottom:1px solid #ecd9b8;font-size:12px;color:#8a7f70;display:flex;align-items:center;gap:8px;font-style:italic}
#ai-panel .ai-meta .ai-topic{flex:1;min-width:0;color:#3a342c;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-style:normal}
#ai-panel .ai-meta .ai-topic::before{content:"§ "}
#ai-panel .ai-body{padding:18px 22px;overflow-y:auto;line-height:1.75;font-size:14px;flex:1;min-height:150px;color:#3a342c;scrollbar-width:thin;scrollbar-color:#c9bea8 transparent}
#ai-panel .ai-body::-webkit-scrollbar{width:8px}
#ai-panel .ai-body::-webkit-scrollbar-thumb{background:#c9bea8;border-radius:4px}
#ai-panel .ai-body.status{display:flex;align-items:center;justify-content:center;color:#8a7f70;font-style:italic;text-align:center;padding:40px 24px}
#ai-panel .ai-skeleton{display:flex;flex-direction:column;gap:11px}
#ai-panel .ai-skeleton .ai-bar{height:11px;background:linear-gradient(90deg,#ece3d0 25%,#dfd4bc 50%,#ece3d0 75%);background-size:200% 100%;border-radius:2px;animation:sk-shine 1.4s infinite}
#ai-panel .ai-skeleton .ai-bar.w70{width:70%}
#ai-panel .ai-skeleton .ai-bar.w90{width:90%}
#ai-panel .ai-skeleton .ai-bar.w50{width:50%}
@keyframes sk-shine{0%{background-position:200% 0}100%{background-position:-200% 0}}
#ai-panel .ai-actions-row{padding:12px 16px;border-top:1px solid #e0d5c0;display:flex;gap:10px;background:#f5efe0}
#ai-panel .ai-actions-row button{flex:1;display:flex;align-items:center;justify-content:center;gap:5px;padding:9px 10px;border:1px solid #e0d5c0;border-radius:3px;cursor:pointer;font-size:13.5px;font-weight:500;line-height:1;transition:background .15s,transform .1s;font-family:inherit}
#ai-panel .ai-actions-row button:active{transform:scale(.97)}
#ai-panel .ai-actions-row button.ai-primary{background:#1B365D;color:#faf5ea;border-color:#14263f}
#ai-panel .ai-actions-row button.ai-primary:hover{background:#14263f}
#ai-panel .ai-actions-row button.ai-ghost{background:#faf5ea;color:#3a342c}
#ai-panel .ai-actions-row button.ai-ghost:hover{background:#f0e9d8}
#ai-panel .ai-actions-row button.ai-stopping{background:#8b3a1f;color:#faf5ea;border-color:#6b2c17;animation:ai-pulse 1.2s ease-in-out infinite}
#ai-panel .ai-actions-row button.ai-stopping:hover{background:#6b2c17}
@keyframes ai-pulse{0%,100%{opacity:1}50%{opacity:.72}}
.ai-insight{margin:18px -22px 0;padding:14px 22px 16px;background:#fbf2e8;border-top:1px dashed #d4a574;border-bottom:1px dashed #d4a574;position:relative}
.ai-insight::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#8b3a1f}
.ai-insight .ai-insight-tag{display:inline-flex;align-items:center;gap:5px;background:#8b3a1f;color:#faf5ea;padding:3px 9px;border-radius:2px;font-size:11px;font-weight:600;letter-spacing:.05em;margin-bottom:10px;font-family:Georgia,serif}
.ai-insight .ai-insight-notice{font-size:11.5px;color:#8b3a1f;font-style:italic;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid rgba(139,58,31,.18)}
.ai-insight h2{color:#8b3a1f !important;margin-top:14px}
.ai-insight h2:first-child{margin-top:0}
.ai-insight h2::before{background:#8b3a1f !important}
.ai-insight li::before{color:#8b3a1f !important}
.ai-insight blockquote{border-left-color:#8b3a1f !important;background:#f5e8d8 !important}
#ai-panel .ai-body h1,#ai-panel .ai-body h2,#ai-panel .ai-body h3{margin:16px 0 8px;font-weight:700;line-height:1.3;letter-spacing:.005em}
#ai-panel .ai-body h1{font-size:18px;color:#1B365D;border-bottom:1px solid #e0d5c0;padding-bottom:5px}
#ai-panel .ai-body h2{font-size:15.5px;color:#1B365D;display:flex;align-items:center;gap:7px;margin-top:18px}
#ai-panel .ai-body h2::before{content:"";display:inline-block;width:3px;height:14px;background:#1B365D;flex-shrink:0}
#ai-panel .ai-body h2:first-child{margin-top:0}
#ai-panel .ai-body h3{font-size:14px;color:#2c5278}
#ai-panel .ai-body p{margin:7px 0}
#ai-panel .ai-body ul{margin:8px 0;padding-left:22px}
#ai-panel .ai-body li{margin:6px 0;list-style:none;position:relative;padding-left:4px}
#ai-panel .ai-body li::before{content:"▸";color:#1B365D;position:absolute;left:-15px;top:0}
#ai-panel .ai-body strong{color:#8b3a1f;font-weight:700}
#ai-panel .ai-body em{color:#2c5278;font-style:italic}
#ai-panel .ai-body blockquote{margin:10px 0;padding:10px 14px;background:#f5efe0;border-left:3px solid #1B365D;border-radius:0 2px 2px 0;color:#5a5248;font-style:italic}
#ai-panel .ai-body hr{border:none;border-top:1px dashed #c9bea8;margin:16px 0}
#ai-panel .ai-body code{background:#f0e9d8;padding:2px 6px;border-radius:2px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:#8b3a1f;border:1px solid #e0d5c0}
#ai-panel .ai-body pre{background:#f5efe0;padding:12px;border-radius:3px;overflow-x:auto;border:1px solid #e0d5c0}
#ai-panel .ai-body pre code{background:none;border:none;color:#3a342c}
#ai-panel .ai-body a{color:#1B365D;text-decoration:none;border-bottom:1px solid rgba(27,54,93,.4)}
#ai-panel .ai-body a:hover{border-bottom-color:#1B365D}
#ai-panel .ai-body del{color:#a89e8a}
#ai-settings{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1000000;width:520px;max-width:calc(100vw - 40px);max-height:82vh;overflow:auto;background:#faf5ea;color:#2a2520;border-radius:4px;box-shadow:0 14px 44px rgba(42,37,32,.24);padding:24px;display:none;font-family:Georgia,"Songti SC","STSong","Source Han Serif SC",serif;border:1px solid #e0d5c0}
#ai-settings.open{display:block}
#ai-settings h3{margin-top:0;color:#1B365D;border-bottom:1px solid #e0d5c0;padding-bottom:8px;font-size:16px}
#ai-settings label{display:block;margin:12px 0 5px;font-size:13px;color:#5a5248;font-style:italic}
#ai-settings input,#ai-settings textarea{width:100%;padding:9px 11px;background:#fffdf7;color:#2a2520;border:1px solid #e0d5c0;border-radius:3px;font-size:13px;box-sizing:border-box;font-family:inherit;transition:border-color .15s,box-shadow .15s}
#ai-settings input:focus,#ai-settings textarea:focus{outline:none;border-color:#1B365D;box-shadow:0 0 0 2px rgba(27,54,93,.12)}
#ai-settings textarea{min-height:200px;resize:vertical;font-family:ui-monospace,Menlo,monospace;line-height:1.6}
#ai-settings .ai-row{display:flex;gap:12px}
#ai-settings .ai-row>div{flex:1}
#ai-settings .ai-footer{margin-top:20px;display:flex;gap:8px;justify-content:flex-end}
#ai-settings button{padding:9px 18px;border:1px solid #e0d5c0;border-radius:3px;cursor:pointer;font-size:13px;font-family:inherit;transition:background .15s;display:inline-flex;align-items:center;justify-content:center;line-height:1;vertical-align:middle;box-sizing:border-box}
#ai-settings .ai-save{background:#1B365D;color:#faf5ea;border-color:#14263f}
#ai-settings .ai-save:hover{background:#14263f}
#ai-settings .ai-cancel{background:#faf5ea;color:#3a342c}
#ai-settings .ai-cancel:hover{background:#f0e9d8}
#ai-settings .ai-reset{background:#faf5ea;color:#8b3a1f;border-color:#d4b8a8;margin-right:auto}
#ai-settings .ai-reset:hover{background:#f5efe0}
.ai-model-dropdown{position:absolute;left:0;right:0;top:100%;max-height:200px;overflow-y:auto;background:#fffdf7;border:1px solid #e0d5c0;border-top:none;border-radius:0 0 3px 3px;box-shadow:0 4px 12px rgba(42,37,32,.12);z-index:10;display:none}
.ai-model-item{padding:7px 11px;cursor:pointer;font-size:13px;color:#2a2520}
.ai-model-item:hover{background:#f0e9d8}
.ai-model-loading,.ai-model-error{font-style:italic;color:#8a7f70;cursor:default}
.ai-model-loading:hover,.ai-model-error:hover{background:transparent}
`);

  const Scrapers = {
    youtube() {
      return Array.from(document.querySelectorAll('ytd-comment-thread-renderer')).map(el => ({
        author: (el.querySelector('#author-text')?.textContent || '').trim(),
        text: (el.querySelector('#content-text')?.innerText || '').trim(),
        likes: parseInt(el.querySelector('#vote-count-middle')?.textContent || '0', 10) || 0
      })).filter(c => c.text);
    },
    reddit() {
      return Array.from(document.querySelectorAll('shreddit-comment')).map(el => ({
        author: el.getAttribute('author') || '',
        text: (el.querySelector('[slot="comment"]')?.innerText || el.querySelector('div[md]')?.innerText || '').trim(),
        likes: parseInt(el.getAttribute('score') || '0', 10) || 0
      })).filter(c => c.text);
    },
    bilibili() {
      const root = document.querySelector('bili-comments')?.shadowRoot;
      if (!root) return [];
      return Array.from(root.querySelectorAll('bili-comment-thread-renderer')).map(t => {
        const comment = t?.shadowRoot?.querySelector('bili-comment-renderer');
        const cr = comment?.shadowRoot;
        if (!cr) return { author: '', text: '', likes: 0 };
        const userInfo = cr.querySelector('#header bili-comment-user-info');
        const author = userInfo?.shadowRoot?.querySelector('#user-name')?.textContent?.trim()
            || userInfo?.textContent?.trim() || '';
        const rich = cr.querySelector('#content bili-rich-text');
        const text = rich?.shadowRoot?.querySelector('#contents')?.textContent?.trim()
            || rich?.textContent?.trim() || '';
        const actions = cr.querySelector('#footer bili-comment-action-buttons-renderer');
        const likes = parseInt(actions?.shadowRoot?.querySelector('#like')?.textContent?.trim() || '0', 10) || 0;
        return { author, text, likes };
      }).filter(c => c.text);
    },
    zhihu() {
      return Array.from(document.querySelectorAll('.ContentItem.AnswerItem')).map(el => {
        const authorEl = el.querySelector('.AuthorInfo-name, .UserLink-link, a[href*="/people/"]');
        const contentEl = el.querySelector('.RichText, .AnswerContent .RichText, .ContentItem.RichText');
        const voteBtn = el.querySelector('button[aria-label^="赞同"]');
        let likes = 0;
        if (voteBtn) {
          const m = (voteBtn.getAttribute('aria-label') || voteBtn.innerText || '').match(/\d+/);
          if (m) likes = parseInt(m[0], 10) || 0;
        }
        return {
          author: (authorEl?.textContent || '').trim() || '匿名',
          text: (contentEl?.innerText || '').trim(),
          likes,
          accepted: el.getAttribute('itemprop') === 'acceptedAnswer'
        };
      }).filter(c => c.text);
    },
    xiaohongshu() {
      const items = Array.from(document.querySelectorAll('.comment-item, .comment-inner, .comment-item-sub'));
      const seen = new Set();
      return items.map(el => {
        const author = (el.querySelector('.user-name, .author, .author-wrapper [class*="name"]')?.textContent || '').trim();
        const text = (el.querySelector('.content, .note-text, .text, [class*="content"]')?.innerText || '').trim();
        if (!text || seen.has(text)) return { author: '', text: '', likes: 0 };
        seen.add(text);
        const likeEl = el.querySelector('.like-count, .like, [class*="like"]');
        const likes = parseInt(likeEl?.textContent || '0', 10) || 0;
        return { author, text, likes };
      }).filter(c => c.text);
    },
    twitter() {
      if (window.__ai_twitter_comments) return window.__ai_twitter_comments;
      return Array.from(document.querySelectorAll('article[data-testid="tweet"]')).map(el => {
        const userNameEl = el.querySelector('[data-testid="User-Name"]');
        let author = '';
        if (userNameEl) {
          const firstLink = userNameEl.querySelector('a span') || userNameEl.querySelector('a');
          if (firstLink) author = firstLink.textContent.trim();
          if (!author || author.startsWith('@')) {
            author = userNameEl.textContent
              .replace(/@[A-Za-z0-9_]+/, '')
              .replace(/·\s*[\dhms]+(\s*(AM|PM|hours?|hrs?|mins?|minutes?|days?))?\s*$/i, '')
              .replace(/·\s*\d+[hm]\s*$/i, '')
              .trim();
          }
        }

        const textEl = el.querySelector('[data-testid="tweetText"]');
        let text = '';
        if (textEl) {
          text = textEl.innerText.trim();
        } else {
          const langEls = el.querySelectorAll('[lang]');
          text = [...langEls].map(l => l.textContent.trim()).join(' ').trim();
        }

        const likeAria = el.querySelector('[data-testid="like"]')?.getAttribute('aria-label') || '';
        let likes = 0;
        const lm = likeAria.match(/([\d,.]+)\s*Likes?/i);
        if (lm) {
          const raw = lm[1].replace(/,/g, '');
          if (/k$/i.test(raw)) likes = Math.round(parseFloat(raw) * 1000);
          else if (/m$/i.test(raw)) likes = Math.round(parseFloat(raw) * 1000000);
          else likes = parseInt(raw, 10) || 0;
        }

        return { author, text, likes };
      }).filter(c => c.text);
    },
    hackernews() {
      return Array.from(document.querySelectorAll('tr.athing.comtr')).map(el => {
        const author = el.querySelector('.hnuser')?.textContent?.trim() || '';
        const text = el.querySelector('.commtext')?.innerText?.trim() || '';
        const scoreText = el.querySelector('.score')?.textContent || '';
        const likes = parseInt(scoreText.replace(/[^\d]/g, ''), 10) || 0;
        const indent = el.querySelector('.ind')?.getAttribute('indent') || '0';
        const depth = parseInt(indent, 10) || 0;
        return { author, text, likes, depth };
      }).filter(c => c.text);
    },
    linuxdo() {
      if (window.__ai_linuxdo_comments) return window.__ai_linuxdo_comments;
      return Array.from(document.querySelectorAll('.topic-post')).map(p => {
        const cooked = p.querySelector('.cooked');
        const user = p.querySelector('a[data-user-card]');
        const counter = p.querySelector('.discourse-reactions-counter .reactions-counter');
        return {
          author: (user?.textContent || '').trim() || '匿名',
          text: (cooked?.innerText || '').trim(),
          likes: parseInt((counter?.textContent || '0').trim(), 10) || 0,
          isOP: p.classList.contains('post--topic-owner')
        };
      }).filter(c => c.text);
    }
  };

  function detectScraper() {
    const h = location.hostname;
    if (h.includes('youtube.com')) return 'youtube';
    if (h.includes('reddit.com')) return 'reddit';
    if (h.includes('bilibili.com')) return 'bilibili';
    if (h.includes('zhihu.com')) return 'zhihu';
    if (h.includes('xiaohongshu.com')) return 'xiaohongshu';
    if (h.includes('twitter.com') || h.includes('x.com')) return 'twitter';
    if (h.includes('news.ycombinator.com')) return 'hackernews';
    if (h.includes('linux.do')) return 'linuxdo';
    return null;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function autoLoadComments(scraper, max, cb, token) {
    let last = 0, stable = 0;
    for (let i = 0; i < 40; i++) {
      if (token?.aborted) return;
      clickMoreButtons();

      const ytCont = document.querySelector(
        'ytd-comments #contents > ytd-continuation-item-renderer, ' +
        'ytd-item-section-renderer#sections #contents > ytd-continuation-item-renderer'
      );
      if (ytCont) {
        ytCont.scrollIntoView({ behavior: 'instant', block: 'center' });
      } else {
        const c = document.querySelector('shreddit-app')
               || document.scrollingElement;
        if (c) c.scrollTop = c.scrollHeight;
        window.scrollTo(0, document.documentElement.scrollHeight);
      }
      await sleep(1200);
      if (token?.aborted) return;
      const items = scraper();
      if (items.length >= max) break;
      if (items.length === last) { stable++; if (stable >= 4) break; }
      else stable = 0;
      last = items.length;
      cb && cb(items.length);
    }
    for (let k = 0; k < 8; k++) {
      if (token?.aborted) return;
      const before = scraper().length;
      clickMoreButtons();
      await sleep(1500);
      if (token?.aborted) return;
      const after = scraper().length;
      cb && cb(after);
      if (after >= max || after === before) break;
    }
  }

  async function autoLoadTwitterComments(scraper, max, cb, token) {
    const collected = new Map();

    let batch = scraper();
    for (const c of batch) {
      if (c.text) collected.set(c.text, c);
    }
    cb && cb(collected.size);

    let prevSize = collected.size;
    let stable = 0;
    for (let i = 0; i < 40; i++) {
      if (token?.aborted) return;
      if (i % 2 === 0) {
        window.scrollTo(0, document.documentElement.scrollHeight);
      } else {
        window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - window.innerHeight * 1.5));
        await sleep(300);
        window.scrollTo(0, document.documentElement.scrollHeight);
      }
      await sleep(1500);
      if (token?.aborted) return;

      batch = scraper();
      for (const c of batch) {
        if (c.text) collected.set(c.text, c);
      }

      if (collected.size >= max) break;

      if (collected.size === prevSize) {
        stable++;
        if (stable >= 4) break;
      } else {
        stable = 0;
      }
      prevSize = collected.size;
      cb && cb(collected.size);
    }

    stable = 0;
    let lastSize = collected.size;
    for (let i = 0; i < 10; i++) {
      if (token?.aborted) return;
      const scrollStep = Math.floor(document.documentElement.scrollHeight / 6);
      const target = document.documentElement.scrollHeight - (i + 1) * scrollStep;
      window.scrollTo(0, Math.max(0, target));
      await sleep(1200);
      if (token?.aborted) return;

      batch = scraper();
      for (const c of batch) {
        if (c.text) collected.set(c.text, c);
      }

      if (collected.size === lastSize) {
        stable++;
        if (stable >= 3) break;
      } else {
        stable = 0;
      }
      lastSize = collected.size;
      cb && cb(collected.size);
    }

    window.__ai_twitter_comments = [...collected.values()];
    cb && cb(collected.size);
  }

  function findXHSCommentScroller() {
    const item = document.querySelector('.comment-item, .comment-item-sub');
    let node = item?.parentElement;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 20) {
        return node;
      }
      node = node.parentElement;
    }
    return document.scrollingElement;
  }

  async function autoLoadXHSComments(scraper, max, cb, token) {
    const SAFE = 500;
    let last = 0, stable = 0;
    for (let i = 0; i < 30; i++) {
      if (token?.aborted) return;
      const scroller = findXHSCommentScroller();
      if (scroller && scroller !== document.scrollingElement) {
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
      }
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(1800 + Math.random() * 700);
      if (token?.aborted) return;

      const items = scraper();
      if (items.length >= max || items.length >= SAFE) break;
      if (items.length === last) { stable++; if (stable >= 4) break; }
      else stable = 0;
      last = items.length;
      cb && cb(items.length);
    }
  }

  async function autoLoadBiliComments(scraper, max, cb, token) {
    const SAFE = 500;
    let last = 0, stable = 0;
    for (let i = 0; i < 30; i++) {
      if (token?.aborted) return;
      const c = document.scrollingElement;
      if (c) c.scrollTop = c.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(1500 + Math.random() * 600);
      if (token?.aborted) return;
      const items = scraper();
      if (items.length >= max || items.length >= SAFE) break;
      if (items.length === last) { stable++; if (stable >= 4) break; }
      else stable = 0;
      last = items.length;
      cb && cb(items.length);
    }
  }

  const _shadowHosts = new Set();
  const _clickedBtns = new WeakSet();
  let _scanTick = 0;

  function collectShadowHosts() {
    _shadowHosts.clear();
    function walk(root) {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          _shadowHosts.add(el);
          walk(el.shadowRoot);
        }
      }
    }
    walk(document);
  }

  function clickMoreButtons() {
    if ((_scanTick++ & 7) === 0) collectShadowHosts();

    const RE = /查看更多|更多评论|更多回复|加载更多|展开更多|更多结果|展开.*条回复|View more|more replies|load more|see more|show more/i;
    const EXCLUDE_RE = /^Follow$|^关注$|^Unfollow$|^取消关注$/i;
    const SIDEBAR = '[data-testid="sidebarColumn"], [aria-label="Trends for you"], [aria-label="Who to follow"]';

    const roots = [document];
    for (const host of _shadowHosts) {
      if (host.isConnected && host.shadowRoot) roots.push(host.shadowRoot);
    }

    let clicked = 0;
    for (const root of roots) {
      let btns;
      try { btns = root.querySelectorAll('button, a, [role="button"]'); }
      catch { continue; }
      for (const b of btns) {
        if (_clickedBtns.has(b)) continue;
        if (b.closest(SIDEBAR)) continue;
        const txt = (b.innerText || b.textContent || '').trim();
        if (!txt || txt.length >= 40) continue;
        if (EXCLUDE_RE.test(txt)) continue;
        if (RE.test(txt)) {
          try { b.click(); _clickedBtns.add(b); clicked++; } catch {}
        }
      }
    }
    return clicked;
  }

  function fetchHNPage(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        anonymous: true,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) resolve(res.responseText);
          else reject(new Error('HN page HTTP ' + res.status));
        },
        onerror: (e) => reject(new Error('HN page fetch failed: ' + (e.error || 'network')))
      });
    });
  }

  async function autoLoadHNComments(scraper, max, cb, token) {
    let collected = scraper().length;
    cb && cb(collected);
    if (collected >= max) return;
    const isItemPage = /\/item\?id=\d+/.test(location.pathname + location.search);
    if (!isItemPage) return;
    for (let page = 2; page <= 30; page++) {
      if (token?.aborted) return;
      if (collected >= max) break;
      const moreHref = document.querySelector('a.morelink')?.getAttribute('href');
      if (!moreHref) break;
      let html;
      try { html = await fetchHNPage('https://news.ycombinator.com/' + moreHref); }
      catch (e) { console.warn('[AI总结] HN 翻页失败:', e); break; }
      if (token?.aborted) return;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const tables = doc.querySelectorAll('table');
      for (const t of tables) {
        const clone = document.importNode(t, true);
        const target = document.querySelector('table.comment-tree') || document.body;
        target.appendChild(clone);
      }
      const newMore = doc.querySelector('a.morelink')?.getAttribute('href');
      const curMore = document.querySelector('a.morelink');
      if (curMore && newMore) curMore.setAttribute('href', newMore);
      else if (curMore && !newMore) curMore.remove();
      collected = scraper().length;
      cb && cb(collected);
      if (collected >= max) break;
      await sleep(150);
    }
  }

  async function autoLoadZHAnswers(scraper, max, cb, token) {
    let last = 0, stable = 0;
    for (let i = 0; i < 30; i++) {
      if (token?.aborted) return;
      document.querySelectorAll('button').forEach(b => {
        if (/展开全文|显示全部|展开/.test(b.innerText)) b.click();
      });
      const items = scraper();
      if (items.length >= max) break;
      if (items.length === last) { stable++; if (stable >= 3) break; }
      else stable = 0;
      last = items.length;
      cb && cb(items.length);
      const moreBtn = [...document.querySelectorAll('button')]
          .find(b => /更多回答|查看更多/.test(b.innerText));
      if (moreBtn) {
        moreBtn.click();
      } else {
        window.scrollTo(0, document.body.scrollHeight);
      }
      await sleep(1500);
      if (token?.aborted) return;
    }
  }

  async function autoLoadLinuxdoComments(scraper, max, cb, token) {
    const m = location.pathname.match(/\/t\/(?:[^\/]+\/)?(\d+)/);
    if (!m) return;
    const topicId = m[1];
    try {
      const d1 = await fetch(`/t/${topicId}.json?page=1`, { credentials: 'include' }).then(r => r.json());
      if (token?.aborted) return;
      const totalPosts = d1.posts_count || d1.post_stream?.stream?.length || 0;
      const allPosts = [...(d1.post_stream?.posts || [])];
      cb && cb(allPosts.length);

      const totalPages = Math.ceil(totalPosts / 20);
      for (let page = 2; page <= totalPages; page++) {
        if (token?.aborted) return;
        if (allPosts.length >= max) break;
        try {
          const d = await fetch(`/t/${topicId}.json?page=${page}`, { credentials: 'include' }).then(r => r.json());
          if (token?.aborted) return;
          const posts = d.post_stream?.posts || [];
          if (!posts.length) break;
          allPosts.push(...posts);
          cb && cb(allPosts.length);
        } catch (e) { break; }
        await sleep(300);
      }

      const map = new Map(allPosts.map(p => [p.post_number, p]));
      function getDepth(p) {
        let d = 0, cur = p, visited = new Set();
        while (cur && cur.reply_to_post_number != null && !visited.has(cur.post_number)) {
          visited.add(cur.post_number);
          d++;
          cur = map.get(cur.reply_to_post_number);
          if (d > 20) break;
        }
        return d;
      }

      const comments = allPosts
        .filter(p => p.post_number !== 1)
        .map(p => {
          const tmp = document.createElement('div');
          safeHTML(tmp, p.cooked || '');
          return {
            author: p.username || '匿名',
            text: (tmp.innerText || '').trim(),
            likes: p.actions_summary?.find(a => a.id === 2)?.count || 0,
            postNumber: p.post_number,
            depth: getDepth(p),
            isOP: false
          };
        })
        .filter(c => c.text);

      window.__ai_linuxdo_comments = comments;
      cb && cb(comments.length);
    } catch (e) {
      console.warn('[AI总结] linux.do JSON API 失败，回退 DOM', e);
    }
  }

  function deriveModelsUrl(endpoint) {
    return endpoint.replace(/\/+$/, '') + '/v1/models';
  }

  async function fetchModels(endpoint, apiKey) {
    const url = deriveModelsUrl(endpoint);
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { 'Authorization': 'Bearer ' + (apiKey || '') },
        onload: (res) => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error('HTTP ' + res.status));
            return;
          }
          try {
            const d = JSON.parse(res.responseText);
            const list = (d.data || d.models || d || [])
              .map(m => (typeof m === 'string' ? m : (m.id || m.name || '')))
              .filter(s => s);
            resolve(list);
          } catch (e) {
            reject(new Error('解析失败: ' + e.message));
          }
        },
        onerror: () => reject(new Error('网络错误')),
        ontimeout: () => reject(new Error('请求超时'))
      });
    });
  }

  let _modelsCache = null;
  let _modelsCacheKey = '';

  function attachModelAutocomplete(input) {
    const wrap = input.parentElement;
    wrap.style.position = 'relative';
    const list = document.createElement('div');
    list.className = 'ai-model-dropdown';
    wrap.appendChild(list);

    const hide = () => { list.style.display = 'none'; };
    const render = (items, filter) => {
      const f = (filter || '').toLowerCase();
      const filtered = f ? items.filter(m => m.toLowerCase().includes(f)) : items;
      if (!filtered.length) { hide(); return; }
      safeHTML(list, filtered.map(m => `<div class="ai-model-item">${escapeHtml(m)}</div>`).join(''));
      list.style.display = 'block';
      list.querySelectorAll('.ai-model-item').forEach((item, i) => {
        item.onclick = () => { input.value = filtered[i]; hide(); input.focus(); };
      });
    };

    input.addEventListener('focus', async () => {
      const ep = document.querySelector('[data-k="apiEndpoint"]').value.trim();
      const ak = document.querySelector('[data-k="apiKey"]').value.trim();
      if (!ep) return;
      const key = ep + '|' + ak;
      if (key !== _modelsCacheKey) { _modelsCache = null; _modelsCacheKey = key; }
      if (_modelsCache) { render(_modelsCache, input.value); return; }
      safeHTML(list, '<div class="ai-model-loading">加载模型列表...</div>');
      list.style.display = 'block';
      try {
        _modelsCache = await fetchModels(ep, ak);
        render(_modelsCache, input.value);
      } catch (e) {
        safeHTML(list, '<div class="ai-model-error">获取失败：' + escapeHtml(e.message) + '（可手动输入）</div>');
      }
    });

    input.addEventListener('input', () => {
      if (_modelsCache) render(_modelsCache, input.value);
    });

    input.addEventListener('blur', () => setTimeout(hide, 200));
  }

  function createToken() {
    const t = { aborted: false, _cbs: [] };
    t.onAbort = (fn) => { if (t.aborted) { try { fn(); } catch {} } else t._cbs.push(fn); };
    t.abort = () => {
      if (t.aborted) return;
      t.aborted = true;
      const cbs = t._cbs; t._cbs = [];
      cbs.forEach(fn => { try { fn(); } catch {} });
    };
    return t;
  }
  function isAbortErr(e) { return e && e.__aborted === true; }
  function abortErr() { const e = new Error('已终止'); e.__aborted = true; return e; }

  function sendChat(systemMsg, userMsg, token) {
    if (!config.apiKey) return Promise.reject(new Error('请先在设置中填入 API Key'));
    return new Promise((resolve, reject) => {
      if (token && token.aborted) { reject(abortErr()); return; }
      const xhr = GM_xmlhttpRequest({
        method: 'POST',
        url: config.apiEndpoint.replace(/\/+$/, '') + '/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + config.apiKey
        },
        data: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemMsg },
            { role: 'user', content: userMsg }
          ],
          temperature: 0.5
        }),
        timeout: 120000,
        onload: (res) => {
          if (token && token.aborted) { reject(abortErr()); return; }
          if (res.status < 200 || res.status >= 300) {
            reject(new Error('HTTP ' + res.status + ': ' + res.responseText.slice(0, 300)));
            return;
          }
          let d;
          try { d = JSON.parse(res.responseText); }
          catch (e) {
            const raw = res.responseText.trim();
            if (raw.length > 0) {
              const m = raw.match(/"content"\s*:\s*"([^"]+)"/);
              if (m) { resolve(m[1]); return; }
              resolve(raw.slice(0, 2000));
              return;
            }
            reject(new Error('解析失败: ' + e.message));
            return;
          }
          const content = d.choices?.[0]?.message?.content
              || d.choices?.[0]?.text
              || d.content?.[0]?.text
              || d.message?.content
              || d.text
              || JSON.stringify(d);
          resolve(content);
        },
        onerror: (e) => {
          if (token && token.aborted) { reject(abortErr()); return; }
          reject(new Error('请求失败: ' + (e.error || e.statusText || '网络错误')));
        },
        ontimeout: () => {
          if (token && token.aborted) { reject(abortErr()); return; }
          reject(new Error('请求超时'));
        }
      });
      if (token && xhr && typeof xhr.abort === 'function') {
        token.onAbort(() => { try { xhr.abort(); } catch {} });
      }
    });
  }

  async function callAI(title, comments, opts = {}, token) {
    const useDepth = opts.platform === 'hackernews' || opts.platform === 'linuxdo';
    const text = comments.map((c, i) => {
      const head = (useDepth && c.depth)
          ? `${i + 1}. [${c.likes}赞 · 深度${c.depth}] ${c.author}: `
          : `${i + 1}. [${c.likes}赞] ${c.author}: `;
      return head + c.text;
    }).join('\n');
    const userMsg = `讨论主题（帖子标题）：${title || '（无）'}\n\n${config.customPrompt}\n\n评论内容：\n${text}`;
    const sysMsg = '你是一个专业的评论分析助手，严格按用户指定的 Markdown 结构输出。';
    return sendChat(sysMsg, userMsg, token);
  }

  async function callAIInsight(mainText, token) {
    const userMsg = `以下是针对某帖子评论的中立归纳报告：\n\n${mainText}\n\n请基于以上归纳，给出你的独立判断。`;
    return sendChat(INSIGHT_PROMPT, userMsg, token);
  }

  function splitInsight(raw) {
    const m = raw.match(/^#{2,3}\s*AI\s*独立判断/m);
    if (!m) return { main: raw, insight: '', confidence: '' };
    const idx = m.index;
    const main = raw.slice(0, idx).trim();
    const insight = raw.slice(idx).trim();
    const cm = insight.match(/信心[程度]*[：:]\s*(高|中|低)/);
    const confidence = cm ? cm[1] : '';
    return { main, insight, confidence };
  }

  function createUI() {
    const fab = Object.assign(document.createElement('button'), { id: 'ai-fab', textContent: '✨', title: 'AI 评论总结' });
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'ai-panel';
    safeHTML(panel, `
<div class="ai-hd">
<span class="ai-title">✨ AI 评论总结 <em id="ai-count">0</em></span>
<span class="ai-actions">
  <button id="ai-set" title="设置">⚙</button>
  <button id="ai-x" title="关闭">×</button>
</span>
</div>
<div class="ai-meta">
<span class="ai-topic" id="ai-topic">未开始</span>
</div>
<div class="ai-body status">点击「开始总结」按钮开始。</div>
<div class="ai-actions-row">
<button id="ai-run" class="ai-primary">✨ 开始总结</button>
<button id="ai-copy" class="ai-ghost">📋 复制</button>
</div>`);
    document.body.appendChild(panel);

    const set = document.createElement('div');
    set.id = 'ai-settings';
    safeHTML(set, `
<h3 style="margin-top:0">设置</h3>
<label>API Key</label><input type="password" data-k="apiKey" placeholder="sk-...">
<label>API Endpoint</label><input type="text" data-k="apiEndpoint" placeholder="http://localhost:8317（不含 /v1 路径）">
<div class="ai-row">
<div><label>模型</label><input type="text" data-k="model"></div>
<div><label>最大评论数</label><input type="number" data-k="maxComments" min="10" max="1000"></div>
</div>
<label>最小点赞数（过滤）</label><input type="number" data-k="minLikes" min="0">
<label>自定义 Prompt</label><textarea data-k="customPrompt"></textarea>
<div class="ai-footer">
<button class="ai-reset" data-act="reset">重置 Prompt</button>
<button class="ai-cancel" data-act="cancel">取消</button>
<button class="ai-save" data-act="save">保存</button>
</div>`);
    set.querySelectorAll('[data-k]').forEach(i => { i.value = config[i.dataset.k] ?? ''; });
    document.body.appendChild(set);
    attachModelAutocomplete(set.querySelector('[data-k="model"]'));

    fab.onclick = () => panel.classList.toggle('open');
    panel.querySelector('#ai-x').onclick = () => panel.classList.remove('open');
    panel.querySelector('#ai-set').onclick = () => {
      set.classList.add('open');
      set.querySelectorAll('[data-k]').forEach(i => { i.value = config[i.dataset.k] ?? ''; });
    };
    panel.querySelector('#ai-run').onclick = () => runSummary(panel);
    panel.querySelector('#ai-copy').onclick = () => {
      const src = panel.dataset.rawCopy || panel.dataset.raw || '';
      if (!src) return;
      navigator.clipboard.writeText(src).then(() => flash(panel.querySelector('#ai-copy'), '已复制 ✓'));
    };
    set.querySelector('[data-act="cancel"]').onclick = () => set.classList.remove('open');
    set.querySelector('[data-act="save"]').onclick = () => {
      set.querySelectorAll('[data-k]').forEach(i => {
        const k = i.dataset.k;
        config[k] = (i.type === 'number') ? parseInt(i.value, 10) : i.value;
      });
      saveConfig(config);
      set.classList.remove('open');
    };
    set.querySelector('[data-act="reset"]').onclick = () => {
      config.customPrompt = DEFAULT_CONFIG.customPrompt;
      set.querySelector('[data-k="customPrompt"]').value = DEFAULT_CONFIG.customPrompt;
    };
  }

  function flash(btn, txt) {
    const old = btn.textContent;
    btn.textContent = txt;
    btn.style.background = '#1B365D';
    btn.style.color = '#faf5ea';
    setTimeout(() => { btn.textContent = old; btn.style.background = ''; }, 1200);
  }

  function renderSkeleton(n) {
    return `<div class="ai-skeleton">
<div class="ai-bar w90"></div>
<div class="ai-bar w70"></div>
<div class="ai-bar w90"></div>
<div class="ai-bar w50"></div>
<div class="ai-bar w90"></div>
</div>
<div style="margin-top:12px;color:#8a7f70;font-size:12px;text-align:center;font-family:Georgia,'Songti SC',serif">已抓取 <b style="color:#1B365D">${n}</b> 条评论，正在请求 AI 分析...</div>`;
  }

  function getPageTitle(name) {
    if (name === 'hackernews') {
      const link = document.querySelector('.storylink, .titleline > a')
          || document.querySelector('.titleline');
      return (link?.textContent || document.title || '').trim();
    }
    if (name === 'linuxdo') {
      return (document.querySelector('.fancy-title, .topic-title, header h1')?.innerText
          || document.title.split(' - ')[0]
          || document.title || '').trim();
    }
    if (name === 'zhihu') {
      const t = document.querySelector('.QuestionHeader-title')?.innerText?.trim()
          || document.title.split(' - ')[0].trim()
          || document.title;
      return t;
    }
    return (document.querySelector('h1')?.innerText?.trim()
        || document.title.split('|')[0].split('-')[0].trim()
        || document.title);
  }

  async function runSummary(panel) {
    const body = panel.querySelector('.ai-body');
    const btn = panel.querySelector('#ai-run');
    const topic = panel.querySelector('#ai-topic');
    const cnt = panel.querySelector('#ai-count');
    const name = detectScraper();

    if (!name || !Scrapers[name]) {
      body.className = 'ai-body status';
      body.textContent = '当前网站暂不支持: ' + location.hostname;
      return;
    }

    const token = createToken();
    panel.__aiToken = token;
    const origText = btn.textContent;
    btn.disabled = false;
    btn.textContent = '⏹ 停止总结';
    btn.classList.add('ai-stopping');
    body.className = 'ai-body';
    safeHTML(body, renderSkeleton(0));

    const restoreBtn = () => {
      if (panel.__aiToken !== token) return;
      panel.__aiToken = null;
      btn.textContent = origText;
      btn.classList.remove('ai-stopping');
      btn.onclick = () => runSummary(panel);
    };
    const finishAbort = () => {
      restoreBtn();
      body.className = 'ai-body status';
      body.textContent = '已终止，可重新点击「开始总结」。';
      topic.textContent = '已终止';
    };
    btn.onclick = () => { token.abort(); finishAbort(); };

    try {
      const scraper = Scrapers[name];
      const title = getPageTitle(name);

      if (name === 'hackernews') {
        await autoLoadHNComments(scraper, config.maxComments, n => {
          safeHTML(body, renderSkeleton(n));
          cnt.textContent = n;
        }, token);
      } else if (name === 'zhihu') {
        await autoLoadZHAnswers(scraper, config.maxComments, n => {
          safeHTML(body, renderSkeleton(n));
          cnt.textContent = n;
        }, token);
      } else if (name === 'linuxdo') {
        delete window.__ai_linuxdo_comments;
        await autoLoadLinuxdoComments(scraper, config.maxComments, n => {
          safeHTML(body, renderSkeleton(n));
          cnt.textContent = n;
        }, token);
      } else if (name === 'xiaohongshu') {
        await autoLoadXHSComments(scraper, config.maxComments, n => {
          safeHTML(body, renderSkeleton(n));
          cnt.textContent = n;
        }, token);
      } else if (name === 'bilibili') {
        await autoLoadBiliComments(scraper, config.maxComments, n => {
          safeHTML(body, renderSkeleton(n));
          cnt.textContent = n;
        }, token);
      } else if (name === 'twitter') {
        delete window.__ai_twitter_comments;
        await autoLoadTwitterComments(scraper, config.maxComments, n => {
          safeHTML(body, renderSkeleton(n));
          cnt.textContent = n;
        }, token);
      } else {
        await autoLoadComments(scraper, config.maxComments, n => {
          safeHTML(body, renderSkeleton(n));
          cnt.textContent = n;
        }, token);
      }
      if (token.aborted) throw abortErr();

      let comments = scraper()
          .filter(c => c.likes >= (config.minLikes || 0));

      if (name === 'linuxdo') {
        comments = comments.filter(c => !c.isOP);
      }

      comments = comments
          .sort((a, b) => b.likes - a.likes)
          .slice(0, config.maxComments);

      if (!comments.length) {
        body.className = 'ai-body status';
        body.textContent = '未抓取到评论，请确认页面有评论且已加载。';
        return;
      }

      cnt.textContent = comments.length;
      topic.textContent = title;
      safeHTML(body, renderSkeleton(comments.length));

      const summary = await callAI(title, comments, { platform: name }, token);
      const { main } = splitInsight(summary);
      panel.dataset.raw = summary;

      const tMatch = main.match(/##\s*讨论主题\s*\n([\s\S]*?)(?=\n##|\n---|$)/);
      if (tMatch) {
        const t = tMatch[1].replace(/\*\*/g, '').replace(/\n+/g, ' ').trim();
        topic.textContent = t.slice(0, 80);
      }

      body.className = 'ai-body';
      safeHTML(body, md(main) +
        `<div class="ai-insight" id="ai-insight-loading">` +
        `<div class="ai-insight-tag">🤖 对抗性审视</div>` +
        `<div class="ai-insight-notice">正在生成对抗性审视...</div>` +
        `</div>`);

      let insight = '';
      let insightErr = null;
      try {
        await sleep(1000);
        const insightRaw = await callAIInsight(main, token);
        insight = insightRaw.trim();
      } catch (e) {
        if (isAbortErr(e)) throw e;
        insightErr = e.message;
        if (!token?.aborted) {
          try {
            await sleep(2000);
            const retryRaw = await callAIInsight(main, token);
            insight = retryRaw.trim();
            insightErr = null;
          } catch (e2) {
            if (isAbortErr(e2)) throw e2;
            insightErr = e2.message;
          }
        }
      }

      const insightBox = body.querySelector('#ai-insight-loading');
      if (insightBox) {
        if (insight) {
          safeHTML(insightBox,
            `<div class="ai-insight-tag">🤖 对抗性审视</div>` +
            `<div class="ai-insight-notice">以下是 AI 主动站到反方位置给出的审视——挑高赞、揭盲点、下判断。它不是中立总结的一部分。</div>` +
            md(insight));
        } else {
          safeHTML(insightBox,
            `<div class="ai-insight-tag">🤖 对抗性审视</div>` +
            `<div class="ai-insight-notice">对抗性审视生成失败：${insightErr || '未知错误'}。可重新点击「开始总结」重试。</div>`);
        }
        insightBox.removeAttribute('id');
      }

      if (insight) {
        const divider = '\n\n---\n\n> ⚠️ 以下为 AI 的对抗性审视——刻意找茬、刻意立论，仅供参考，非社区共识。引用时请注明来源为 AI 生成。\n\n';
        panel.dataset.rawCopy = main + divider + insight;
      } else {
        panel.dataset.rawCopy = main;
      }
    } catch (e) {
      if (panel.__aiToken !== token) {
        // 已被新 run 接管，静默退出
      } else if (!isAbortErr(e)) {
        body.className = 'ai-body status';
        body.textContent = '出错: ' + e.message;
      }
    } finally {
      restoreBtn();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createUI);
  } else {
    createUI();
  }
})();