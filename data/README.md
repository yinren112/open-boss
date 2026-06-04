# data/ 目录说明

此目录存放运行时产生的数据文件。**所有数据文件已被 `.gitignore` 排除，不会提交到仓库。**

---

## 文件生命周期

```
node harvest.js
  → candidates_<时间戳>.jsonl    全量搜索结果（带时间戳备份）
  → candidates_latest.jsonl      最新搜索结果（Phase 2-A LLM 初筛读这个）
  → candidates_latest.md         Markdown 可读版

[你 + LLM 做初筛] → shortlist.json

node enrich.js
  → enriched_latest.jsonl        带 JD 详情（Phase 2-B LLM 终筛读这个）
  → enriched_latest.md           Markdown 可读版

[你 + LLM 做终筛 + 写开场白] → approved.json

node send.js
  → send_log.jsonl               发送记录（每条结果）
```

---

## 各文件字段说明

### candidates_latest.jsonl（每行一个 JSON）

| 字段 | 说明 |
|---|---|
| `encryptBossId` | HR 的加密 ID（发消息用） |
| `securityId` | 岗位安全 ID（打招呼用） |
| `encryptJobId` | 岗位加密 ID |
| `lid` | 来源标识 |
| `jobName` | 岗位名称 |
| `salaryDesc` | 薪资描述（如 "4-6K"） |
| `jobExperience` | 经验要求 |
| `jobDegree` | 学历要求 |
| `skills` | 技能标签数组 |
| `welfareList` | 福利标签（"底薪加提成" = 销售信号） |
| `brandName` | 公司名 |
| `brandScaleName` | 公司规模 |
| `brandStageName` | 融资阶段 |
| `brandIndustry` | 行业 |
| `areaDistrict` + `businessDistrict` | 区域 + 商圈（通勤判断） |
| `bossName` + `bossTitle` | HR 姓名和职位 |
| `query` | 命中的搜索关键词 |

### approved.json（数组）

每项必须包含（send.js 要用）：

```json
{
  "encryptBossId": "...",
  "securityId": "...",
  "encryptJobId": "...",
  "lid": "...",
  "jobName": "岗位名",
  "brandName": "公司名",
  "bossName": "HR姓名",
  "opening": "你写的定制开场白（50-100字）"
}
```

→ 参考 `approved.example.json` 了解格式（虚构数据，仅作示例）。

---

## 注意事项

- `data/` 目录可能包含真实岗位信息和个人开场白内容，**请勿提交到公开仓库**
- `send_log.jsonl` 包含发送记录，同样属于私人数据
- 如需备份，请自行在仓库之外保存
