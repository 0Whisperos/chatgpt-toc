# ChatGPT 对话目录

一个本地 Chrome 扩展，为 ChatGPT 网页添加右侧提问目录。默认显示短横线，悬停展开摘要；点击提问跳转，随阅读位置高亮。支持长目录虚拟渲染、深浅主题、键盘导航、历史扫描和会话切换。

## 安装

1. 解压 `chatgpt-toc-navigator.zip`，找到其中的 `dist` 文件夹。直接使用项目时，使用项目根目录中的 `dist`。
2. 在 Chrome 地址栏打开 `chrome://extensions`。
3. 开启右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择 **包含 manifest.json 的 dist 文件夹**。
5. 刷新已经打开的 ChatGPT 页面，或者打开一个已有会话。扩展仅在 `https://chatgpt.com/` 生效。

请保留安装文件夹。更新代码后重新运行构建，在扩展管理页点击扩展的刷新按钮，再刷新 ChatGPT 页面。

## 使用

- **查看目录**：将鼠标移到网页右侧短横线区域；每行只显示提问摘要，悬停可查看更多文字。
- **跳转**：点击提问或短横线。未渲染的历史消息需要滚动加载，期间可点“取消”；主动滚轮、触摸滚动或翻页键也会取消定位。
- **折叠**：点击目录右上角的 ×。再次点击右侧 ≡ 可展开。折叠偏好保存在本地。
- **键盘操作**：聚焦 ≡ 后按 Enter 打开目录，在提问列表中用上下方向键、Home、End 选择，Enter 跳转，Escape 折叠。
- **窄窗口**：为减少遮挡，宽度不超过 760px 时仅点击 ≡ 展开，不会悬停展开。
- **补全目录**：显示“目录尚未完整加载”时，可点“加载完整目录”。扫描会暂时滚动页面，结束后尽量恢复原阅读位置。主动滚动取消时尊重你的当前位置。

## 完整性与兼容范围

扩展在文档开始时被动监听当前会话的同源 JSON 响应，识别 `/backend-api/conversation/{id}`（包括 `/backend-api/f/conversation/{id}`）中的 `mapping` / `current_node` 结构，只提取当前分支。也支持响应外层 `conversation` 或 `data` 包装。不会额外请求这些接口。

如果 ChatGPT 更换接口、只发送部分历史、使用不同数据结构或扩展错过首次加载，目录会退回读取页面 DOM。此时请先刷新页面；仍不完整则使用历史扫描。尚未验证的新数据结构不会被猜测为完整。

DOM 兼容新版 `data-user-message-bubble` / `data-chatgpt-search-message-ids` 与旧版 `data-message-author-role` / `data-message-id`，仅扫描当前可见会话。目录按消息 ID 去重，所以相同文字的多次提问仍是独立条目。

历史扫描在稳定到达顶部、底部并发现明确起点标识后才标记完整。新版 `fallback-turn-0` 可能是局部索引，**不会单独作为完整历史的证明**。无法证明完整性时，即使已扫描全部可见历史，仍保留“未完整”标记。

跳转最多运行 60 秒；页面尚未加载目标、消息已被编辑替换或 DOM 标识发生变化时，会明确提示失败并允许重试。只用无消息 ID 的旧页面回退节点，无法保证虚拟化卸载后的重定位。扫描在等待中取消或超时时保留已收集目录。

首版支持普通 `/c/{id}` 及项目中的会话路径；新会话先从页面提问建立临时目录。没有提问的首页隐藏目录。不覆盖其他聊天网站、共享只读页面或桌面客户端。

## 隐私与权限

- 仅匹配 `https://chatgpt.com/*`，使用 Manifest V3。
- 唯一额外权限为 `storage`，只保存目录折叠偏好。
- 不读取登录凭据，不新增网络请求，不上传、同步或持久化保存聊天内容。
- 当前会话索引保存在内存中，切换会话后释放。
- 目录内容以纯文本写入；网页传入的索引在隔离脚本中再次校验。

## 开发

需要 Node.js 20.19+ 或 22.12+。

```powershell
npm install
npm run build
npm test
npm run test:e2e
npm run test:extension
npm run package
```

构建输出在 `dist/`，ZIP 为根目录的 `chatgpt-toc-navigator.zip`。Playwright 已包含在开发依赖中；浏览器测试默认使用 Windows 标准安装位置的 Chrome，否则使用 Playwright Chromium（可先执行 `npx playwright install chromium`）。可设置 `TOC_CHROME_PATH` 指向其他浏览器可执行文件，或用 `TOC_PLAYWRIGHT_PATH` 覆盖 Playwright 模块路径。

`test:extension` 在一次性 Chrome 配置中，通过 Chrome 的扩展调试接口加载真实 MV3 扩展，验证主环境与隔离环境通信和本地偏好保存。测试浏览器独立于你的正常 Chrome 个人资料，网页响应全部由本地测试数据提供。

源码分为：页面数据桥接、分支解析与索引、DOM 适配、目录界面、导航与扫描。自动化浏览器测试使用本地测试会话，不会编辑真实 ChatGPT 聊天。
