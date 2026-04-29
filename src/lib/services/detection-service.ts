import * as cheerio from "cheerio";
import {
  SourceDetectionStrategy,
  VehicleCondition,
  type ExtractionRuleType,
  type FieldTransform,
} from "@prisma/client";
import type { AnyNode } from "domhandler";

import { logger } from "@/lib/logger";
import { assertSafeExternalUrl, fetchTextWithRedirectValidation } from "@/lib/security";
import { listSourceAdapters } from "@/lib/source-adapters";
import { withPlaywrightContext } from "@/lib/source-adapters/playwright-pool";
import type { ScrapedVehicleRecord } from "@/lib/source-adapters/types";
import { sanitizeHttpUrl } from "@/lib/url";
import { extractVehiclePriceFromText, parseVehiclePrice } from "@/lib/vehicle-price";

const GENERIC_PREVIEW_LIMIT = 48;
const SUPPORTED_ADAPTER_PREVIEW_LIMIT = 48;
const MAX_CANDIDATE_PAGES = 6;
const MAX_RENDERED_CANDIDATES = 3;

const COMMON_INVENTORY_PATHS = [
  "/searchall.aspx",
  "/searchnew.aspx",
  "/searchused.aspx",
  "/new-inventory/index.htm",
  "/used-inventory/index.htm",
  "/inventory/index.htm",
  "/vehicles-for-sale",
  "/used-cars-for-sale",
  "/new-vehicles-for-sale",
] as const;

const PARKED_PAGE_MARKERS = [
  "domain is coming soon",
  "this domain is coming soon",
  "parked free",
  "buy this domain",
  "under construction",
  "website coming soon",
  "coming soon",
] as const;

const ACCESS_BLOCK_MARKERS = [
  "attention required",
  "cloudflare",
  "enable cookies",
  "you have been blocked",
  "access denied",
  "captcha",
] as const;

const GENERIC_CARD_SELECTORS = [
  "[data-vehicle-information]",
  "[data-vehicle]",
  "[data-vehicle-id]",
  "[data-vin]",
  "[data-stocknum]",
  "[data-stock]",
  "[class*='vehicle-card']",
  "[class*='vehicleCard']",
  "[class*='vehicle-item']",
  "[class*='vehicleItem']",
  "[class*='inventory-item']",
  "[class*='inventoryItem']",
  "[class*='inventory-card']",
  "[class*='inventoryCard']",
  "[class*='inventory-listing']",
  "[class*='inventoryListing']",
  "[class*='listing-card']",
  "[class*='listingCard']",
  "[class*='srp-item']",
  "[class*='srpItem']",
  "[class*='srp-vehicle']",
  "[class*='result-item']",
  "[class*='resultItem']",
  "[class*='search-result']",
  "[class*='searchResult']",
  "[class*='vehicle-tile']",
  "[class*='vehicleTile']",
  "article",
] as const;

const TITLE_SELECTORS = [
  "[data-name]",
  "[itemprop='name']",
  ".vehicle-title",
  ".inventory-title",
  ".listing-title",
  ".result-title",
  ".title",
  "h2",
  "h3",
] as const;

const IMAGE_SELECTORS = [
  "img[src]",
  "img[data-src]",
  "img[data-lazy]",
  "img[data-original]",
  "source[srcset]",
  "[style*='background-image']",
] as const;

const COMMON_MAKES = new Set([
  "acura",
  "alfa",
  "aston",
  "audi",
  "bentley",
  "bmw",
  "buick",
  "cadillac",
  "chevrolet",
  "chrysler",
  "dodge",
  "fiat",
  "ford",
  "genesis",
  "gmc",
  "honda",
  "hyundai",
  "infiniti",
  "jaguar",
  "jeep",
  "kia",
  "land",
  "lexus",
  "lincoln",
  "maserati",
  "mazda",
  "mercedes",
  "mini",
  "mitsubishi",
  "nissan",
  "porsche",
  "ram",
  "subaru",
  "tesla",
  "toyota",
  "volkswagen",
  "volvo",
]) as Set<string>;

export type SourceProfileDraft = {
  adapterKey: string;
  confidence: number;
  detectedVehicleCount: number;
  detectionStrategy: SourceDetectionStrategy;
  extractionRules: Array<{
    attribute?: string | null;
    isRequired?: boolean;
    label: string;
    regex?: string | null;
    ruleType: ExtractionRuleType;
    selector: string;
    sortOrder: number;
  }>;
  fieldMappings: Array<{
    fallbackValue?: string | null;
    isRequired?: boolean;
    sourcePath: string;
    targetField: string;
    transform: FieldTransform;
  }>;
  inventoryPath: string | null;
  notes: string | null;
  previewVehicles: ScrapedVehicleRecord[];
  requiresReview: boolean;
  submittedUrl: string;
  summary: string;
};

