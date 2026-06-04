# open-boss

**高质量半自动求职流水线** — 批量搜索 · 机器+LLM 筛坑 · 定制开场白，帮个人高效避坑投递

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

> 🎯 **这是什么 / 不是什么**
> 这是给**个人求职者**用的半自动流水线：机器做机械活、LLM 帮你筛坑和写定制开场白、**最终由你审批并手动确认发送**。
> 它**不是全自动群发器**——不追求海投数量，而是帮你少踩培训贷/伪装销售/产线工的坑、把有限的打招呼次数花在真正匹配的高质量岗位上。仅供个人学习与求职研究。

> ⚠️ **免责声明**  
> 本工具仅供个人学习和研究使用。使用自动化工具可能违反 BOSS 直聘《用户服务协议》，可能导致账号封禁或 IP 限制。请控制使用频率，自行承担账号风险。作者不为任何因使用本工具造成的损失承担责任。

---

## 为什么是三段流水线，而不是全自动？

大多数 BOSS 直聘自动化工具的问题：**培训贷、刷单、保险增员会把自己包装成"内容运营""行政助理"**，纯规则过滤通不了，全自动投递则会发到一堆坑岗，还可能因为 AI 感强的模板被撤回。

本项目的设计哲学：**机器做机械活，LLM 做判断，人类负责最终审批。**

```
Phase 1   harvest.js   批量搜索 + 机器初筛（filters.js 剔猎头/不活跃HR/金融伪装销售），结构化落盘
             ↓
          [你 + LLM]   初筛：读列表字段挑出短名单（20个以内）
             ↓
Phase 1.5 enrich.js   只对短名单慢速读 JD（默认打开详情页读 DOM；自动标出 JD 里的坑）
             ↓
          [你 + LLM]   终筛 + 逐条写定制开场白（核心价值）
             ↓
Phase 3   send.js      greet + 发定制开场白（默认 dry-run，有校验）
```

机器先用 `filters.js` 把猎头/不活跃 HR/金融伪装销售/培训贷等明显坑剔掉（0 token），LLM 只看通过机器初筛的少量岗。中间两个 `[LLM]` 步骤是核心，判断机器拦不住的灰色岗，以及写出不像 AI 写的开场白——**这是无法自动化的部分**。

---

## 与竞品的核心区别

| 维度 | 本项目 | 全自动工具（如 boss_batch_push） |
|---|---|---|
| 筛选质量 | LLM 读 JD 全文，剔除灰色坑岗 | 规则过滤，培训贷/保险增员容易漏过 |
| 开场白 | 逐岗定制，LLM 翻译真实经历 | 模板群发，HR 一眼识别，回复率低 |
| 安全性 | 慢速 + dry-run + 头部校验 | 批量快速，封号风险高 |
| 适用人群 | 重视质量、愿意花时间做判断的求职者 | 追求数量、快速广撒网 |

---

## 前置条件

- **Node.js ≥ 18**（`node --version` 确认）
- **Google Chrome**（本机已安装）
- **BOSS 直聘账号**（已登录，且有打招呼次数）

---

## 安装

```bash
git clone https://github.com/yinren112/open-boss.git
cd open-boss
npm install

# 生成本机配置，按需修改城市和关键词
npm run init
```

打开 `config.json`，至少修改：
- `city`：你的目标城市代码（见 config.example.json 注释）
- `cityName`：城市名（仅用于日志显示）
- `keywords`：你的目标岗位关键词

---

## 第一步：启动带 CDP 的 Chrome

> 每次使用前需要先启动这个 Chrome，并在其中登录 BOSS 直聘。

**Windows：**
```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=19222 ^
  --user-data-dir="%USERPROFILE%\.open-boss\chrome-profile"
```

**macOS：**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=19222 \
  --user-data-dir="$HOME/.open-boss/chrome-profile"
```

**Linux：**
```bash
google-chrome \
  --remote-debugging-port=19222 \
  --user-data-dir="$HOME/.open-boss/chrome-profile"
```

Chrome 启动后，在浏览器里**手动打开并登录 BOSS 直聘**（`zhipin.com`）。登录态会保存在 chrome-profile 里，下次启动无需重新登录。

---

## 完整工作流

### Phase 1 — 批量搜索

```bash
node harvest.js
# 或者只搜特定关键词（覆盖 config.json）：
node harvest.js 数据标注 行政助理
```

产出 `data/candidates_latest.md`（人类可读）和 `data/candidates_latest.jsonl`（LLM 读）。

---

### Phase 2-A — LLM 初筛（你来做）

1. 打开 `data/candidates_latest.md`
2. 参考 [`prompts/01_initial_filter.md`](./prompts/01_initial_filter.md) 里的 Prompt 模板
3. 让 LLM 输出通过初筛的岗位（保留完整 JSON 对象）
4. 保存结果为 `data/shortlist.json`（数组格式）

---

### Phase 1.5 — 拉 JD 详情

```bash
node enrich.js                 # 默认：打开详情页读 DOM（更安全），间隔 30-60s
node enrich.js --fast-page     # 仍读 DOM，但节奏更紧凑（12-18s）
node enrich.js --limit=1       # 先小批量验证 1 条
node enrich.js --api           # 备用：走内部 detail API（更快但更容易触发风控）
```

> ⚠️ 这一步必须慢，绕不过去。默认走"打开详情页读 DOM"——更接近真人浏览。内部 `job/detail` 接口（`--api`）密集请求会触发频控冷却（code=36/37），连后续搜索也会被拦，所以只在确有需要时用，且间隔更长（45-75s）。

产出 `data/enriched_latest.md`（含 JD 全文，并自动标出 `filters.js` 命中的坑：培训贷/产线工/伪装销售/保险增员等，供 LLM 终筛重点审）。

---

### Phase 2-B — LLM 终筛 + 写开场白（你来做，是核心）

1. 打开 `data/enriched_latest.md`
2. 参考 [`prompts/02_final_filter_and_draft.md`](./prompts/02_final_filter_and_draft.md) 里的 Prompt 模板
3. 让 LLM：
   - 剔除培训贷/产线工/保险增员等坑岗（只有 JD 才会暴露）
   - 为通过的岗位逐条写定制开场白（50-100字，像真人随口说的）
4. 保存结果为 `data/approved.json`

---

### Phase 3 — 发送

```bash
# 先 dry-run：确认能选中对话、输入框能出现（不发消息）
node send.js

