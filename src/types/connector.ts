/**
 * Interface for warehouse connectors.
 * v1 implements BigQuery only; interface supports future Snowflake/Postgres.
 */

export interface ColumnSchema {
  name: string;
  type: string;
  description?: string;
}

export interface ViewSchema {
  dataset: string;
  name: string;
  columns: ColumnSchema[];
}

export interface ViewListEntry {
  name: string;
  dataset: string;
  type: string; // 'VIEW' or 'BASE TABLE'
  column_count: number;
}

export interface WarehouseConnector {
  getViewSchema(dataset: string, view: string): Promise<ViewSchema>;
  listViews(dataset: string): Promise<ViewListEntry[]>;
  getColumnDescriptions(dataset: string, view: string): Promise<Map<string, string>>;
}