type CandidatePage = {
  html: string;
  url: string;
};

function normalizeDealershipUrl(input: string) {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withProtocol);
  url.hash = "";
  url.search = "";
  url.pathname = "/";

  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    submittedUrl: input.trim(),
  };
}

async function fetchText(url: string) {
  return fetchTextWithRedirectValidation(url, {
    headers: {
      "user-agent": "LotPilotBot/1.0 (+inventory onboarding preview)",
    },
  });
}

function cleanText(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value.replace(/\s+/g, " ").trim() || null;
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

function buildVehicleTitle(input: {
  title?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
}) {
  return (
    [input.year, input.make, input.model, input.trim].filter(Boolean).join(" ").trim() ||
    input.title ||
    "Untitled Vehicle"
  );
}

function inferCondition(value: string | null | undefined) {
  const normalized = cleanText(value)?.toUpperCase() ?? "";

  if (normalized.includes("CERTIFIED") || normalized.includes("CPO")) {
    return VehicleCondition.CPO;
  }

  if (normalized.includes("NEW")) {
    return VehicleCondition.NEW;
  }

  if (normalized.includes("USED") || normalized.includes("PRE-OWNED")) {
    return VehicleCondition.USED;
  }

  return VehicleCondition.UNKNOWN;
}

function inferVehiclePartsFromTitle(title: string | null | undefined) {
  const normalized = cleanText(title);
  if (!normalized) {
    return {
      make: null,
      model: null,
      trim: null,
      year: null,
    };
  }

  const tokens = normalized.split(/\s+/);
  const yearIndex = tokens.findIndex((token) => /^(19|20)\d{2}$/.test(token));
  const year = yearIndex >= 0 ? Number.parseInt(tokens[yearIndex], 10) : null;
  const makeIndex = tokens.findIndex((token) => COMMON_MAKES.has(token.toLowerCase()));

  if (makeIndex === -1) {
    return {
      make: null,
      model: null,
      trim: null,
      year,
    };
  }

  const make = tokens[makeIndex];
  const remaining = tokens.slice(makeIndex + 1);

  return {
    make,
    model: remaining[0] ?? null,
    trim: remaining.slice(1).join(" ") || null,
    year,
  };
}

function normalizePreviewRecord(
  partial: Partial<ScrapedVehicleRecord> & {
    sourceUrl: string;
    sourceVehicleKey: string;
  },
): ScrapedVehicleRecord {
  return {
    bodyStyle: partial.bodyStyle ?? null,
    condition: partial.condition ?? VehicleCondition.UNKNOWN,
    description: partial.description ?? null,
    drivetrain: partial.drivetrain ?? null,
    engine: partial.engine ?? null,
    exteriorColor: partial.exteriorColor ?? null,
    fuelType: partial.fuelType ?? null,
    imageUrls: partial.imageUrls ?? [],
    inventoryListedAt: partial.inventoryListedAt ?? null,
    interiorColor: partial.interiorColor ?? null,
    listingPosition: partial.listingPosition ?? null,
    make: partial.make ?? null,
    mileage: partial.mileage ?? null,
    model: partial.model ?? null,
    price: partial.price ?? null,
    rawPayload: partial.rawPayload ?? {},
    sourceUrl: partial.sourceUrl,
    sourceVehicleKey: partial.sourceVehicleKey,
    stockNumber: partial.stockNumber ?? null,
    title: buildVehicleTitle(partial),
    transmission: partial.transmission ?? null,
    trim: partial.trim ?? null,
    vin: partial.vin ?? null,
    year: partial.year ?? null,
  };
}

function flattenJsonLdNodes(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenJsonLdNodes(item));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const node = value as Record<string, unknown>;
  const nested: unknown[] = [];

  if (Array.isArray(node["@graph"])) {
    nested.push(...flattenJsonLdNodes(node["@graph"]));
  }

  if (Array.isArray(node.itemListElement)) {
    nested.push(
      ...node.itemListElement.flatMap((item) => {
        if (item && typeof item === "object" && "item" in (item as Record<string, unknown>)) {
          return flattenJsonLdNodes((item as Record<string, unknown>).item);
        }

        return flattenJsonLdNodes(item);
      }),
    );
  }

  return [node, ...nested];
}

