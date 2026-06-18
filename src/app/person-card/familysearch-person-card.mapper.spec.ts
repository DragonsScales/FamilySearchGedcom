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
});
