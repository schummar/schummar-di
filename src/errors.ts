export class InjectionError extends Error {
  name = 'InjectionError';

  constructor(
    public readonly path: (string | number | symbol)[],
    public readonly cause: unknown,
  ) {
    super(`Injection error for ${path.join(' -> ')}: ${errorToString(cause)}`);
  }
}

export class DisposeError extends Error {
  name = 'DisposeError';

  constructor(
    public readonly errors: {
      key: string | number | symbol;
      instance: unknown;
      cause: unknown;
    }[],
  ) {
    super(
      `${errors.length} error(s) during dispose: ${errors
        .map(({ key, cause }) => `Injection error for ${String(key)}: ${errorToString(cause)}`)
        .join(', ')}`,
    );
  }
}

function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    return JSON.stringify(error);
  }

  return String(error);
}
