export type ApiErrorKind =
  | 'unauthorized'
  | 'notFound'
  | 'badRequest'
  | 'server'
  | 'network';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;

  constructor(kind: ApiErrorKind, message?: string, status?: number) {
    super(message ?? kind);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    let detail: string | undefined;
    try {
      const data = await response.json();
      detail = typeof data?.error === 'string' ? data.error : data?.message;
    } catch {
      // Response body may not be JSON.
    }

    const kind = statusToKind(response.status);
    return new ApiError(kind, detail ?? response.statusText, response.status);
  }

  static network(cause?: unknown): ApiError {
    const message =
      cause instanceof Error ? cause.message : 'Network request failed';
    const error = new ApiError('network', message);
    if (cause instanceof Error) {
      error.cause = cause;
    }
    return error;
  }
}

function statusToKind(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'notFound';
  if (status >= 400 && status < 500) return 'badRequest';
  return 'server';
}

export function getUserMessage(kind: ApiErrorKind): string {
  switch (kind) {
    case 'unauthorized':
      return 'Your session has expired. Please sign in again.';
    case 'notFound':
      return "We couldn't find what you're looking for. It may have been moved or deleted.";
    case 'badRequest':
      return 'Something was wrong with your request. Please check your input and try again.';
    case 'network':
      return "We couldn't reach the server. Please try again shortly.";
    case 'server':
    default:
      return 'Something went wrong on our end. Please try again shortly.';
  }
}

export function handleApiError(
  error: unknown,
  notify: (message: string) => void,
  signIn?: () => void
): void {
  console.error(error);

  const kind = error instanceof ApiError ? error.kind : 'server';
  notify(getUserMessage(kind));

  if (kind === 'unauthorized' && signIn) {
    setTimeout(() => signIn(), 1500);
  }
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  try {
    const response = await fetch(input, init);
    if (!response.ok) {
      throw await ApiError.fromResponse(response);
    }
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw ApiError.network(error);
  }
}
