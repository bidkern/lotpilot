const SENSITIVE_PATTERNS = [
  {
    placeholder: "[REDACTED_SSN]",
    regex: /\b\d{3}-?\d{2}-?\d{4}\b/g,
  },
  {
    placeholder: "[REDACTED_CARD]",
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
  },
] as const;

export function redactSensitiveText(value: string | null | undefined) {
  if (!value) {
    return value ?? null;
  }

  return SENSITIVE_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern.regex, pattern.placeholder),
    value,
  );
}

export function redactSensitiveValue<T>(value: T): T {
  if (typeof value === "string") {
    return redactSensitiveText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValue(entry)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        redactSensitiveValue(nestedValue),
      ]),
    ) as T;
  }

  return value;
}
