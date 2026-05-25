# TT素材预审 Demo

这是一个用于 TT 素材预审流程试用的本地 Node 应用。

## 快速启动

```bash
npm start
```

访问：

```text
http://127.0.0.1:8787/
```

## 配置方式

页面右上角点击 `配置 API`，填写：

- TikTok Access Token
- 广告账户 ID
- 账户名称，可选

配置只保存在当前服务进程内，不会写入代码或本地数据文件。也可以通过环境变量配置：

```bash
TIKTOK_ACCESS_TOKEN=replace_with_your_access_token
TIKTOK_ADVERTISER_ID=replace_with_your_advertiser_id
TIKTOK_ADVERTISER_NAME=optional_display_name
npm start
```

## 重要说明

- 本功能依赖 TikTok Creative Pre-review API 白名单。
- GitHub Pages 不能运行服务端代理，因此不能直接作为真实 API 环境。
- 不要把真实 Token 提交到 GitHub。
- `.data/` 用于保存本地上传素材和预审记录，已加入 `.gitignore`。
