import type { ExportFormat, Vehicle, VehicleCondition } from "@prisma/client";

type VehicleLike = Pick<
  Vehicle,
  | "bodyStyle"
  | "condition"
  | "description"
  | "detailPageUrl"
  | "drivetrain"
  | "engine"
  | "exteriorColor"
  | "fuelType"
  | "interiorColor"
  | "make"
  | "mileage"
  | "model"
  | "price"
  | "primaryImageUrl"
  | "sourceUrl"
  | "stockNumber"
  | "title"
  | "transmission"
  | "trim"
  | "vin"
  | "year"
>;

function labelCondition(condition: VehicleCondition) {
  switch (condition) {
    case "NEW":
      return "New";
    case "CPO":
      return "Certified Pre-Owned";
    default:
      return "Used";
  }
}

export function formatCurrency(value: number | null | undefined) {
  if (!value) {
    return "Call for price";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

export function formatDateLabel(value: Date | string | null | undefined) {
  if (!value) {
    return "Never";
  }

  const date = value instanceof Date ? value : new Date(value);

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US").format(value);
}

export function buildMarketplaceTitle(vehicle: VehicleLike) {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function buildMarketplaceDescription(vehicle: VehicleLike) {
  const lines = [
    buildMarketplaceTitle(vehicle) || vehicle.title,
    `Condition: ${labelCondition(vehicle.condition)}`,
    `Price: ${formatCurrency(vehicle.price)}`,
    vehicle.mileage ? `Mileage: ${formatNumber(vehicle.mileage)} miles` : null,
    vehicle.bodyStyle ? `Body Style: ${vehicle.bodyStyle}` : null,
    vehicle.drivetrain ? `Drivetrain: ${vehicle.drivetrain}` : null,
    vehicle.engine ? `Engine: ${vehicle.engine}` : null,
    vehicle.transmission ? `Transmission: ${vehicle.transmission}` : null,
    vehicle.exteriorColor ? `Exterior: ${vehicle.exteriorColor}` : null,
    vehicle.interiorColor ? `Interior: ${vehicle.interiorColor}` : null,
    vehicle.stockNumber ? `Stock #: ${vehicle.stockNumber}` : null,
    vehicle.vin ? `VIN: ${vehicle.vin}` : null,
    "",
    vehicle.description?.trim() || "See the source listing for the full description.",
    "",
    `Source listing: ${vehicle.detailPageUrl || vehicle.sourceUrl}`,
  ];

  return lines.filter(Boolean).join("\n").trim();
}

export function isMarketplaceReady(vehicle: VehicleLike) {
  return Boolean(
    vehicle.primaryImageUrl &&
      buildMarketplaceTitle(vehicle) &&
      vehicle.price &&
      vehicle.description,
  );
}

export function toMarketplaceRow(vehicle: VehicleLike) {
  return {
    VIN: vehicle.vin ?? "",
    "Stock Number": vehicle.stockNumber ?? "",
    Title: buildMarketplaceTitle(vehicle) || vehicle.title,
    Description: buildMarketplaceDescription(vehicle),
    Condition: labelCondition(vehicle.condition),
    Price: vehicle.price ?? "",
    Year: vehicle.year ?? "",
    Make: vehicle.make ?? "",
    Model: vehicle.model ?? "",
    Trim: vehicle.trim ?? "",
    Mileage: vehicle.mileage ?? "",
    "Exterior Color": vehicle.exteriorColor ?? "",
    "Interior Color": vehicle.interiorColor ?? "",
    "Body Style": vehicle.bodyStyle ?? "",
    Drivetrain: vehicle.drivetrain ?? "",
    "Fuel Type": vehicle.fuelType ?? "",
    Engine: vehicle.engine ?? "",
    Transmission: vehicle.transmission ?? "",
    "Source URL": vehicle.detailPageUrl || vehicle.sourceUrl,
    "Primary Image URL": vehicle.primaryImageUrl ?? "",
    Workflow:
      "Supported workflow: review this export, then manually publish in downstream listing tools.",
  };
}

function escapeCsv(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeMarketplaceExport(vehicles: VehicleLike[], format: ExportFormat) {
  const rows = vehicles.map(toMarketplaceRow);

  if (format === "JSON") {
    return JSON.stringify(rows, null, 2);
  }

  const headers = Object.keys(rows[0] ?? {});
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => escapeCsv(row[header as keyof typeof row])).join(","),
    ),
  ].join("\n");
}
