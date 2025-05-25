export interface BackgroundService {
  start(): void;
}

export type LifeCycle = 'singleton' | 'transient' | 'background';

export type Implementation<Context, T> = ((context: Context) => T) | (new (context: Context) => T) | T;

export interface Service<Context, T> {
  service: Implementation<Context, T>;
  lifeCycle: LifeCycle;
}

export type ServiceMap<Context> = {
  [K in keyof Context]: Implementation<Context, Context[K]> | Service<Context, Context[K]>;
};

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

export function createContext<Context extends object>(
  serviceMap: ServiceMap<Context> & Record<string, Implementation<Context, unknown>>,
) {
  const services = new Map<keyof Context, Service<Context, unknown>>();
  const instances: Partial<Context> = {};
  const disposables = new Map<Disposable | AsyncDisposable, string | number | symbol>();
  const resolving = new Set<keyof Context>();

  for (const key of Reflect.ownKeys(serviceMap)) {
    const value = serviceMap[key as keyof Context];
    const service =
      typeof value === 'object' && value !== null && 'service' in value && 'lifeCycle' in value
        ? value
        : { service: value, lifeCycle: 'singleton' };

    services.set(key as keyof Context, service as Service<Context, unknown>);
  }

  const context = new Proxy<Context>(instances as any, {
    get(_target, p) {
      return resolve(p as keyof Context);
    },
  });

  function build<T>(implementation: Implementation<Context, T>): T {
    if (typeof implementation === 'function') {
      try {
        return (implementation as (context: Context) => T)(context);
      } catch (error) {
        if (error instanceof TypeError && error.message.includes(`cannot be invoked without 'new'`)) {
          return new (implementation as new (context: Context) => T)(context);
        }

        throw error;
      }
    } else {
      return implementation;
    }
  }

  function resolve<Key extends keyof Context>(key: Key): Context[Key] {
    const entry = services.get(key);

    if (!entry) {
      throw new Error(`Service ${String(key)} not found`);
    }

    const { service, lifeCycle } = entry;

    if (lifeCycle !== 'transient' && key in instances) {
      return instances[key] as Context[Key];
    }

    if (resolving.has(key)) {
      throw new Error(
        `Circular dependency detected: ${[...resolving].join(' -> ')} -> ${String(key)}. Access the context after the constructor to avoid this error.`,
      );
    }

    try {
      resolving.add(key);

      const instance = build(service) as Context[Key];

      if (lifeCycle === 'singleton') {
        instances[key] = instance;
      }

      if (isDisposable(instance)) {
        disposables.set(instance, key);
      }

      return instance;
    } catch (error) {
      if (error instanceof InjectionError) {
        throw error;
      }

      throw new InjectionError([...resolving], error);
    } finally {
      resolving.delete(key);
    }
  }

  for (const [key, entry] of services) {
    if (entry.lifeCycle === 'background') {
      const instance = resolve(key);
      if (
        typeof instance === 'object' &&
        instance !== null &&
        'start' in instance &&
        typeof instance.start === 'function'
      ) {
        instance.start();
      }
    }
  }

  return {
    resolve<Key extends keyof Context>(key: Key): Context[Key] {
      return resolve(key);
    },

    inject<T>(implementation: Implementation<Context, T>) {
      return build(implementation);
    },

    async dispose() {
      const promises: Promise<void>[] = [];
      const errors: DisposeError['errors'] = [];

      for (const [disposable, key] of disposables) {
        if (Symbol.dispose in disposable) {
          try {
            disposable[Symbol.dispose]();
          } catch (error) {
            errors.push({ key, instance: disposable, cause: error });
          }
        }

        if (Symbol.asyncDispose in disposable) {
          promises.push(
            (async () => {
              try {
                await (disposable as AsyncDisposable)[Symbol.asyncDispose]();
              } catch (error) {
                errors.push({ key, instance: disposable, cause: error });
              }
            })(),
          );
        }
      }

      await Promise.all(promises);

      if (errors.length > 0) {
        throw new DisposeError(errors);
      }
    },
  };
}

export function singleton<Context, T>(implementation: Implementation<Context, T>): Service<Context, T> {
  return {
    service: implementation,
    lifeCycle: 'singleton',
  };
}

export function transient<Context, T>(implementation: Implementation<Context, T>): Service<Context, T> {
  return {
    service: implementation,
    lifeCycle: 'transient',
  };
}

export function background<Context, T extends BackgroundService>(
  implementation: Implementation<Context, T>,
): Service<Context, T> {
  return {
    service: implementation,
    lifeCycle: 'background' as LifeCycle,
  };
}

function isDisposable(obj: unknown): obj is Disposable | AsyncDisposable {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    ((Symbol.dispose && Symbol.dispose in obj) || (Symbol.asyncDispose && Symbol.asyncDispose in obj))
  );
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
