const FAMILYSEARCH_PERSON_DETAILS_BASE_URL = 'https://www.familysearch.org/en/tree/person/details/';
const FAMILYSEARCH_PERSON_ROUTE_PATTERN =
  /\/tree\/person\/(?:(?:details|about|timeline|sources|memories|ordinances|collaborate|vitals|non-vitals|family)\/)?([A-Z0-9]{4}-[A-Z0-9]{3})(?:[/?#]|$)/i;

export function buildFamilySearchPersonDetailsUrl(personId: string): string {
  return `${FAMILYSEARCH_PERSON_DETAILS_BASE_URL}${normalizeFamilySearchPersonId(personId)}`;
}

export function extractFamilySearchPersonIdFromUrl(url: string): string | null {
  const match = String(url).match(FAMILYSEARCH_PERSON_ROUTE_PATTERN);
  return match?.[1] ? normalizeFamilySearchPersonId(match[1]) : null;
}

export function isFamilySearchPersonUrl(url: string): boolean {
  return Boolean(extractFamilySearchPersonIdFromUrl(url));
}

export function normalizeFamilySearchPersonId(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9-]+$/.test(normalized) ? normalized : '';
}
