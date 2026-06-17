export function normalizeFamilySearchIdInput(value: string): string {
  const compact = value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 7);
  if (compact.length <= 4) return compact;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

export function isValidFamilySearchId(value: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{3}$/.test(value);
}
