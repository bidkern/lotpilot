import type { SourceDetectionStrategy, VehicleCondition } from "@prisma/client";

export type ScrapedVehicleRecord = {
  bodyStyle: string | null;
  condition: VehicleCondition;
  description: string | null;
  drivetrain: string | null;
  engine: string | null;
  exteriorColor: string | null;
  fuelType: string | null;
  imageUrls: string[];
  inventoryListedAt: string | null;
  interiorColor: string | null;
  listingPosition: number | null;
  make: string | null;
  mileage: number | null;
  model: string | null;
  price: number | null;
  rawPayload: Record<string, unknown>;
  sourceUrl: string;
  sourceVehicleKey: string;
  stockNumber: string | null;
  title: string;
  transmission: string | null;
  trim: string | null;
  vin: string | null;
  year: number | null;
};

export type ScrapeInventoryResult = {
  pageCount: number;
  totalFound: number;
  vehicles: ScrapedVehicleRecord[];
};

export type ScrapePreviewResult = {
  pageCount: number | null;
  totalFound: number | null;
  vehicles: ScrapedVehicleRecord[];
};

export type AdapterDetectionResult = {
  confidence: number;
  detectionStrategy: SourceDetectionStrategy;
  inventoryUrl: string | null;
  matched: boolean;
  notes: string | null;
};

export type InventorySourceAdapterContext = {
  baseUrl: string;
  inventoryUrl?: string | null;
  slug: string;
};

export interface InventorySourceAdapter {
  key: string;
  label: string;
  detect(input: { baseUrl: string; html: string }): AdapterDetectionResult;
  scrapeInventory(context: InventorySourceAdapterContext): Promise<ScrapeInventoryResult>;
  scrapePreview(
    context: InventorySourceAdapterContext,
    limit: number,
  ): Promise<ScrapePreviewResult>;
  refreshVehicles?(
    context: InventorySourceAdapterContext,
    urls: string[],
  ): Promise<ScrapedVehicleRecord[]>;
}
