const DEFAULT_MIN_VEHICLE_PRICE = 500;
const DEFAULT_MAX_VEHICLE_PRICE = 10_000_000;
const MIN_CENTS_NORMALIZATION_VALUE = 500_000;

const PRIMARY_PRICE_CONTEXT_PATTERNS = [
  /\b(?:our|sale|selling|special|dealer|internet|advertised|asking|buy now|e-?price)\s+price\b/i,
  /\bprice\b/i,
] as const;

const SECONDARY_PRICE_CONTEXT_PATTERNS = [
  /\b(?:msrp|list price|retail price)\b/i,
] as const;

const NEGATIVE_PRICE_CONTEXT_PATTERNS = [
  /\b(?:save|savings|rebate|discount|bonus cash|off msrp)\b/i,
  /\b(?:lease|finance|payment|due at signing|down payment|monthly|per month|\/mo\b|weekly|bi-?weekly|apr)\b/i,
] as const;

type VehiclePriceOptions = {
  allowCentNormalization?: boolean;
  maximum?: number;
  minimum?: number;
};

function withCentNormalization(
  options: VehiclePriceOptions | undefined,
  allowCentNormalization: boolean,
): VehiclePriceOptions {
  return {
    ...options,
    allowCentNormalization,
  };
}

function parseLooseCurrencyNumber(value: string) {
  const compact = value.replace(/\s+/g, "").replace(/[^\d.,]/g, "");
  if (!compact) {
    return null;
  }

  const normalized = compact.includes(".")
    ? /\.\d{1,2}$/.test(compact)
      ? compact.replace(/,/g, "")
      : compact.replace(/[.,]/g, "")
    : compact.replace(/,/g, "");

  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeVehiclePriceInternal(
  value: number | null | undefined,
  options?: VehiclePriceOptions,
) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const minimum = options?.minimum ?? DEFAULT_MIN_VEHICLE_PRICE;
  const maximum = options?.maximum ?? DEFAULT_MAX_VEHICLE_PRICE;
  const rounded = Math.round(value);

  if (
    options?.allowCentNormalization !== false &&
    rounded >= MIN_CENTS_NORMALIZATION_VALUE &&
    rounded % 100 === 0
  ) {
    const centsAdjusted = Math.round(rounded / 100);
    if (centsAdjusted >= minimum && centsAdjusted <= maximum) {
      return centsAdjusted;
    }
  }

  if (rounded >= minimum && rounded <= maximum) {
    return rounded;
  }

  return null;
}

function hasNegativePriceContext(value: string) {
  return NEGATIVE_PRICE_CONTEXT_PATTERNS.some((pattern) => pattern.test(value));
}

function scorePositivePriceContext(value: string) {
  if (PRIMARY_PRICE_CONTEXT_PATTERNS.some((pattern) => pattern.test(value))) {
    return 120;
  }

  if (SECONDARY_PRICE_CONTEXT_PATTERNS.some((pattern) => pattern.test(value))) {
    return 70;
  }

  return 0;
}

export function normalizeVehiclePrice(
  value: number | null | undefined,
  options?: VehiclePriceOptions,
) {
  return normalizeVehiclePriceInternal(value, options);
}

export function extractVehiclePriceFromText(
  value: string | null | undefined,
  options?: VehiclePriceOptions,
) {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) {
    return null;
  }

  const matches = text.matchAll(/\$?\s*\d[\d,\s]*(?:\.\d{1,2})?/g);
  const candidates: Array<{ amount: number; index: number; score: number }> = [];

  for (const match of matches) {
    const raw = match[0]?.trim();
    if (!raw || raw.replace(/[^\d]/g, "").length < 3) {
      continue;
    }

    const startIndex = match.index ?? 0;
    const precedingContext = text
      .slice(Math.max(0, startIndex - 36), startIndex)
      .toLowerCase();
    const followingContext = text
      .slice(startIndex + raw.length, Math.min(text.length, startIndex + raw.length + 24))
      .toLowerCase();

    const positiveScore = scorePositivePriceContext(precedingContext);
    const negativeContext =
      hasNegativePriceContext(precedingContext) || hasNegativePriceContext(followingContext);

    if (!raw.includes("$") && positiveScore === 0) {
      continue;
    }

    if (negativeContext && positiveScore === 0) {
      continue;
    }

    const parsed = normalizeVehiclePriceInternal(
      parseLooseCurrencyNumber(raw),
      withCentNormalization(options, false),
    );
    if (parsed === null) {
      continue;
    }

    let score = raw.includes("$") ? 20 : 0;
    score += positiveScore;
    if (negativeContext) {
      score -= 80;
    }

    candidates.push({
      amount: parsed,
      index: startIndex,
      score,
    });
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.index - right.index;
  });

  return candidates[0]?.amount ?? null;
}

export function parseVehiclePrice(
  value: number | string | null | undefined,
  options?: VehiclePriceOptions,
) {
  if (typeof value === "number") {
    return normalizeVehiclePriceInternal(value, options);
  }

  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) {
    return null;
  }

  if (/^[\s$]*\d[\d,\s.]*(?:\.\d{1,2})?[\s$]*$/i.test(text)) {
    const direct = normalizeVehiclePriceInternal(
      parseLooseCurrencyNumber(text),
      withCentNormalization(options, !/[$,.]/.test(text)),
    );
    if (direct !== null) {
      return direct;
    }
  }

  return extractVehiclePriceFromText(text, options);
}
