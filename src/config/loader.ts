import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { SchemaConfig } from "../types/config.js";
import { validateConfig } from "./validator.js";

function isUrl(path: string): boolean {
  return path.startsWith("http://") || path.startsWith("https://");
}

async function readConfigSource(configPath: string): Promise<string> {
  if (isUrl(configPath)) {
    const response = await fetch(configPath);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch config from ${configPath}: ${response.status} ${response.statusText}`
      );
    }
    return await response.text();
  }

  try {
    return readFileSync(configPath, "utf-8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read config file at ${configPath}: ${message}`);
  }
}

export async function loadConfig(configPath: string): Promise<SchemaConfig> {
  const content = await readConfigSource(configPath);

  let raw: unknown;
  try {
    raw = parse(content);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse YAML in ${configPath}: ${message}`);
  }

  const { config } = validateConfig(raw);
  return config;
}
