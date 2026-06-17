import type { CardSettingKey } from '../../Interfaces/card-settings.interface';
import type {
  CardSectionOverrides,
  SectionKey
} from '../../Interfaces/person-card.interface';

export function clearOverridesForSetting(
  overrides: CardSectionOverrides,
  setting: CardSettingKey
): CardSectionOverrides {
  const sectionsToClear: SectionKey[] = setting === 'relationshipsOpen'
    ? ['parentsOpen', 'childrenOpen', 'siblingsOpen']
    : setting === 'residencesOpen'
      ? ['residencesOpen']
      : ['otherOpen'];

  return Object.fromEntries(
    Object.entries(overrides)
      .map(([personId, personOverrides]) => {
        const nextOverrides = { ...personOverrides };
        for (const section of sectionsToClear) delete nextOverrides[section];
        return [personId, nextOverrides] as const;
      })
      .filter(([, personOverrides]) => Object.keys(personOverrides).length > 0)
  );
}
