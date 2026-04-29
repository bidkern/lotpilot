import type { InventorySourceAdapter } from "@/lib/source-adapters/types";
import { dealeronSearchAllAdapter } from "@/lib/source-adapters/dealeron-searchall";

const adapters = new Map<string, InventorySourceAdapter>([
  [dealeronSearchAllAdapter.key, dealeronSearchAllAdapter],
]);

export function getSourceAdapter(adapterKey: string) {
  const adapter = adapters.get(adapterKey);

  if (!adapter) {
    throw new Error(`Unsupported source adapter: ${adapterKey}`);
  }

  return adapter;
}

export function listSourceAdapters() {
  return Array.from(adapters.values());
}