function parseJsonLdBlocks(html: string) {
  const matches = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  );

  const values: unknown[] = [];

  for (const match of matches) {
    try {
      const parsed: unknown = JSON.parse(match[1]);
      values.push(...flattenJsonLdNodes(parsed));
    } catch {
      continue;
    }
  }

  return values;
}

function isPlaceholderPage(html: string) {
  const $ = cheerio.load(html);
  const title = cleanText($("title").first().text())?.toLowerCase() ?? "";
  const bodyText = cleanText($("body").text())?.toLowerCase() ?? "";
  const combined = `${title} ${bodyText}`;

  return PARKED_PAGE_MARKERS.some((marker) => combined.includes(marker));
}

function isAccessBlockedPage(html: string) {
  const $ = cheerio.load(html);
  const title = cleanText($("title").first().text())?.toLowerCase() ?? "";
  const bodyText = cleanText($("body").text())?.toLowerCase() ?? "";
  const combined = `${title} ${bodyText}`;

  return ACCESS_BLOCK_MARKERS.some((marker) => combined.includes(marker));
}

function scoreInventoryLink(input: { href: string; text: string }) {
  const value = `${input.href} ${input.text}`.toLowerCase();

  return (
    (value.includes("searchall") ? 8 : 0) +
    (value.includes("searchnew") ? 7 : 0) +
    (value.includes("searchused") ? 7 : 0) +
    (value.includes("inventory") ? 6 : 0) +
    (value.includes("vehicles-for-sale") ? 6 : 0) +
    (value.includes("used") ? 3 : 0) +
    (value.includes("new") ? 3 : 0) +
    (value.includes("pre-owned") ? 3 : 0) +
    (value.includes("find my car") ? 3 : 0) +
    (value.includes("vehicle") ? 2 : 0)
  );
}

function discoverInventoryLinks(baseUrl: string, html: string) {
  const $ = cheerio.load(html);
  const seen = new Set<string>();

  const discovered = $("a[href]")
    .toArray()
    .map((element) => {
      const href = $(element).attr("href");
      const text = cleanText($(element).text()) ?? "";
      const url = sanitizeHttpUrl(href, baseUrl);

      if (!url) {
        return null;
      }

      if (new URL(url).hostname !== new URL(baseUrl).hostname) {
        return null;
      }

      return {
        score: scoreInventoryLink({
          href: url,
          text,
        }),
        url,
      };
    })
    .filter((candidate): candidate is { score: number; url: string } => Boolean(candidate))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .filter((candidate) => {
      if (seen.has(candidate.url)) {
        return false;
      }

      seen.add(candidate.url);
      return true;
    });

  return discovered.slice(0, MAX_CANDIDATE_PAGES).map((candidate) => candidate.url);
}

function buildCandidateInventoryUrls(baseUrl: string, homepageHtml: string) {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const candidate of discoverInventoryLinks(baseUrl, homepageHtml)) {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      urls.push(candidate);
    }
  }

  for (const path of COMMON_INVENTORY_PATHS) {
    const candidate = new URL(path, baseUrl).toString();
    if (!seen.has(candidate)) {
      seen.add(candidate);
      urls.push(candidate);
    }
  }

  return urls.slice(0, MAX_CANDIDATE_PAGES);
}

