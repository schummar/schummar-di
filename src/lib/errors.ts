export class InjectionError extends Error {
  name = 'InjectionError';

  constructor(
    public readonly path: (string | number | symbol)[],
    cause?: unknown,
  ) {
    super(
      `Injection error for ${path.join(' -> ')}: ${errorToString(cause)}`,
      cause !== undefined ? { cause } : undefined,
    );
  }
}

export class CircularDependencyError extends InjectionError {
  name = 'CircularDependencyError';

  constructor(path: (string | number | symbol)[]) {
    super(path);
    this.message = `Circular dependency detected: ${path.join(' -> ')}. Access the dependency after the constructor to avoid this error.`;
  }
}

export class ServiceNotFoundError extends InjectionError {
  name = 'ServiceNotFoundError';

  constructor(path: (string | number | symbol)[], key: string | number | symbol, index?: number) {
    super(path);
    this.message = `Service not found: ${String(key)}${index !== undefined ? `[${index}]` : ''}.`;
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
        .map(({ key, cause }) => `Error${key !== undefined ? ` for ${String(key)}` : ''}: ${errorToString(cause)}`)
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

  if (typeof error === 'object' && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      // fall back to default string representation
    }
  }

  return String(error);
}
