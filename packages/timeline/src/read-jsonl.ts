import fs from 'node:fs';

export type JsonlRow = Record<string, unknown> & {
  parseError?: boolean;
  index?: number;
  raw?: string;
};

export function readJsonl(filePath: string): JsonlRow[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const text = fs.readFileSync(filePath, 'utf8').trim();
  if (!text) {
    return [];
  }
  return text.split(/\n+/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line) as JsonlRow;
    } catch {
      return { parseError: true, index, raw: line.slice(0, 200) };
    }
  });
}
