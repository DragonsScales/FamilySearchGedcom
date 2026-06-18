import {
  cleanFamilySearchPersonName,
  findUsableFamilySearchPersonName,
  looksLikeFamilySearchPersonName
} from './familysearch-person-name';

describe('FamilySearch person name helpers', () => {
  it('strips gender and month-year lifespan trailers from person headings', () => {
    expect(cleanFamilySearchPersonName('Frank Richard Wilson Male September 1886 \u2013 Deceased'))
      .toBe('Frank Richard Wilson');
  });

  it('strips any trailing packed header content after a gender marker', () => {
    expect(cleanFamilySearchPersonName('Frank Richard Wilson Male unexpected header content'))
      .toBe('Frank Richard Wilson');
  });

  it('strips full person heading trailers with an id', () => {
    expect(cleanFamilySearchPersonName('Barbara Helen Sheppard Female 12 May 1919 \u2013 August 2000 \u2022 GXRX-5XD'))
      .toBe('Barbara Helen Sheppard');
  });

  it('rejects numeric and label-like name candidates', () => {
    expect(looksLikeFamilySearchPersonName('Frank Richard Wilson 1886')).toBe(false);
    expect(looksLikeFamilySearchPersonName('Preferred')).toBe(false);
  });

  it('finds the first clean usable person name candidate', () => {
    expect(findUsableFamilySearchPersonName([
      'Preferred',
      'Frank Richard Wilson Male September 1886 \u2013 Deceased'
    ])).toBe('Frank Richard Wilson');
  });
});
