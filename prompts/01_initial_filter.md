# Prompt 模板 01：Phase 2-A 初筛

> 此 Prompt 用于让 LLM（Claude / GPT / Gemini 等）对 `harvest.js` 产出的候选岗位做第一轮筛选。
> 输入：`data/candidates_latest.jsonl` 或 `candidates_latest.md`
> 输出：`data/shortlist.json`（通过初筛的完整对象数组，≤20 个）

---

## 使用方式

1. 打开 `data/candidates_latest.md`，复制全文内容
2. 将下方 Prompt 发送给 LLM，把内容粘贴进去
3. 让 LLM 输出 JSON 数组，保存为 `data/shortlist.json`

---

## Prompt 模板

```
你是一个求职筛选助手。我会给你一批 BOSS 直聘的岗位列表，请帮我做第一轮筛选。

## 我的基本情况
[在这里填写：学历/专业/毕业或工作年限/核心经历/目标城市/能接受的通勤距离]

示例（把方括号替换成你自己的真实情况）：
- 学历/经验：[如 本科，XX 专业，3 年工作经验 / 或 应届毕业]
- 核心经历：[如 办公室助理、资料归档、活动物料、Excel 数据核查]
- 目标城市：[你的城市]，通勤 [X] 小时内
- 期望薪资：[X-X]K

## 筛选规则（必须遵守）

### 直接剔除（任意一条命中即丢弃）：
- 明确销售性质：welfareList 含"底薪加提成"或岗位名/标签含"销售/电销/招商/地推/拉新/转化/签单/邀约"
- 经验门槛超出你的区间：jobExperience 要求高于你的实际年限
- 层级不符：你在找执行岗，却要求"经理/主管/资深"
- 高风险行业：保险、信贷、贷款、主播、直播带货

### 优先保留：
- jobExperience 落在你的经验区间内（如"经验不限"/"应届可"/对应你的年限）
- 工作性质与你的目标方向一致（如行政/文员/资料员/数据标注/内容执行类）
- 公司规模适当（避开 0 人超小公司 + 可疑行业的组合）

### 短名单要求：
- 输出通过初筛的岗位，最多 20 个
- 直接输出整条 JSON 对象（从输入里原样复制），不要只输出岗位名
- 格式：JSON 数组，可直接保存为 shortlist.json

## 岗位列表

[粘贴 candidates_latest.jsonl 或 candidates_latest.md 的内容]
```

---

## 注意事项

- 短名单控制在 **20 个以内**（`config.json` 的 `enrichMax` 默认值），超出部分 `enrich.js` 会截断
- LLM 应输出**完整对象**（包含 `encryptBossId`、`securityId`、`encryptJobId` 等字段），否则 `enrich.js` 无法处理
- 初筛阶段不需要 JD 详情，只看列表字段就够了，省去详情请求的风控风险
- 完成后运行：`node enrich.js`
