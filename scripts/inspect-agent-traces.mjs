import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "fixtures/external/naturebench");
const outputDir = path.resolve(process.argv[3] ?? path.join(root, "inventory"));

const selectedValueKeys = new Set([
  "type",
  "subtype",
  "event_type",
  "eventType",
  "role",
  "name",
  "tool_name",
  "toolName",
  "tool",
  "status",
  "model",
  "session_id",
  "sessionId",
  "cwd",
  "exit_code",
  "exitCode",
  "is_error",
  "isError",
  "duration_ms",
  "durationMs",
  "timestamp",
  "uuid",
  "id",
  "parent_tool_use_id",
  "parentToolUseId",
  "tool_use_id",
  "toolUseId",
]);

const interestingValueKeys = new Set([
  "type",
  "subtype",
  "event_type",
  "eventType",
  "role",
  "name",
  "tool_name",
  "toolName",
  "tool",
  "status",
  "model",
  "session_id",
  "sessionId",
  "cwd",
  "exit_code",
  "exitCode",
  "is_error",
  "isError",
  "duration_ms",
  "durationMs",
  "parent_tool_use_id",
  "parentToolUseId",
  "tool_use_id",
  "toolUseId",
]);

function increment(map, key, amount = 1) {
  map[key] = (map[key] ?? 0) + amount;
}

function shortValue(value) {
  if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  if (value === null || value === undefined) return String(value);
  return JSON.stringify(value);
}

function addSample(samples, key, value) {
  if (!samples[key]) samples[key] = [];
  const rendered = shortValue(value);
  if (!samples[key].includes(rendered) && samples[key].length < 12) samples[key].push(rendered);
}

function walkValue(value, currentPath, state, depth = 0) {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    increment(state.fieldPaths, `${currentPath}[]`);
    if (depth < 4) {
      for (const item of value.slice(0, 40)) walkValue(item, `${currentPath}[]`, state, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = currentPath ? `${currentPath}.${key}` : key;
    increment(state.fieldPaths, childPath);

    if (selectedValueKeys.has(key) && (typeof child !== "object" || child === null)) {
      increment(state.selectedFieldCounts, childPath);
      if (interestingValueKeys.has(key)) addSample(state.selectedFieldSamples, childPath, child);
    }

    if (key === "type" || key === "subtype" || key === "event_type" || key === "eventType") {
      if (typeof child === "string") increment(state.typeValues, `${childPath}=${child}`);
    }

    if (["name", "tool_name", "toolName", "tool"].includes(key) && typeof child === "string") {
      increment(state.toolNames, child);
    }

    if (depth < 4) walkValue(child, childPath, state, depth + 1);
  }
}

function collectJsonlFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "inventory") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...collectJsonlFiles(fullPath));
    else if (entry.isFile() && entry.name === "transcript.jsonl") result.push(fullPath);
  }
  return result;
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sortEntries(record) {
  return Object.fromEntries(Object.entries(record).sort((a, b) => b[1] - a[1]));
}

function markdownTable(rows, headers) {
  const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const row of rows) lines.push(`| ${row.join(" | ")} |`);
  return lines.join("\n");
}

const files = collectJsonlFiles(root);
const fileReports = [];
const aggregate = {
  recordCount: 0,
  invalidLineCount: 0,
  typeValues: {},
  toolNames: {},
  topLevelKeys: {},
  fieldPaths: {},
  selectedFieldCounts: {},
  selectedFieldSamples: {},
};

for (const filePath of files) {
  const relativePath = path.relative(root, filePath).replaceAll(path.sep, "/");
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const state = {
    typeValues: {},
    toolNames: {},
    topLevelKeys: {},
    fieldPaths: {},
    selectedFieldCounts: {},
    selectedFieldSamples: {},
  };
  let invalidLineCount = 0;
  let firstInvalidLine;

  for (let index = 0; index < lines.length; index += 1) {
    let record;
    try {
      record = JSON.parse(lines[index]);
    } catch {
      invalidLineCount += 1;
      firstInvalidLine ??= index + 1;
      continue;
    }

    if (record && typeof record === "object" && !Array.isArray(record)) {
      for (const key of Object.keys(record)) increment(state.topLevelKeys, key);
      walkValue(record, "", state);
    }
  }

  for (const key of Object.keys(aggregate)) {
    if (key === "recordCount" || key === "invalidLineCount" || key === "selectedFieldSamples") continue;
    const target = aggregate[key];
    const source = state[key];
    if (source && typeof source === "object") {
      for (const [entry, count] of Object.entries(source)) increment(target, entry, count);
    }
  }

  aggregate.recordCount += lines.length - invalidLineCount;
  aggregate.invalidLineCount += invalidLineCount;
  for (const [key, values] of Object.entries(state.selectedFieldSamples)) {
    for (const value of values) addSample(aggregate.selectedFieldSamples, key, value);
  }

  fileReports.push({
    path: relativePath,
    bytes: fs.statSync(filePath).size,
    sha256: hashFile(filePath),
    lineCount: lines.length,
    recordCount: lines.length - invalidLineCount,
    invalidLineCount,
    firstInvalidLine: firstInvalidLine ?? null,
    topLevelKeys: sortEntries(state.topLevelKeys),
    fieldPaths: sortEntries(state.fieldPaths),
    typeValues: sortEntries(state.typeValues),
    toolNames: sortEntries(state.toolNames),
    selectedFieldSamples: state.selectedFieldSamples,
  });
}

fs.mkdirSync(outputDir, { recursive: true });

