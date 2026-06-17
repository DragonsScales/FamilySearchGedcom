export type ChromeStorageKeyRequest = string | string[] | Record<string, unknown> | null;

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

export interface ChromeStorageRoot {
  local: ChromeStorageArea;
}

export interface ChromeStorageApi {
  runtime?: ChromeRuntimeApi;
  storage?: ChromeStorageRoot;
}
