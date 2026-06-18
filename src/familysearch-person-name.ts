const FAMILYSEARCH_PERSON_ID_PATTERN = /\b[A-Z0-9]{4}-[A-Z0-9]{3}\b/i;
const FAMILYSEARCH_PERSON_LIFE_DATE_SOURCE = '(?:(?:\\d{1,2}\\s+)?[A-Za-z.]+\\s+)*\\d{3,4}';
const FAMILYSEARCH_PERSON_LIFE_ENDPOINT_SOURCE = `(?:${FAMILYSEARCH_PERSON_LIFE_DATE_SOURCE}|Living|Deceased)`;
const FAMILYSEARCH_PERSON_LIFE_DETAIL_SOURCE =
  `(?:Living|Deceased|${FAMILYSEARCH_PERSON_LIFE_DATE_SOURCE}\\s*[\\u2013-]\\s*${FAMILYSEARCH_PERSON_LIFE_ENDPOINT_SOURCE}?|[\\u2013-]\\s*${FAMILYSEARCH_PERSON_LIFE_ENDPOINT_SOURCE})`;
const FAMILYSEARCH_PERSON_LIFE_DETAIL_PATTERN = new RegExp(`^${FAMILYSEARCH_PERSON_LIFE_DETAIL_SOURCE}$`, 'i');
const FAMILYSEARCH_PERSON_HEADING_TRAILER_PATTERN = new RegExp(
  `\\s+(?:Male|Female|Unknown)\\s+${FAMILYSEARCH_PERSON_LIFE_DETAIL_SOURCE}\\s+\\u2022\\s+[A-Z0-9]{4}-[A-Z0-9]{3}$`,
  'i'
);
const FAMILYSEARCH_PERSON_GENDER_LIFE_TRAILER_PATTERN = new RegExp(
  `\\s+(?:Male|Female|Unknown)\\s+${FAMILYSEARCH_PERSON_LIFE_DETAIL_SOURCE}$`,
  'i'
);
const FAMILYSEARCH_PERSON_GENDER_TRAILER_PATTERN = /\s+(?:Male|Female|Unknown)\s+.+$/i;
const FAMILYSEARCH_NON_PERSON_NAME_PATTERN =
  /^(Male|Female|Unknown|Living|Deceased|Preferred|Not Preferred|Family Tree|Search|Memories|Get Involved|Activities|Temple|Tree|Recents|Find|Following|Person List|My Contributions|Manage Trees|Help Others|View Tree|View Relationship|Follow|About|Vitals|Other|Family|Sources(?: \(\d+\))?|Collaborate(?: \(\d+\))?|Memories(?: \(\d+\))?|Time Line|Ordinances|Detail View|Other Information|Alternate Names|Events|Facts|Family Members|Show All Family Members|Spouses and Children|Parents and Siblings|Other Relationships|Brief Life History|Children(?: \(\d+\))?|Parents|Siblings|Spouses|Add|Add Event|Add Fact|Add Alternate Name|Add Child|Add Spouse|Add Parent|Add Other Relationship)$/i;

export function cleanFamilySearchPersonName(value: string): string {
  return cleanFamilySearchNameText(value)
    .replace(/^Value:\s*/i, '')
    .replace(FAMILYSEARCH_PERSON_HEADING_TRAILER_PATTERN, '')
    .replace(FAMILYSEARCH_PERSON_GENDER_LIFE_TRAILER_PATTERN, '')
    .replace(FAMILYSEARCH_PERSON_GENDER_TRAILER_PATTERN, '')
    .replace(/\s+\u2022\s+[A-Z0-9]{4}-[A-Z0-9]{3}$/i, '')
    .replace(/\s+[A-Z0-9]{4}-[A-Z0-9]{3}$/i, '')
    .replace(/\s+\u2022\s*$/i, '')
    .trim();
}

export function findUsableFamilySearchPersonName(candidates: readonly (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const cleaned = cleanFamilySearchPersonName(candidate ?? '');
    if (looksLikeFamilySearchPersonName(cleaned)) return cleaned;
  }

  return '';
}

export function looksLikeFamilySearchPersonName(value: string): boolean {
  const cleaned = cleanFamilySearchPersonName(value);
  if (!cleaned || cleaned.length < 2 || cleaned.length > 80) return false;
  if (FAMILYSEARCH_NON_PERSON_NAME_PATTERN.test(cleaned)) return false;
  if (isFamilySearchPersonLifeDetail(cleaned)) return false;
  if (FAMILYSEARCH_PERSON_ID_PATTERN.test(cleaned)) return false;
  if (/\d/.test(cleaned)) return false;
  return /[A-Za-z]/.test(cleaned);
}

export function isFamilySearchPersonLifeDetail(value: string): boolean {
  return FAMILYSEARCH_PERSON_LIFE_DETAIL_PATTERN.test(cleanFamilySearchNameText(value));
}

function cleanFamilySearchNameText(value: string): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
