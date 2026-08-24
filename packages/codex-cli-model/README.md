# 结构化模型调用模块

这个包只负责一件事：通过 `Codex CLI`（Codex 命令行工具）发送提示词，并按给定的 `JSON Schema`（JSON 结构约束）取得结构化结果。它不依赖审查案例、证据包、数据库或桌面端，因此可以单独复制或发布给其他项目使用。

## 对外接口

调用方先创建一个模型实例，再调用一次 `invoke`（执行调用）：

```ts
import { createCodexCliStructuredModel } from '@agent-workbench/codex-cli-model';

const model = createCodexCliStructuredModel({
  artifactDirectory: '.model-runs',
  workingDirectory: process.cwd(),
  model: 'gpt-5.6-sol',
});

const result = await model.invoke({
  invocationId: 'run-001',
  prompt: '只返回符合结构约束的结果。',
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary'],
    properties: { summary: { type: 'string' } },
  },
});
```

模块内部会使用只读沙箱、临时会话和输出结构约束。每次调用都会保存请求、结构约束、最终模型输出以及可用的标准输出和错误输出，并记录文件哈希。

## 配置文件

可以使用以下配置作为模型调用的长期默认值。文件中只能保存模型选择、供应商地址和密钥环境变量名，不能保存密钥值：

```json
{
  "schemaVersion": "codex-cli-model-config-1",
  "model": "gpt-5.6-sol",
  "serviceTier": "fast"
}
```

## 第三方供应商

第三方供应商必须兼容 `Responses API`（响应接口）。密钥只通过环境变量名传入，配置和产物中不会写入密钥值：

```ts
const model = createCodexCliStructuredModel({
  artifactDirectory: '.model-runs',
  workingDirectory: process.cwd(),
  model: 'provider-model-name',
  provider: {
    id: 'company_gateway',
    name: 'Company gateway',
    baseUrl: 'https://gateway.example.com/v1',
    apiKeyEnv: 'COMPANY_GATEWAY_API_KEY',
  },
});
```

运行前需要由宿主环境设置 `COMPANY_GATEWAY_API_KEY`（公司模型网关密钥）。远程地址必须使用 `HTTPS`（安全超文本传输协议）；只有本机地址允许使用 `HTTP`（超文本传输协议）。

## 当前审查流程如何使用

审查模块中的适配器负责把系统提示词、审查案例和证据包拼成一个提示词，再调用本包。审查执行器随后校验模型输出、核对每条证据是否确实存在、生成审查记录并写入存储。

因此，其他项目只需要复用本包；只有同样需要“证据约束审查”时，才需要同时复用审查模块。
