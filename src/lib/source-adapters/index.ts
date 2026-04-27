import type { InventorySourceAdapter } from "@/lib/source-adapters/types";
import { woosterCjdrAdapter } from "@/lib/source-adapters/wooster-cjdr";

const adapters = new Map<string, InventorySourceAdapter>([
  [woosterCjdrAdapter.key, woosterCjdrAdapter],
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
