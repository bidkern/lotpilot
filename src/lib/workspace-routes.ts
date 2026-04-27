function compactSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 48);
}

export function buildTenantPathSegment(value: string | null | undefined) {
  return compactSlug(value ?? "") || "workspace";
}

export function buildUserPathSegment(input: {
  email?: string | null;
  id?: string | null;
  name?: string | null;
}) {
  const preferred = compactSlug(input.name ?? "");
  if (preferred) {
    return preferred;
  }

  const emailLocalPart = compactSlug(input.email?.split("@")[0] ?? "");
  if (emailLocalPart) {
    return emailLocalPart;
  }

  return compactSlug(input.id ?? "") || "user";
}

export function buildUserMessagesPath(input: {
  tenantName?: string | null;
  userEmail?: string | null;
  userId?: string | null;
  userName?: string | null;
}) {
  const tenantSlug = buildTenantPathSegment(input.tenantName);
  const userSlug = buildUserPathSegment({
    email: input.userEmail,
    id: input.userId,
    name: input.userName,
  });

  return `/${tenantSlug}/${userSlug}/messages`;
}
