import { BigQuery } from "@google-cloud/bigquery";
import type { WarehouseConnector, ViewSchema, ViewListEntry } from "../types/connector.js";

export class BigQueryConnector implements WarehouseConnector {
  private client: BigQuery;
  private projectId: string;

  constructor(projectId: string, keyFilePath?: string) {
    this.projectId = projectId;
    this.client = new BigQuery({
      projectId,
      ...(keyFilePath ? { keyFilename: keyFilePath } : {}),
    });
  }

  async getViewSchema(dataset: string, view: string): Promise<ViewSchema> {
    const query = `
      SELECT column_name, data_type, description
      FROM \`${this.projectId}.${dataset}.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS\`
      WHERE table_name = @viewName
      ORDER BY column_name
    `;

    try {
      const [rows] = await this.client.query({
        query,
        params: { viewName: view },
      });

      const columns = (rows as Array<{ column_name: string; data_type: string; description: string | null }>).map(
        (row) => ({
          name: row.column_name,
          type: row.data_type,
          ...(row.description ? { description: row.description } : {}),
        })
      );

      return { dataset, name: view, columns };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to get schema for ${dataset}.${view}: ${message}`);
    }
  }

  async listViews(dataset: string): Promise<ViewListEntry[]> {
    const query = `
      SELECT t.table_name, t.table_type, COUNT(c.column_name) as column_count
      FROM \`${this.projectId}.${dataset}.INFORMATION_SCHEMA.TABLES\` t
      LEFT JOIN \`${this.projectId}.${dataset}.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS\` c
        ON t.table_name = c.table_name
      GROUP BY t.table_name, t.table_type
      ORDER BY t.table_name
    `;

    try {
      const [rows] = await this.client.query({ query });

      return (rows as Array<{ table_name: string; table_type: string; column_count: number }>).map(
        (row) => ({
          name: row.table_name,
          dataset,
          type: row.table_type,
          column_count: Number(row.column_count),
        })
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to list views for ${dataset}: ${message}`);
    }
  }

  async getColumnDescriptions(dataset: string, view: string): Promise<Map<string, string>> {
    const query = `
      SELECT column_name, description
      FROM \`${this.projectId}.${dataset}.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS\`
      WHERE table_name = @viewName AND description IS NOT NULL AND description != ''
    `;

    try {
      const [rows] = await this.client.query({
        query,
        params: { viewName: view },
      });

      const descriptions = new Map<string, string>();
      for (const row of rows as Array<{ column_name: string; description: string }>) {
        descriptions.set(row.column_name, row.description);
      }
      return descriptions;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to get column descriptions for ${dataset}.${view}: ${message}`);
    }
  }
}
