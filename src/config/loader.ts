import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { SchemaConfig } from "../types/config.js";
import { validateConfig } from "./validator.js";

export function loadConfig(filePath: string): SchemaConfig {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read config file at ${filePath}: ${message}`);
  }

  let raw: unknown;
  try {
    raw = parse(content);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse YAML in ${filePath}: ${message}`);
  }

  const { config } = validateConfig(raw);
  return config;
}
