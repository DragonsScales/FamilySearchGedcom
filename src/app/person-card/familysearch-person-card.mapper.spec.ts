import type {
  FamilySearchRetrievedPerson
} from '../../Interfaces/familysearch-person.interface';
import {
  buildFamilySearchPersonCard
} from './familysearch-person-card.mapper';

describe('buildFamilySearchPersonCard', () => {
  it('uses the captured Name fact before a noisy display heading', () => {
    const person: FamilySearchRetrievedPerson = {
      familySearchId: '9NVP-WZP',
      displayName: 'Frank Richard Wilson Male September 1886 \u2013 Deceased',
      url: 'https://www.familysearch.org/en/tree/person/details/9NVP-WZP',
      title: 'Frank Richard Wilson (1886\u2013Deceased) \u2022 Person \u2022 Family Tree',
      capturedAt: '2026-06-18T16:46:14.831Z',
      facts: [
        {
          type: 'Name',
          values: ['Value: Frank Richard Wilson'],
          rawText: 'Name \u2022 6 Sources | Frank Richard Wilson'
        },
        {
          type: 'Sex',
          values: ['Value: Male'],
          rawText: 'Sex \u2022 6 Sources | Male'
        }
      ],
      relationships: []
    };

    expect(buildFamilySearchPersonCard(person).name).toBe('Frank Richard Wilson');
  });

  it('formats current custom events as named values instead of duplicate date/value text', () => {
    const card = buildFamilySearchPersonCard(personWithFacts([
      {
        type: 'Custom Event',
        values: ['Type: Education', 'Value: Whole-Time'],
        rawText: 'Custom Event \u2022 1 Source | Education | Whole-Time'
      }
    ]));

    expect(card.otherFacts).toEqual([
      {
        type: 'Custom Event',
        label: 'Education',
        value: 'Whole-Time',
        notes: ['Custom Event \u2022 1 Source | Education | Whole-Time']
      }
    ]);
  });

  it('repairs legacy custom events where non-date values were captured as dates', () => {
    const card = buildFamilySearchPersonCard(personWithFacts([
      {
        type: 'Custom Event',
        values: ['Value: Education', 'Date: Whole-Time'],
        rawText: 'Custom Event \u2022 1 Source | Education | Whole-Time'
      }
    ]));

    expect(card.otherFacts).toEqual([
      {
        type: 'Custom Event',
        label: 'Education',
        value: 'Whole-Time',
        notes: ['Custom Event \u2022 1 Source | Education | Whole-Time']
      }
    ]);
  });

  it('formats value-only FamilySearch facts without treating their value as a date', () => {
    const card = buildFamilySearchPersonCard(personWithFacts([
      {
        type: 'Occupation',
        values: ['Date: Farmer'],
        rawText: 'Occupation \u2022 1 Source | Farmer'
      }
    ]));

    expect(card.otherFacts).toEqual([
      {
        type: 'Occupation',
        label: 'Occupation',
        value: 'Farmer',
        notes: ['Occupation \u2022 1 Source | Farmer']
      }
    ]);
  });
});

function personWithFacts(facts: FamilySearchRetrievedPerson['facts']): FamilySearchRetrievedPerson {
  return {
    familySearchId: '9NVP-WZP',
    displayName: 'Frank Richard Wilson',
    url: 'https://www.familysearch.org/en/tree/person/details/9NVP-WZP',
    title: 'Frank Richard Wilson (1886\u2013Deceased) \u2022 Person \u2022 Family Tree',
    capturedAt: '2026-06-18T16:46:14.831Z',
    facts,
    relationships: []
  };
}
