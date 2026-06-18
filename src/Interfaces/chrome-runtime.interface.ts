export interface ChromeRuntimeReloadApi {
  runtime?: {
    reload(): void;
  };
}

export interface ChromeRuntimeMessageResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface ChromeRuntimeMessageApi {
  runtime?: {
    lastError?: {
      message?: string;
    };
    sendMessage(message: unknown, callback: (response: ChromeRuntimeMessageResponse) => void): void;
  };
}