const agentReports = {};
for (const file of fileReports) {
  const agent = file.path.split("/")[0];
  const current = (agentReports[agent] ??= {
    fileCount: 0,
    recordCount: 0,
    invalidLineCount: 0,
    typeValues: {},
    toolNames: {},
    topLevelKeys: {},
    fieldPaths: {},
    selectedFieldSamples: {},
  });
  current.fileCount += 1;
  current.recordCount += file.recordCount;
  current.invalidLineCount += file.invalidLineCount;
  for (const key of ["typeValues", "toolNames", "topLevelKeys", "fieldPaths"]) {
    for (const [entry, count] of Object.entries(file[key])) increment(current[key], entry, count);
  }
  for (const [key, values] of Object.entries(file.selectedFieldSamples)) {
    for (const value of values) addSample(current.selectedFieldSamples, key, value);
  }
}

for (const reportForAgent of Object.values(agentReports)) {
  for (const key of ["typeValues", "toolNames", "topLevelKeys", "fieldPaths"]) {
    reportForAgent[key] = sortEntries(reportForAgent[key]);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  sourceRoot: root,
  fileCount: files.length,
  files: fileReports,
  agents: agentReports,
  aggregate: {
    recordCount: aggregate.recordCount,
    invalidLineCount: aggregate.invalidLineCount,
    typeValues: sortEntries(aggregate.typeValues),
    toolNames: sortEntries(aggregate.toolNames),
    topLevelKeys: sortEntries(aggregate.topLevelKeys),
    fieldPaths: sortEntries(aggregate.fieldPaths),
    selectedFieldCounts: sortEntries(aggregate.selectedFieldCounts),
    selectedFieldSamples: aggregate.selectedFieldSamples,
  },
};

fs.writeFileSync(path.join(outputDir, "inventory.json"), `${JSON.stringify(report, null, 2)}\n`);

const fileRows = fileReports.map((file) => [
  `\`${file.path}\``,
  String(file.recordCount),
  String(file.invalidLineCount),
  String(file.bytes),
  `\`${file.sha256.slice(0, 16)}…\``,
]);
const typeRows = Object.entries(report.aggregate.typeValues).slice(0, 100).map(([key, count]) => [`\`${key}\``, String(count)]);
const toolRows = Object.entries(report.aggregate.toolNames).slice(0, 100).map(([key, count]) => [`\`${key}\``, String(count)]);
const fieldRows = Object.entries(report.aggregate.fieldPaths).slice(0, 160).map(([key, count]) => [`\`${key}\``, String(count)]);
const selectedRows = Object.entries(report.aggregate.selectedFieldSamples).map(([key, values]) => [`\`${key}\``, values.map((value) => `\`${value.replaceAll("`", "'")}\``).join("<br>")]);

const agentSections = Object.entries(report.agents).flatMap(([agent, agentReport]) => [
  `### ${agent}`,
  "",
  `样本文件数：${agentReport.fileCount}；有效记录数：${agentReport.recordCount}；非法行数：${agentReport.invalidLineCount}`,
  "",
  "类型字段：",
  "",
  markdownTable(Object.entries(agentReport.typeValues).slice(0, 80).map(([key, count]) => [`\`${key}\``, String(count)]), ["字段路径=值", "次数"]),
  "",
  "工具名称：",
  "",
  markdownTable(Object.entries(agentReport.toolNames).slice(0, 80).map(([key, count]) => [`\`${key}\``, String(count)]), ["名称", "次数"]),
  "",
  "主要字段路径：",
  "",
  markdownTable(Object.entries(agentReport.fieldPaths).slice(0, 100).map(([key, count]) => [`\`${key}\``, String(count)]), ["字段路径", "出现次数"]),
  "",
]);

const markdown = [
  "# Phase A 原始会话格式盘点",
  "",
  `生成时间：${report.generatedAt}`,
  `样本文件数：${report.fileCount}；有效记录数：${report.aggregate.recordCount}；非法行数：${report.aggregate.invalidLineCount}`,
  "",
  "> 这是一份结构盘点，不是统一协议。字段值只展示少量短样本，完整提示词、命令输出和工具结果仍保留在原始文件中。",
  "",
  "## 文件清单",
  "",
  markdownTable(fileRows, ["文件", "记录数", "非法行", "字节数", "SHA-256 前缀"]),
  "",
  "## 类型字段统计",
  "",
  markdownTable(typeRows, ["字段路径=值", "次数"]),
  "",
  "## 工具名称统计",
  "",
  markdownTable(toolRows, ["名称", "次数"]),
  "",
  "## 主要字段路径",
  "",
  markdownTable(fieldRows, ["字段路径", "出现次数"]),
  "",
  "## 关键字段短样本",
  "",
  markdownTable(selectedRows, ["字段路径", "样本值"]),
  "",
  "## 按 Agent 分组",
  "",
  ...agentSections,
  "## 下一步解释",
  "",
  "- 类型统计用于确定 Parser 的输入分支，不直接等同于统一 Event 类型。",
  "- 工具调用与工具结果是否能配对，需要结合各家的标识字段继续检查。",
  "- 字段是否能进入 Schema v1，还要区分 direct（原始提供）、derived（Adapter 推导）和 unavailable（无法可靠获得）。",
].join("\n");

fs.writeFileSync(path.join(outputDir, "event-catalog.md"), `${markdown}\n`);

console.log(`Inspected ${files.length} transcript files.`);
console.log(`Reports: ${path.join(outputDir, "inventory.json")}`);
console.log(`         ${path.join(outputDir, "event-catalog.md")}`);
