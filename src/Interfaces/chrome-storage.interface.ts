export type ChromeStorageKeyRequest = string | string[] | Record<string, unknown> | null;

export interface ChromeStorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export type ChromeStorageChangeCallback = (
  changes: Record<string, ChromeStorageChange>,
  areaName: string
) => void;

export interface ChromeRuntimeError {
  message?: string;
}

export interface ChromeRuntimeApi {
  lastError?: ChromeRuntimeError;
}

export interface ChromeStorageArea {
  get(keys: ChromeStorageKeyRequest, callback: (items: Record<string, unknown>) => void): void;
  set(items: Record<string, unknown>, callback?: () => void): void;
  remove(keys: string | string[], callback?: () => void): void;
}

export interface ChromeStorageChangedEvent {
  addListener(callback: ChromeStorageChangeCallback): void;
  removeListener(callback: ChromeStorageChangeCallback): void;
}

export interface ChromeStorageRoot {
  local: ChromeStorageArea;
  onChanged?: ChromeStorageChangedEvent;
}

export interface ChromeStorageApi {
  runtime?: ChromeRuntimeApi;
  storage?: ChromeStorageRoot;
}
