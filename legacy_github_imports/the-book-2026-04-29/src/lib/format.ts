export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCurrency(cents: number) {
  return currencyFormatter.format(cents / 100);
}

export function formatMileage(miles: number) {
  return `${compactNumberFormatter.format(miles).replace(".0", "")} mi`;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatRelativeFromNow(value: string) {
  const target = new Date(value).getTime();
  const deltaMinutes = Math.round((target - Date.now()) / 60000);
  const absMinutes = Math.abs(deltaMinutes);

  if (absMinutes < 60) {
    return deltaMinutes >= 0 ? `in ${absMinutes}m` : `${absMinutes}m ago`;
  }

  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) {
    return deltaMinutes >= 0 ? `in ${absHours}h` : `${absHours}h ago`;
  }

  const absDays = Math.round(absHours / 24);
  if (absDays >= 7) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  }

  return deltaMinutes >= 0 ? `in ${absDays}d` : `${absDays}d ago`;
}

export function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}
