# TT素材预审应用

## 启动

```powershell
& "C:\Users\YQ\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.mjs
```

访问：

```text
http://127.0.0.1:8787/
```

## 配置

页面右上角点击 `配置 API`，填写：

- TikTok Access Token
- 广告账户 ID
- 账户名称，可选

配置只保存在当前本地服务进程内，不写入前端文件或本地数据文件。服务重启后需要重新配置。

也可以通过环境变量启动：

```powershell
$env:TIKTOK_ACCESS_TOKEN="replace_with_your_access_token"
$env:TIKTOK_ADVERTISER_ID="replace_with_your_advertiser_id"
$env:TIKTOK_ADVERTISER_NAME="optional_display_name"
node server.mjs
```

## 使用流程

1. 打开应用并配置 API。
2. 点击 `+ 新建预审任务`。
3. 从本地批量选择视频或图片素材。
4. 系统从文件名首字段识别地区，例如 `AU-EN-TT-...` 识别为 `AU`。
5. 点击 `提交预审` 后，列表会立即出现 `提交中` 临时状态。
6. 后台上传素材到当前广告账户，获取 `video_id` 或 `image_id` 后创建预审任务。
7. 点击列表筛选区的 `查询` 可刷新有 `pre_review_task_id` 的处理中结果。

## 状态说明

- 当前未开通 TT 白名单时，创建预审任务会返回提交失败，此类记录没有 `pre_review_task_id`，无法通过查询刷新状态。
- 已创建成功的预审任务会调用 `/creative/pre_review/task/get/` 刷新状态。
- `APPROVED` 展示为通过；若超过 TT 返回的 `result_expiration_time`，自动展示为已过期。
- `REJECTED` 展示为拒绝，并展示拒绝原因/建议。
- `UNAVAILABLE` 展示为暂无结果，可后续继续查询。
- `UNSURE` 展示为不确定。

## 数据

- 明细数据：`.data/tt-pre-review-store.json`
- 本地素材目录：`.data/tt-materials.json`
- 上传文件缓存：`.data/uploads/`

`.data/` 已加入 `.gitignore`，不会提交到 GitHub。
