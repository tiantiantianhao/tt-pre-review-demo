# TT素材预审 Demo

用于业务试用 TT 素材预审流程的轻量 Demo。

## 在线预览

GitHub Pages:

https://tiantiantianhao.github.io/tt-pre-review-demo/

线上预览为静态 Mock 模式，可体验：

- 本地批量选择素材
- 单选广告账户
- 按素材名称首字段识别地区
- 提交预审、查询结果、重新提交
- 查看素材预览

说明：GitHub Pages 不能运行 Node 服务端代理，因此线上预览不会调用真实 TikTok API，也不会保存真实 Token。

## 本地真实 API 模式

```bash
npm start
```

访问：

```text
http://127.0.0.1:8787/
```

页面右上角点击 `配置 API`，填写：

- TikTok Access Token
- 广告账户 ID
- 账户名称，可选

也可以通过环境变量启动：

```bash
TIKTOK_ACCESS_TOKEN=replace_with_your_access_token
TIKTOK_ADVERTISER_ID=replace_with_your_advertiser_id
TIKTOK_ADVERTISER_NAME=optional_display_name
npm start
```

## 注意

- Creative Pre-review API 是 TikTok 白名单能力，未开白会返回提交失败。
- Token 只在本地运行时使用，不要提交到 GitHub。
- 本地数据保存在 `.data/`，已加入 `.gitignore`。
