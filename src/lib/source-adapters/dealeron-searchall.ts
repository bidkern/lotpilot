import * as cheerio from "cheerio";
import { VehicleCondition } from "@prisma/client";
import type { AnyNode } from "domhandler";
import type { BrowserContext } from "playwright";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { withPlaywrightContext } from "@/lib/source-adapters/playwright-pool";
import type {
  InventorySourceAdapter,
  InventorySourceAdapterContext,
  ScrapeInventoryResult,
  ScrapePreviewResult,
  ScrapedVehicleRecord,
} from "@/lib/source-adapters/types";
import { sanitizeHttpUrl } from "@/lib/url";
import { extractVehiclePriceFromText, parseVehiclePrice } from "@/lib/vehicle-price";

type SearchListItem = {
  bodyStyle: string | null;
  condition: VehicleCondition;
  drivetrain: string | null;
  engine: string | null;
  exteriorColor: string | null;
  fuelType: string | null;
  imageUrl: string | null;
  inventoryListedAt: string | null;
  interiorColor: string | null;
  listingPosition: number;
  make: string | null;
  mileage: number | null;
  model: string | null;
  price: number | null;
  stockNumber: string | null;
  transmission: string | null;
  trim: string | null;
  title: string;
  url: string;
  vin: string | null;
  year: number | null;
};

const SEARCH_PAGE_CONCURRENCY = Math.max(2, Math.min(6, env.SCRAPER_DETAIL_CONCURRENCY));

function absoluteUrl(baseUrl: string, value: string | null | undefined) {
  return sanitizeHttpUrl(value, baseUrl);
}

function cleanText(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value.replace(/\s+/g, " ").trim() || null;
}

function cleanHtml(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const $ = cheerio.load(`<div>${value}</div>`);
  return cleanText($.text());
}

