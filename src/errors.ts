export class InjectionError extends Error {
  name = 'InjectionError';

  constructor(
    public readonly path: (string | number | symbol)[],
    public readonly cause: unknown,
  ) {
    super(`Injection error for ${path.join(' -> ')}: ${errorToString(cause)}`);
  }
}

export class StartError extends Error {
  name = 'StartError';

  constructor(
    public readonly key: string | number | symbol | undefined,
    public readonly instance: unknown,
    public readonly cause: unknown,
  ) {
    super(`Start error${key !== undefined ? ` for ${String(key)}` : ''}: ${errorToString(cause)}`);
  }
}

export class DisposeError extends Error {
  name = 'DisposeError';

  constructor(
    public readonly errors: {
      key?: string | number | symbol;
      instance: unknown;
      cause: unknown;
    }[],
  ) {
    super(
      `${errors.length} error(s) during dispose: ${errors
        .map(
          ({ key, cause }) =>
            `Injection error${key !== undefined ? ` for ${String(key)}` : ''}: ${errorToString(cause)}`,
        )
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
