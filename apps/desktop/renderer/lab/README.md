# Activity lab（列表行 + 检查器试验页）

对照 HTTP Toolkit UI 源码拆分后的试验：只复用第三方公开库，自研部分按工作台业务重写。

## 第三方 vs 自研（针对列表 / 检查器）

| 类别 | 内容 | 本试验怎么处理 |
|------|------|----------------|
| 第三方 | `react` / `react-dom`（MIT） | CDN 引入 |
| 第三方 | `styled-components`、`react-window`、图标库等 | 本页先不用；样式用自写 CSS |
| 第三方 | `mobx`（MIT） | 不用；本页用 React state |
| HTK 自研 | `ExchangeRow`、`event-row-components`、流量行布局 | 不拷贝；自写 `ActivityRow` |
| HTK 自研 | `CollapsibleCard`、`HeaderCard`、HTTP 详情窗格 | 不拷贝；自写 `DetailCard` / `Inspector` |
| HTK 自研 | `styles.ts` 主题对象、MobX stores、HTTP 模型 | 不拷贝；token 与步骤字段按工作台自定 |

打开方式：用浏览器直接打开 `activity-lab.html`（需能访问 esm.sh），或在本地起静态服务后访问该文件。
