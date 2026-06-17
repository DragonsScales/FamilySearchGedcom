export interface CardSettings {
  relationshipsOpen: boolean;
  residencesOpen: boolean;
  otherOpen: boolean;
}

export type CardSettingKey = keyof CardSettings;

export interface CardSettingChange {
  setting: CardSettingKey;
  open: boolean;
}