function previewFromStructuredData(baseUrl: string, html: string) {
  const jsonLd = parseJsonLdBlocks(html);
  const preview: ScrapedVehicleRecord[] = [];
  const seen = new Set<string>();

  for (const node of jsonLd) {
    if (!node || typeof node !== "object") {
      continue;
    }

    const record = node as Record<string, unknown>;
    const rawType = record["@type"];
    const types = Array.isArray(rawType) ? rawType : [rawType];
    const normalizedTypes = types
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.toLowerCase());

    if (!normalizedTypes.some((value) => value === "vehicle" || value === "product")) {
      continue;
    }

    const name = cleanText(typeof record.name === "string" ? record.name : null);
    const url =
      sanitizeHttpUrl(typeof record.url === "string" ? record.url : null, baseUrl) ?? baseUrl;
    const vin = cleanText(
      typeof record.vehicleIdentificationNumber === "string"
        ? record.vehicleIdentificationNumber
        : typeof record.sku === "string"
          ? record.sku
          : null,
    );
    const uniqueKey = vin ?? url;

    if (seen.has(uniqueKey)) {
      continue;
    }

    const imageValue = record.image;
    const imageUrls =
      typeof imageValue === "string"
        ? [sanitizeHttpUrl(imageValue, baseUrl)].filter((value): value is string => Boolean(value))
        : Array.isArray(imageValue)
          ? imageValue
              .filter((value): value is string => typeof value === "string")
              .map((value) => sanitizeHttpUrl(value, baseUrl))
              .filter((value): value is string => Boolean(value))
          : [];

    const offers =
      record.offers && typeof record.offers === "object" && !Array.isArray(record.offers)
        ? (record.offers as Record<string, unknown>)
        : null;

    const manufacturer =
      record.manufacturer &&
      typeof record.manufacturer === "object" &&
      !Array.isArray(record.manufacturer) &&
      typeof (record.manufacturer as Record<string, unknown>).name === "string"
        ? cleanText((record.manufacturer as Record<string, unknown>).name as string)
        : null;

    const titleParts = inferVehiclePartsFromTitle(name);
    preview.push(
      normalizePreviewRecord({
        bodyStyle: cleanText(typeof record.bodyType === "string" ? record.bodyType : null),
        condition: inferCondition(
          typeof record.itemCondition === "string" ? record.itemCondition : null,
        ),
        description: cleanText(typeof record.description === "string" ? record.description : null),
        fuelType: cleanText(typeof record.fuelType === "string" ? record.fuelType : null),
        imageUrls,
        listingPosition: preview.length,
        make: manufacturer ?? titleParts.make,
        model:
          cleanText(typeof record.model === "string" ? record.model : null) ?? titleParts.model,
        price: parseVehiclePrice((offers?.price as string | number | null | undefined) ?? null),
        rawPayload: { node: record },
        sourceUrl: url,
        sourceVehicleKey: uniqueKey,
        stockNumber: cleanText(typeof record.sku === "string" ? record.sku : null),
        title: name ?? undefined,
        trim: titleParts.trim,
        vin,
        year:
          parseInteger(
            typeof record.vehicleModelDate === "string" ? record.vehicleModelDate : null,
          ) ?? titleParts.year,
      }),
    );

    seen.add(uniqueKey);

    if (preview.length >= GENERIC_PREVIEW_LIMIT) {
      break;
    }
  }

  return preview;
}

