import type { SchemaConfig } from "../types/config.js";
import type { WarehouseConnector } from "../types/connector.js";
import type { ViewListResult, ViewListItem } from "../types/responses.js";

export async function listViews(
  connector: WarehouseConnector,
  config: SchemaConfig,
  dataset?: string,
  search?: string,
): Promise<ViewListResult> {
  const datasetsToQuery = dataset ? [dataset] : config.connection.datasets;
  const viewsConfig = config.views ?? {};

  const allViews: ViewListItem[] = [];

  for (const ds of datasetsToQuery) {
    const liveViews = await connector.listViews(ds);
    for (const lv of liveViews) {
      allViews.push({
        name: lv.name,
        dataset: lv.dataset,
        type: lv.type,
        annotated: viewsConfig[lv.name] !== undefined,
        column_count: lv.column_count,
      });
    }
  }

  // Apply search filter
  let filtered = allViews;
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = allViews.filter((v) => v.name.toLowerCase().includes(searchLower));
  }

  // Sort: annotated first, then alphabetical
  filtered.sort((a, b) => {
    if (a.annotated !== b.annotated) return a.annotated ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    views: filtered,
    total: filtered.length,
    annotated: filtered.filter((v) => v.annotated).length,
  };
}