# 确认 ✅ 后，真实发送（保持 BOSS Chrome 窗口在屏幕前台）
node send.js --send

# 若会话已经打过招呼，只发开场白（跳过 greet）
node send.js --send --deliver-only
```

发送记录保存在 `data/send_log.jsonl`。

---

## 为什么必须这么慢？

BOSS 直聘的频控是真正的天花板，不是工具的问题：

| 操作 | 风险 | 建议间隔 |
|---|---|---|
| 搜索 `joblist` | 低 | 0.6-1.3s |
| 读 JD（默认·打开详情页读 DOM） | 中 | 30-60s |
| 读 JD（`--api` 内部 `job/detail`） | **高** | 45-75s |
| 发消息 / greet | 高 | 18-38s |

> 所有间隔都不是固定值，脚本用钟形分布（Bates）+ 偶发"犹豫"长尾来取随机延迟，避免均匀间隔本身成为可识别的时间签名。

遇到 `code=36/37`（"账户存在异常"）：**当天立即停止所有脚本操作**，改用浏览器正常手动使用 BOSS。**不要短时间内重跑脚本**——反复触发只会加重风控、延长冷却，甚至导致封号。等当天稍晚或次日、账号在浏览器里手动使用一切正常后再考虑继续。

---

## 常见问题排查

**`Error: Cannot find module 'ws'`**
→ 运行 `npm install`

**`未找到已打开的 zhipin.com 页面`**
→ 确认用带 `--remote-debugging-port=19222` 参数启动了 Chrome，且浏览器里已打开 BOSS 直聘页面

**`BOSS 探针 code=36/37`**
→ 触发频控。**当天停止脚本**，改用浏览器手动正常使用 BOSS，不要短时间重跑（反复触发会加重风控甚至封号）。账号恢复正常后再考虑继续

**`stage:verify 头部不匹配`**
→ 对话没选中。检查 `encryptBossId` 是否正确，以及该 HR 是否还有活跃会话

**`stage:composer 输入框未出现`**
→ 聊天框还没加载完，或 Chrome 窗口没在前台。请把 BOSS Chrome 窗口保持在屏幕前台后重试

**开场白被 HR 撤回（嫌 AI 感强）**
→ 见 `prompts/02_final_filter_and_draft.md` 的"开场白质量检查清单"，重写得更口语化

---

## 预期效果

| 阶段 | 耗时 |
|---|---|
| 搜索 100 个岗位 | ~1-2 分钟 |
| LLM 初筛到短名单 20 个 | 你的判断时间（连续无打断） |
| 拉 JD 详情（20 个） | ~15-25 分钟（必须慢） |
| LLM 终筛 + 写开场白 | 核心产出时间 |
| 发送 20 条 | ~10-15 分钟（自动，可靠） |

**总计约 40-60 分钟，产出 10-20 条高质量定制投递**，同时筛掉培训贷/销售伪装/产线工。

---

## 技术原理

本工具通过 **Chrome DevTools Protocol (CDP)** 直连已登录的 Chrome，借用页面的真实 Cookie 在页面内发起 `fetch` 请求，不依赖外部浏览器框架（Puppeteer / Playwright）。

关键实现细节：
- **搜索**：页面内 `fetch` BOSS API，不触发反爬检测；搜索层支持 `searchFilters`（经验/学历/商圈/活跃度）在服务端就过滤掉垃圾岗
- **机器初筛**：`filters.js` 两级过滤——`listFilter`（列表字段：猎头/不活跃 HR/金融伪装销售/提成信号）+ `jdTrap`（JD 正文：培训贷/产线工/形象门槛/保险增员，含 NFKC 归一化以匹配 BOSS 常用的 Unicode 兼容字）
- **读 JD**：默认打开详情页读 DOM（贴近真人浏览），内部接口仅 `--api` 备用
- **发消息**：新开标签页（避免旧标签的重定向问题）+ CDP `Input.insertText`（触发 Vue 可信事件）
- **反风控**：所有延迟走钟形分布 + 偶发犹豫长尾；干运行默认开启，发送前校验对话头部，遇风控立即停止

---

## 贡献

欢迎提 Issue 和 PR。提交前请确认：
- `data/` 目录下无真实个人数据
- `config.json` 未提交（已在 `.gitignore`）

---

## License

[MIT](./LICENSE)