function parseInteger(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).replace(/[^\d-]/g, "");
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseInventoryListedAt(value: string | null | undefined) {
  const normalized = cleanText(value)?.replace(/\//g, "-") ?? null;
  if (!normalized) {
    return null;
  }

  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function parseVehicleCondition(input: {
  cpo?: string | null | undefined;
  fallback?: VehicleCondition | null | undefined;
  tagCondition?: string | null | undefined;
  vehicleType?: string | null | undefined;
}) {
  if (String(input.cpo).toLowerCase() === "true") {
    return VehicleCondition.CPO;
  }

  const normalizedCondition = cleanText(input.tagCondition)?.toUpperCase();
  if (normalizedCondition === VehicleCondition.NEW) {
    return VehicleCondition.NEW;
  }
  if (normalizedCondition === VehicleCondition.USED) {
    return VehicleCondition.USED;
  }
  if (normalizedCondition === VehicleCondition.CPO) {
    return VehicleCondition.CPO;
  }

  const normalizedType = cleanText(input.vehicleType)?.toUpperCase();
  if (normalizedType === "NEW") {
    return VehicleCondition.NEW;
  }
  if (normalizedType === "USED" || normalizedType === "PRE-OWNED") {
    return VehicleCondition.USED;
  }

  return input.fallback ?? VehicleCondition.UNKNOWN;
}

function parseJsonLd<T>(
  html: string,
  matcher: (value: unknown) => value is T,
) {
  const matches = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  );

  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1]);
      if (matcher(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function parseScriptById<T>(html: string, id: string) {
  const match = html.match(
    new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`),
  );

  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[1]) as T;
  } catch {
    return null;
  }
}

function extractSearchCardPrice($root: cheerio.Cheerio<AnyNode>) {
  const candidates = [
    $root.attr("data-price"),
    $root.find(".vehiclePricingHighlightAmount").first().text(),
    $root.find(".priceBlockItemFeaturedPrice .vehiclePricingHighlightAmount").first().text(),
    $root.find(".priceStakText--bold").last().next(".priceBlocItemPriceValue").text(),
    $root.find(".priceBlockItemPrice .priceBlocItemPriceValue").first().text(),
  ];

  for (const candidate of candidates) {
    const parsed = parseVehiclePrice(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return extractVehiclePriceFromText($root.text());
}

function parseSearchCard(
  baseUrl: string,
  $: cheerio.CheerioAPI,
  element: AnyNode,
  listingPosition: number,
): SearchListItem | null {
  const root = $(element);
  const titleLink = root.find(".vehicle-title").first();
  const detailLink =
    absoluteUrl(baseUrl, titleLink.attr("href")) ??
    absoluteUrl(baseUrl, root.find('a[href*="/new-"], a[href*="/used-"], a[href*="/inventory/"]').first().attr("href"));

  if (!detailLink) {
    return null;
  }

  const imageUrl =
    absoluteUrl(baseUrl, root.find(".hero-carousel__image, .hero-carousel__background-image, img").first().attr("src")) ??
    absoluteUrl(baseUrl, root.find("img").first().attr("src"));

  const title =
    cleanText(root.attr("data-name")) ??
    cleanText(titleLink.text()) ??
    cleanText(root.find(".vehicle-title__text").first().text()) ??
    detailLink;

  return {
    bodyStyle: cleanText(root.attr("data-bodystyle")),
    condition: parseVehicleCondition({
      cpo: root.attr("data-cpo"),
      tagCondition: root.attr("data-dotagging-item-condition"),
      vehicleType: root.attr("data-vehicletype"),
    }),
    drivetrain: cleanText(root.attr("data-drivetrain")),
    engine: cleanText(root.attr("data-engine")),
    exteriorColor: cleanText(root.attr("data-extcolor")),
    fuelType: cleanText(root.attr("data-fueltype")),
    imageUrl,
    interiorColor: cleanText(root.attr("data-intcolor")),
    inventoryListedAt: parseInventoryListedAt(root.attr("data-dotagging-item-inventory-date")),
    listingPosition,
    make: cleanText(root.attr("data-make")),
    mileage:
      parseInteger(root.attr("data-dotagging-item-odometer")) ??
      parseInteger(root.find('[data-dotagging-item-odometer]').first().attr("data-dotagging-item-odometer")),
    model: cleanText(root.attr("data-model")),
    price: extractSearchCardPrice(root),
    stockNumber: cleanText(root.attr("data-stocknum")),
    title,
    transmission: cleanText(root.attr("data-trans")),
    trim: cleanText(root.attr("data-trim")),
    url: detailLink,
    vin: cleanText(root.attr("data-vin")),
    year: parseInteger(root.attr("data-year")),
  };
}

function parseSearchPage(baseUrl: string, html: string, pageOffset: number) {
  const listScript = parseJsonLd<{
    "@type": "ItemList";
    itemListElement: Array<{
      identifier: string;
      image?: string;
      name: string;
      url: string;
    }>;
    numberOfItems: number;
  }>(html, (value): value is {
    "@type": "ItemList";
    itemListElement: Array<{
      identifier: string;
      image?: string;
      name: string;
      url: string;
    }>;
    numberOfItems: number;
  } => {
    return Boolean(
      value &&
        typeof value === "object" &&
        "@type" in value &&
        value["@type"] === "ItemList" &&
        "itemListElement" in value &&
        Array.isArray(value.itemListElement),
    );
  });

  const taggingData = parseScriptById<{ itemCount?: number }>(html, "dealeron_tagging_data");
  const $ = cheerio.load(html);
  const cardItems = $("[data-vehicle-information]")
    .toArray()
    .map((element, index) => parseSearchCard(baseUrl, $, element, pageOffset + index))
    .filter((item): item is SearchListItem => Boolean(item));

  const items =
    cardItems.length > 0
      ? cardItems
      : listScript?.itemListElement
          .map((item, index) => ({
            bodyStyle: null,
            condition: VehicleCondition.UNKNOWN,
            drivetrain: null,
            engine: null,
            exteriorColor: null,
            fuelType: null,
            imageUrl: absoluteUrl(baseUrl, item.image),
            interiorColor: null,
            inventoryListedAt: null,
            listingPosition: pageOffset + index,
            make: null,
            mileage: null,
            model: null,
            price: null,
            stockNumber: null,
            title: item.name,
            transmission: null,
            trim: null,
            url: absoluteUrl(baseUrl, item.url) ?? "",
            vin: item.identifier,
            year: null,
          }))
          .filter((item) => Boolean(item.url)) ?? [];

  const pageSize = listScript?.numberOfItems || items.length || 1;
  const totalCount = taggingData?.itemCount ?? items.length;

  return {
    items,
    pageCount: Math.max(1, Math.ceil(totalCount / pageSize)),
    totalCount,
  };
}

async function loadSearchPage(
  context: InventorySourceAdapterContext,
  browserContext: BrowserContext,
  pageUrl: string,
  pageOffset: number,
  pageNumber?: number,
) {
  const page = await browserContext.newPage();

  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    try {
      await page.waitForSelector("[data-vehicle-information]", { timeout: 15_000 });
    } catch {
      logger.warn("Timed out waiting for inventory cards", {
        pageNumber,
        sourceUrl: pageUrl,
      });
    }

    const html = await page.content();
    return parseSearchPage(context.baseUrl, html, pageOffset);
  } finally {
    await page.close();
  }
}

function parseVehicleDetails(
  context: InventorySourceAdapterContext,
  html: string,
  listItem: SearchListItem,
): ScrapedVehicleRecord {
  const $ = cheerio.load(html);
  const detailsNode = $("[data-vehicle-information]").first();

  if (!detailsNode.length) {
    throw new Error(`Vehicle details node missing for ${listItem.vin}`);
  }

  const vehicleJson = parseJsonLd<{
    "@type": "Vehicle";
    bodyType?: string;
    description?: string;
    fuelType?: string;
    image?: string;
    manufacturer?: { name?: string };
    name?: string;
    offers?: { price?: number | string; url?: string };
    vehicleEngine?: { name?: string };
    vehicleIdentificationNumber?: string;
    vehicleModelDate?: string;
  }>(html, (value): value is {
    "@type": "Vehicle";
    bodyType?: string;
    description?: string;
    fuelType?: string;
    image?: string;
    manufacturer?: { name?: string };
    name?: string;
    offers?: { price?: number | string; url?: string };
    vehicleEngine?: { name?: string };
    vehicleIdentificationNumber?: string;
    vehicleModelDate?: string;
  } => Boolean(value && typeof value === "object" && "@type" in value && value["@type"] === "Vehicle"));

  const productJson = parseJsonLd<{
    "@type": "Product";
    color?: string;
    description?: string;
    image?: string;
    name?: string;
    offers?: { price?: number | string; url?: string };
    sku?: string;
    url?: string;
  }>(html, (value): value is {
    "@type": "Product";
    color?: string;
    description?: string;
    image?: string;
    name?: string;
    offers?: { price?: number | string; url?: string };
    sku?: string;
    url?: string;
  } => Boolean(value && typeof value === "object" && "@type" in value && value["@type"] === "Product"));

  const primaryImageUrl =
    absoluteUrl(context.baseUrl, productJson?.image) ??
    absoluteUrl(context.baseUrl, vehicleJson?.image) ??
    listItem.imageUrl;

  const imageUrls = new Set<string>();
  if (primaryImageUrl) {
    imageUrls.add(primaryImageUrl);
  }

  const ogImage = absoluteUrl(context.baseUrl, $('meta[property="og:image"]').attr("content"));
  if (ogImage) {
    imageUrls.add(ogImage);
  }

  const mileageText =
    $('.info__item--mileage .info__value').first().attr("title") ??
    $('.info__item--mileage .info__value').first().text();

  return {
    bodyStyle:
      cleanText(detailsNode.attr("data-bodystyle")) ?? listItem.bodyStyle ?? cleanText(vehicleJson?.bodyType),
    condition: parseVehicleCondition({
      cpo: detailsNode.attr("data-cpo"),
      fallback: listItem.condition,
      tagCondition: detailsNode.attr("data-dotagging-item-condition"),
      vehicleType: detailsNode.attr("data-vehicletype"),
    }),
    description:
      cleanHtml(productJson?.description) ??
      cleanHtml(vehicleJson?.description) ??
      cleanText($('meta[name="description"]').attr("content")),
    drivetrain: cleanText(detailsNode.attr("data-drivetrain")) ?? listItem.drivetrain,
    engine:
      cleanText(detailsNode.attr("data-engine")) ?? cleanText(vehicleJson?.vehicleEngine?.name) ?? listItem.engine,
    exteriorColor:
      cleanText(detailsNode.attr("data-extcolor")) ?? cleanText(productJson?.color) ?? listItem.exteriorColor,
    fuelType:
      cleanText(detailsNode.attr("data-fueltype")) ?? cleanText(vehicleJson?.fuelType) ?? listItem.fuelType,
    imageUrls: Array.from(imageUrls),
    interiorColor: cleanText(detailsNode.attr("data-intcolor")) ?? listItem.interiorColor,
    inventoryListedAt: listItem.inventoryListedAt,
    listingPosition: listItem.listingPosition,
    make:
      cleanText(detailsNode.attr("data-make")) ?? cleanText(vehicleJson?.manufacturer?.name) ?? listItem.make,
    mileage: parseInteger(mileageText) ?? listItem.mileage,
    model: cleanText(detailsNode.attr("data-model")) ?? listItem.model,
    price:
      parseVehiclePrice(detailsNode.attr("data-price")) ??
      parseVehiclePrice(productJson?.offers?.price) ??
      parseVehiclePrice(vehicleJson?.offers?.price) ??
      listItem.price,
    rawPayload: {
      productJson,
      searchItem: listItem,
      vehicleJson,
    },
    sourceUrl:
      absoluteUrl(context.baseUrl, productJson?.url) ??
      absoluteUrl(context.baseUrl, vehicleJson?.offers?.url) ??
      listItem.url,
    sourceVehicleKey:
      cleanText(detailsNode.attr("data-vin")) ??
      cleanText(detailsNode.attr("data-stocknum")) ??
      listItem.vin ??
      listItem.stockNumber ??
      listItem.url,
    stockNumber:
      cleanText(detailsNode.attr("data-stocknum")) ?? cleanText(productJson?.sku) ?? listItem.stockNumber,
    title:
      cleanText(detailsNode.attr("data-name")) ??
      cleanText(vehicleJson?.name) ??
      cleanText(productJson?.name) ??
      listItem.title,
    transmission: cleanText(detailsNode.attr("data-trans")) ?? listItem.transmission,
    trim: cleanText(detailsNode.attr("data-trim")) ?? listItem.trim,
    vin:
      cleanText(detailsNode.attr("data-vin")) ??
      cleanText(vehicleJson?.vehicleIdentificationNumber) ??
      listItem.vin,
    year:
      parseInteger(detailsNode.attr("data-year")) ??
      parseInteger(vehicleJson?.vehicleModelDate) ??
      listItem.year,
  };
}

async function scrapeSearchPages(
  context: InventorySourceAdapterContext,
  browserContext: BrowserContext,
  options?: {
    maxItems?: number | null;
  },
) {
  const firstPageUrl = context.inventoryUrl ?? new URL("/searchall.aspx", context.baseUrl).toString();
  const firstParsed = await loadSearchPage(context, browserContext, firstPageUrl, 0, 1);
  const items = [...firstParsed.items];
  const maxItems = options?.maxItems ?? null;

  if (maxItems && items.length >= maxItems) {
    return {
      items: items.slice(0, maxItems),
      pageCount: firstParsed.pageCount,
      totalFound: firstParsed.totalCount,
    };
  }

  if (firstParsed.pageCount > 1) {
    const remainingPageNumbers = Array.from(
      { length: firstParsed.pageCount - 1 },
      (_, index) => index + 2,
    );

    for (
      let batchStartIndex = 0;
      batchStartIndex < remainingPageNumbers.length;
      batchStartIndex += SEARCH_PAGE_CONCURRENCY
    ) {
      const batchPageNumbers = remainingPageNumbers.slice(
        batchStartIndex,
        batchStartIndex + SEARCH_PAGE_CONCURRENCY,
      );

      const batchResults = await Promise.all(
        batchPageNumbers.map((pageNumber) => {
          const pageUrl = new URL(context.inventoryUrl ?? "/searchall.aspx", context.baseUrl);
          pageUrl.searchParams.set("pt", String(pageNumber));

          const pageOffset = (pageNumber - 1) * Math.max(1, firstParsed.items.length);

          return loadSearchPage(
            context,
            browserContext,
            pageUrl.toString(),
            pageOffset,
            pageNumber,
          );
        }),
      );

      for (const batchResult of batchResults) {
        items.push(...batchResult.items);

        if (maxItems && items.length >= maxItems) {
          return {
            items: items.slice(0, maxItems),
            pageCount: firstParsed.pageCount,
            totalFound: firstParsed.totalCount,
          };
        }
      }
    }

    return {
      items,
      pageCount: firstParsed.pageCount,
      totalFound: firstParsed.totalCount,
    };
  }

  return {
    items,
    pageCount: firstParsed.pageCount,
    totalFound: firstParsed.totalCount,
  };
}

async function scrapeVehicleDetails(
  context: InventorySourceAdapterContext,
  items: SearchListItem[],
  browserContext: BrowserContext,
) {
  const results: ScrapedVehicleRecord[] = [];
  const chunkSize = env.SCRAPER_DETAIL_CONCURRENCY;

  for (let index = 0; index < items.length; index += chunkSize) {
    const chunk = items.slice(index, index + chunkSize);
    const pages = await Promise.all(chunk.map(() => browserContext.newPage()));

    const chunkResults = await Promise.all(
      chunk.map(async (item, chunkIndex) => {
        const page = pages[chunkIndex];

        try {
          await page.goto(item.url, { waitUntil: "domcontentloaded" });
          const html = await page.content();
          return parseVehicleDetails(context, html, item);
        } catch (error) {
          logger.warn("Skipping vehicle detail scrape", {
            error: error instanceof Error ? error.message : String(error),
            url: item.url,
            vin: item.vin,
          });
          return null;
        } finally {
          await page.close();
        }
      }),
    );

    results.push(...chunkResults.filter((result): result is ScrapedVehicleRecord => Boolean(result)));
  }

  return results;
}

function buildPreviewRecord(item: SearchListItem): ScrapedVehicleRecord {
  return {
    bodyStyle: item.bodyStyle,
    condition: item.condition,
    description: null,
    drivetrain: item.drivetrain,
    engine: item.engine,
    exteriorColor: item.exteriorColor,
    fuelType: item.fuelType,
    imageUrls: item.imageUrl ? [item.imageUrl] : [],
    interiorColor: item.interiorColor,
    inventoryListedAt: item.inventoryListedAt,
    listingPosition: item.listingPosition,
    make: item.make,
    mileage: item.mileage,
    model: item.model,
    price: item.price,
    rawPayload: {
      previewSource: "search-card",
      searchItem: item,
    },
    sourceUrl: item.url,
    sourceVehicleKey: item.vin ?? item.stockNumber ?? item.url,
    stockNumber: item.stockNumber,
    title: item.title,
    transmission: item.transmission,
    trim: item.trim,
    vin: item.vin,
    year: item.year,
  };
}

export const dealeronSearchAllAdapter: InventorySourceAdapter = {
  key: "dealeron",
  label: "DealerOn SearchAll",
  detect({ baseUrl, html }) {
    const matched =
      html.includes("dealeron_tagging_data") ||
      html.includes("/searchall.aspx") ||
      html.includes("data-vehicle-information");

    return {
      confidence: matched ? 0.92 : 0.08,
      detectionStrategy: "PLATFORM_TEMPLATE",
      inventoryUrl: matched ? new URL("/searchall.aspx", baseUrl).toString() : null,
      matched,
      notes: matched ? "DealerOn-style inventory structure detected." : null,
    };
  },
  async refreshVehicles(context, urls) {
    const items = urls.map((url) => ({
      bodyStyle: null,
      condition: VehicleCondition.UNKNOWN,
      drivetrain: null,
      engine: null,
      exteriorColor: null,
      fuelType: null,
      imageUrl: null,
      inventoryListedAt: null,
      interiorColor: null,
      listingPosition: 0,
      make: null,
      mileage: null,
      model: null,
      price: null,
      stockNumber: null,
      transmission: null,
      trim: null,
      title: url,
      url,
      vin: url,
      year: null,
    }));

    return withPlaywrightContext((browserContext) =>
      scrapeVehicleDetails(context, items, browserContext),
    );
  },
  async scrapePreview(context, limit) {
    return withPlaywrightContext<ScrapePreviewResult>(async (browserContext) => {
      const searchResult = await scrapeSearchPages(context, browserContext, {
        maxItems: limit,
      });
      const uniqueItems = Array.from(
        new Map(searchResult.items.map((item) => [item.vin ?? item.url, item])).values(),
      );
      return {
        pageCount: searchResult.pageCount,
        totalFound: searchResult.totalFound,
        vehicles: uniqueItems.slice(0, limit).map(buildPreviewRecord),
      };
    });
  },
  async scrapeInventory(context): Promise<ScrapeInventoryResult> {
    return withPlaywrightContext(async (browserContext) => {
      const searchResult = await scrapeSearchPages(context, browserContext);
      const uniqueItems = new Map(searchResult.items.map((item) => [item.vin ?? item.url, item]));
      const vehicles = await scrapeVehicleDetails(
        context,
        Array.from(uniqueItems.values()),
        browserContext,
      );

      return {
        pageCount: searchResult.pageCount,
        totalFound: searchResult.totalFound,
        vehicles,
      };
    });
  },
};