function findImageUrl($root: cheerio.Cheerio<AnyNode>, baseUrl: string) {
  for (const selector of IMAGE_SELECTORS) {
    const node = $root.find(selector).first();
    if (!node.length) {
      continue;
    }

    const srcset = node.attr("srcset") ?? node.attr("data-srcset");
    if (srcset) {
      const candidate = srcset.split(",")[0]?.trim().split(/\s+/)[0];
      const url = sanitizeHttpUrl(candidate, baseUrl);
      if (url) {
        return url;
      }
    }

    const directUrl =
      node.attr("src") ??
      node.attr("data-src") ??
      node.attr("data-lazy") ??
      node.attr("data-original");

    const sanitized = sanitizeHttpUrl(directUrl, baseUrl);
    if (sanitized) {
      return sanitized;
    }

    const style = node.attr("style");
    if (style) {
      const match = style.match(/url\((['"]?)(.*?)\1\)/i);
      const styleUrl = sanitizeHttpUrl(match?.[2], baseUrl);
      if (styleUrl) {
        return styleUrl;
      }
    }
  }

  return null;
}

function findVehicleLink($root: cheerio.Cheerio<AnyNode>, baseUrl: string) {
  const candidates = $root.find("a[href]").toArray();

  for (const candidate of candidates) {
    const href =
      "attribs" in candidate && typeof candidate.attribs?.href === "string"
        ? candidate.attribs.href
        : null;
    const url = sanitizeHttpUrl(href, baseUrl);

    if (!url) {
      continue;
    }

    const value = url.toLowerCase();
    if (
      value.includes("/new-") ||
      value.includes("/used-") ||
      value.includes("/vehicle") ||
      value.includes("/inventory") ||
      value.includes("vin=") ||
      value.includes("stock")
    ) {
      return url;
    }
  }

  const fallbackHref = $root.find("a[href]").first().attr("href");
  return sanitizeHttpUrl(fallbackHref, baseUrl);
}

function parseGenericCard(
  baseUrl: string,
  $: cheerio.CheerioAPI,
  element: AnyNode,
  index: number,
) {
  const root = $(element);
  const link = findVehicleLink(root, baseUrl);
  const title =
    TITLE_SELECTORS.map((selector) => cleanText(root.find(selector).first().text())).find(Boolean) ??
    cleanText(root.attr("data-name")) ??
    cleanText(root.find("a[href]").first().text());
  const cardText = cleanText(root.text()) ?? "";
  const titleText = title ?? cardText;
  const titleParts = inferVehiclePartsFromTitle(titleText);
  const price =
    parseVehiclePrice(root.attr("data-price")) ??
    extractVehiclePriceFromText(cardText);
  const mileage =
    parseInteger(root.attr("data-mileage")) ??
    parseInteger(cardText.match(/([\d,]+)\s*(?:mi|miles)\b/i)?.[1] ?? null);
  const stockNumber =
    cleanText(root.attr("data-stocknum")) ??
    cleanText(cardText.match(/\bstock(?:\s*(?:number|no\.?|#))?\s*[:#-]?\s*([a-z0-9-]{3,})\b/i)?.[1]);
  const vin =
    cleanText(root.attr("data-vin")) ??
    cleanText(cardText.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0] ?? null);
  const imageUrl = findImageUrl(root, baseUrl);
  const condition =
    inferCondition(root.attr("data-condition")) !== VehicleCondition.UNKNOWN
      ? inferCondition(root.attr("data-condition"))
      : inferCondition(cardText);
  const inventoryListedAt = parseInventoryListedAt(
    root.attr("data-inventory-date") ??
      root.attr("data-dotagging-item-inventory-date") ??
      cardText.match(
        /\b(?:listed|inventory date|posted)\s*[:#-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})\b/i,
      )?.[1],
  );

  let score = 0;
  if (link) score += 2;
  if (title) score += 2;
  if (price) score += 2;
  if (mileage) score += 1;
  if (stockNumber) score += 1;
  if (vin) score += 3;
  if (imageUrl) score += 1;
  if (titleParts.year) score += 1;

  if (!link || (!title && !vin && !stockNumber) || score < 4) {
    return null;
  }

  return normalizePreviewRecord({
    condition,
    imageUrls: imageUrl ? [imageUrl] : [],
    inventoryListedAt,
    listingPosition: index,
    make: cleanText(root.attr("data-make")) ?? titleParts.make,
    mileage,
    model: cleanText(root.attr("data-model")) ?? titleParts.model,
    price,
    rawPayload: {
      html: root.html(),
    },
    sourceUrl: link,
    sourceVehicleKey: vin ?? stockNumber ?? link,
    stockNumber,
    title: title ?? undefined,
    trim: cleanText(root.attr("data-trim")) ?? titleParts.trim,
    vin,
    year: parseInteger(root.attr("data-year")) ?? titleParts.year,
  });
}

function previewFromGenericCrawler(baseUrl: string, html: string) {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const preview: ScrapedVehicleRecord[] = [];

  for (const element of $(GENERIC_CARD_SELECTORS.join(",")).toArray()) {
    const record = parseGenericCard(baseUrl, $, element, preview.length);
    if (!record) {
      continue;
    }

    const uniqueKey = record.vin ?? record.sourceUrl;
    if (seen.has(uniqueKey)) {
      continue;
    }

    seen.add(uniqueKey);
    preview.push(record);

    if (preview.length >= GENERIC_PREVIEW_LIMIT) {
      break;
    }
  }

  return preview;
}

async function fetchCandidatePages(candidateUrls: string[]) {
  const pages: CandidatePage[] = [];

  for (const url of candidateUrls) {
    try {
      const html = await fetchText(url);
      pages.push({ html, url });
    } catch {
      continue;
    }
  }

  return pages;
}

async function renderCandidatePage(url: string) {
  return withPlaywrightContext(async (context) => {
    const page = await context.newPage();

    try {
      await page.goto(url, { timeout: 20_000, waitUntil: "domcontentloaded" });
      try {
        await page.waitForLoadState("networkidle", { timeout: 5_000 });
      } catch {
        // Best effort only.
      }

      await page.waitForTimeout(750);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.35));
      await page.waitForTimeout(500);

      return {
        html: await page.content(),
        url: page.url(),
      };
    } finally {
      await page.close();
    }
  });
}

async function previewFromRenderedCandidates(baseUrl: string, candidateUrls: string[]) {
  let best: { count: number; previewVehicles: ScrapedVehicleRecord[]; url: string } | null = null;

  for (const candidateUrl of candidateUrls.slice(0, MAX_RENDERED_CANDIDATES)) {
    try {
      const rendered = await renderCandidatePage(candidateUrl);
      const structuredPreview = previewFromStructuredData(baseUrl, rendered.html);
      const genericPreview = structuredPreview.length
        ? structuredPreview
        : previewFromGenericCrawler(baseUrl, rendered.html);

      if (!genericPreview.length) {
        continue;
      }

      if (!best || genericPreview.length > best.count) {
        best = {
          count: genericPreview.length,
          previewVehicles: genericPreview,
          url: rendered.url,
        };
      }

      if (genericPreview.length >= 6) {
        break;
      }
    } catch {
      continue;
    }
  }

  return best;
}

async function detectFeedDiscovery(baseUrl: string) {
  const candidates = [
    "/inventory.json",
    "/inventory.xml",
    "/feeds/inventory.json",
    "/feeds/inventory.xml",
  ];

  for (const candidate of candidates) {
    const url = new URL(candidate, baseUrl).toString();

    try {
      const text = await fetchText(url);

      if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
        const parsed: unknown = JSON.parse(text);
        const items: unknown[] = Array.isArray(parsed)
          ? parsed
          : parsed &&
              typeof parsed === "object" &&
              "vehicles" in parsed &&
              Array.isArray((parsed as { vehicles?: unknown[] }).vehicles)
            ? ((parsed as { vehicles: unknown[] }).vehicles ?? [])
            : [];

        const preview = items
          .slice(0, GENERIC_PREVIEW_LIMIT)
          .map((item, index) => {
            const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
            const titleParts = inferVehiclePartsFromTitle(
              typeof record.title === "string" ? record.title : null,
            );

            return normalizePreviewRecord({
              imageUrls:
                typeof record.image === "string"
                  ? [record.image]
                  : Array.isArray(record.images)
                    ? record.images.filter((value: unknown): value is string => typeof value === "string")
                    : [],
              listingPosition: index,
              make: typeof record.make === "string" ? record.make : titleParts.make,
              model: typeof record.model === "string" ? record.model : titleParts.model,
              price:
                typeof record.price === "number"
                  ? parseVehiclePrice(record.price)
                  : parseVehiclePrice(String(record.price ?? "")),
              rawPayload: { item: record },
              sourceUrl: typeof record.url === "string" ? record.url : url,
              sourceVehicleKey:
                typeof record.vin === "string"
                  ? record.vin
                  : typeof record.id === "string"
                    ? record.id
                    : `${url}-${index}`,
              stockNumber: typeof record.stockNumber === "string" ? record.stockNumber : null,
              title: typeof record.title === "string" ? record.title : undefined,
              trim: titleParts.trim,
              vin: typeof record.vin === "string" ? record.vin : null,
              year:
                typeof record.year === "number"
                  ? record.year
                  : parseInteger(String(record.year ?? "")) ?? titleParts.year,
            });
          })
          .filter((item) => Boolean(item.title || item.vin));

        if (preview.length) {
          return {
            confidence: 0.72,
            detectedVehicleCount: items.length || preview.length,
            detectionStrategy: SourceDetectionStrategy.FEED_DISCOVERY,
            inventoryPath: url,
            notes: "A discoverable inventory feed URL returned vehicle-like records.",
            preview,
            requiresReview: true,
            summary: "Feed-like inventory data was found, but it should be reviewed before activation.",
          };
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

function buildDealerOnTemplate(inventoryUrl: string | null) {
  return {
    extractionRules: [
      {
        isRequired: true,
        label: "Vehicle list page",
        ruleType: "LIST_CONTAINER" as const,
        selector: ".vehicle-card, .inventory-item, [data-vehicle-information]",
        sortOrder: 0,
      },
      {
        isRequired: true,
        label: "Vehicle detail link",
        ruleType: "DETAIL_LINK" as const,
        selector: "a[href]",
        sortOrder: 1,
      },
      {
        isRequired: true,
        label: "Inventory pagination",
        ruleType: "PAGINATION" as const,
        selector: ".pagination a[href]",
        sortOrder: 2,
      },
    ],
    fieldMappings: [
      { isRequired: true, sourcePath: "data-vin", targetField: "vin", transform: "TEXT" as const },
      { sourcePath: "data-stocknum", targetField: "stockNumber", transform: "TEXT" as const },
      { sourcePath: "data-year", targetField: "year", transform: "NUMBER" as const },
      { sourcePath: "data-make", targetField: "make", transform: "TEXT" as const },
      { sourcePath: "data-model", targetField: "model", transform: "TEXT" as const },
      { sourcePath: "data-trim", targetField: "trim", transform: "TEXT" as const },
      { sourcePath: "data-price", targetField: "price", transform: "CURRENCY" as const },
      { sourcePath: "data-engine", targetField: "engine", transform: "TEXT" as const },
      { sourcePath: "data-trans", targetField: "transmission", transform: "TEXT" as const },
      { sourcePath: "data-fueltype", targetField: "fuelType", transform: "TEXT" as const },
    ],
    inventoryPath: inventoryUrl ? new URL(inventoryUrl).pathname : "/searchall.aspx",
  };
}

export async function detectSourceProfileFromUrl(websiteUrl: string): Promise<SourceProfileDraft> {
  const normalized = normalizeDealershipUrl(websiteUrl);
  await assertSafeExternalUrl(normalized.baseUrl);
  let homepageHtml: string;

  try {
    homepageHtml = await fetchText(normalized.baseUrl);
  } catch (error) {
    const renderedHomepage = await renderCandidatePage(normalized.baseUrl).catch(() => null);

    if (renderedHomepage && !isAccessBlockedPage(renderedHomepage.html)) {
      homepageHtml = renderedHomepage.html;
    } else {
      const message =
        error instanceof Error ? error.message : "The dealership website blocked automated access.";

      return {
        adapterKey: "manual-review",
        confidence: 0.1,
        detectedVehicleCount: 0,
        detectionStrategy: SourceDetectionStrategy.MANUAL_FALLBACK,
        extractionRules: [],
        fieldMappings: [],
        inventoryPath: null,
        notes: "This site appears to block automated onboarding requests. A vendor feed, allowlist, or manual review workflow will be required.",
        previewVehicles: [],
        requiresReview: true,
        submittedUrl: normalized.submittedUrl,
        summary: message.includes("403") || message.includes("429")
          ? "The submitted website is blocking automated inspection. Manual review is required."
          : "Automatic onboarding could not fetch the submitted website. Manual review is required.",
      };
    }
  }
  const homepagePage: CandidatePage = {
    html: homepageHtml,
    url: normalized.baseUrl,
  };

  if (isPlaceholderPage(homepageHtml)) {
    return {
      adapterKey: "manual-review",
      confidence: 0.08,
      detectedVehicleCount: 0,
      detectionStrategy: SourceDetectionStrategy.MANUAL_FALLBACK,
      extractionRules: [],
      fieldMappings: [],
      inventoryPath: null,
      notes: "This URL appears to resolve to a parked or placeholder page instead of a live dealership inventory site.",
      previewVehicles: [],
      requiresReview: true,
      submittedUrl: normalized.submittedUrl,
      summary: "The submitted URL does not currently appear to host a live dealership inventory site.",
    };
  }

  const inventoryCandidateUrls = buildCandidateInventoryUrls(normalized.baseUrl, homepageHtml);

  const feedResult = await detectFeedDiscovery(normalized.baseUrl);
  if (feedResult) {
    return {
      adapterKey: "generic-feed",
      confidence: feedResult.confidence,
      detectedVehicleCount: feedResult.detectedVehicleCount,
      detectionStrategy: feedResult.detectionStrategy,
      extractionRules: [],
      fieldMappings: [],
      inventoryPath: feedResult.inventoryPath,
      notes: feedResult.notes,
      previewVehicles: feedResult.preview,
      requiresReview: true,
      submittedUrl: normalized.submittedUrl,
      summary: feedResult.summary,
    };
  }

  for (const adapter of listSourceAdapters()) {
    const detection = adapter.detect({
      baseUrl: normalized.baseUrl,
      html: homepageHtml,
    });

    if (!detection.matched) {
      continue;
    }

    const previewResult = await adapter.scrapePreview(
      {
        baseUrl: normalized.baseUrl,
        inventoryUrl: detection.inventoryUrl ?? normalized.baseUrl,
        slug: new URL(normalized.baseUrl).hostname,
      },
      SUPPORTED_ADAPTER_PREVIEW_LIMIT,
    );

    if (!previewResult.vehicles.length) {
      continue;
    }

    const template = buildDealerOnTemplate(detection.inventoryUrl ?? normalized.baseUrl);

    return {
      adapterKey: adapter.key,
      confidence: detection.confidence,
      detectedVehicleCount: previewResult.totalFound ?? previewResult.vehicles.length,
      detectionStrategy: detection.detectionStrategy,
      extractionRules: template.extractionRules,
      fieldMappings: template.fieldMappings,
      inventoryPath: template.inventoryPath,
      notes: detection.notes,
      previewVehicles: previewResult.vehicles,
      requiresReview: false,
      submittedUrl: normalized.submittedUrl,
      summary: detection.notes ?? `${adapter.label} template matched successfully.`,
    };
  }

  const candidatePages = await fetchCandidatePages(inventoryCandidateUrls);
  const pagesForAnalysis: CandidatePage[] = [homepagePage, ...candidatePages];

  for (const page of candidatePages) {
    for (const adapter of listSourceAdapters()) {
      const detection = adapter.detect({
        baseUrl: normalized.baseUrl,
        html: page.html,
      });

      if (!detection.matched) {
        continue;
      }

      const previewResult = await adapter.scrapePreview(
        {
          baseUrl: normalized.baseUrl,
          inventoryUrl: detection.inventoryUrl ?? page.url,
          slug: new URL(normalized.baseUrl).hostname,
        },
        SUPPORTED_ADAPTER_PREVIEW_LIMIT,
      );

      if (!previewResult.vehicles.length) {
        continue;
      }

      const template = buildDealerOnTemplate(detection.inventoryUrl ?? page.url);

      return {
        adapterKey: adapter.key,
        confidence: detection.confidence,
        detectedVehicleCount: previewResult.totalFound ?? previewResult.vehicles.length,
        detectionStrategy: detection.detectionStrategy,
        extractionRules: template.extractionRules,
        fieldMappings: template.fieldMappings,
        inventoryPath: template.inventoryPath,
        notes: detection.notes,
        previewVehicles: previewResult.vehicles,
        requiresReview: false,
        submittedUrl: normalized.submittedUrl,
        summary: detection.notes ?? `${adapter.label} template matched successfully.`,
      };
    }
  }

  for (const page of pagesForAnalysis) {
    const structuredPreview = previewFromStructuredData(normalized.baseUrl, page.html);

    if (structuredPreview.length) {
      return {
        adapterKey: "structured-data-preview",
        confidence: 0.58,
        detectedVehicleCount: structuredPreview.length,
        detectionStrategy: SourceDetectionStrategy.STRUCTURED_DATA,
        extractionRules: [],
        fieldMappings: [],
        inventoryPath: page.url === normalized.baseUrl ? null : new URL(page.url).pathname,
        notes: "Vehicle structured data was detected in page markup.",
        previewVehicles: structuredPreview,
        requiresReview: true,
        submittedUrl: normalized.submittedUrl,
        summary: "Structured vehicle data was found. Review is recommended before activation.",
      };
    }
  }

  for (const page of pagesForAnalysis) {
    const genericPreview = previewFromGenericCrawler(normalized.baseUrl, page.html);

    if (genericPreview.length) {
      return {
        adapterKey: "generic-crawler-review",
        confidence: genericPreview.length >= 12 ? 0.48 : 0.41,
        detectedVehicleCount: genericPreview.length,
        detectionStrategy: SourceDetectionStrategy.GENERIC_CRAWLER,
        extractionRules: [],
        fieldMappings: [],
        inventoryPath: page.url === normalized.baseUrl ? null : new URL(page.url).pathname,
        notes: "Vehicle-like inventory cards were detected in the raw page markup.",
        previewVehicles: genericPreview,
        requiresReview: true,
        submittedUrl: normalized.submittedUrl,
        summary: "Possible inventory structure detected. Manual review is required before activation.",
      };
    }
  }

  const renderedPreview = await previewFromRenderedCandidates(normalized.baseUrl, [
    ...inventoryCandidateUrls,
    normalized.baseUrl,
  ]);

  if (renderedPreview) {
    return {
      adapterKey: "generic-crawler-review",
      confidence: renderedPreview.count >= 12 ? 0.46 : 0.38,
      detectedVehicleCount: renderedPreview.count,
      detectionStrategy: SourceDetectionStrategy.GENERIC_CRAWLER,
      extractionRules: [],
      fieldMappings: [],
      inventoryPath:
        renderedPreview.url === normalized.baseUrl ? null : new URL(renderedPreview.url).pathname,
      notes: "Inventory cards were detected after rendering the page client-side. Review is still recommended before activation.",
      previewVehicles: renderedPreview.previewVehicles,
      requiresReview: true,
      submittedUrl: normalized.submittedUrl,
      summary: "A rendered inventory preview was found. Manual review is still required before activation.",
    };
  }

  logger.warn("Source detection requires manual fallback", {
    baseUrl: normalized.baseUrl,
  });

  return {
    adapterKey: "manual-review",
    confidence: 0.12,
    detectedVehicleCount: 0,
    detectionStrategy: SourceDetectionStrategy.MANUAL_FALLBACK,
    extractionRules: [],
    fieldMappings: [],
    inventoryPath: inventoryCandidateUrls[0] ? new URL(inventoryCandidateUrls[0]).pathname : null,
    notes: "Automatic detection could not confidently activate this source.",
    previewVehicles: [],
    requiresReview: true,
    submittedUrl: normalized.submittedUrl,
    summary: "Automatic onboarding could not confirm a supported inventory source. Manual review is required.",
  };
}
