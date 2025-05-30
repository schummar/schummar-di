import { DisposeError, InjectionError } from './errors';

export interface BackgroundService {
  start(): void;
}

export type LifeCycle = 'singleton' | 'transient' | 'background';

export type Service<TDeps, TInstance> = ((deps: TDeps) => TInstance) | (new (deps: TDeps) => TInstance) | TInstance;

export interface ServiceEntry<TDeps, TInstance> {
  service: Service<TDeps, TInstance>;
  lifeCycle: LifeCycle;
}

export type ServiceMap<TServices> = {
  [K in keyof TServices]: Service<TServices, TServices[K]> | ServiceEntry<TServices, TServices[K]>;
};

export function createContainer<TServices extends object>(services: ServiceMap<TServices>): Container<TServices> {
  return new Container(services);
}

export class Container<TServices extends object> implements AsyncDisposable {
  private services: Map<keyof TServices, ServiceEntry<TServices, unknown>>;
  private instances = new Map<keyof TServices, TServices[keyof TServices]>();
  private resolving = new Set<keyof TServices>();
  private disposables = new Map<Disposable | AsyncDisposable, string | number | symbol>();

  constructor(services: ServiceMap<TServices>) {
    this.services = new Map<keyof TServices, ServiceEntry<TServices, unknown>>(
      Reflect.ownKeys(services).map((key) => {
        const value = services[key as keyof TServices];
        const service =
          typeof value === 'object' && value !== null && 'service' in value && 'lifeCycle' in value
            ? value
            : { service: value, lifeCycle: 'singleton' };

        return [key as keyof TServices, service as ServiceEntry<TServices, unknown>];
      }),
    );

    for (const [key, entry] of this.services) {
      if (entry.lifeCycle === 'background') {
        const instance = this.resolve(key);
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
  }

  inject<T>(implementation: Service<TServices, T>): T {
    const resolvedServices = new Map<keyof TServices, TServices[keyof TServices]>();

    const resolver = new Proxy<TServices>({} as any, {
      get: (_target, p) => {
        let service = resolvedServices.get(p as keyof TServices);
        if (!service) {
          service = this.resolve(p as keyof TServices);
          resolvedServices.set(p as keyof TServices, service);
        }

        return service;
      },
    });

    if (typeof implementation === 'function') {
      try {
        return (implementation as (deps: TServices) => T)(resolver);
      } catch (error) {
        if (error instanceof TypeError && error.message.includes(`cannot be invoked without 'new'`)) {
          return new (implementation as new (deps: TServices) => T)(resolver);
        }

        throw error;
      }
    } else {
      return implementation;
    }
  }

  resolve<Key extends keyof TServices>(key: Key): TServices[Key] {
    const entry = this.services.get(key);

    if (!entry) {
      throw new Error(`Service ${String(key)} not found`);
    }

    const { service, lifeCycle } = entry;

    if (lifeCycle !== 'transient' && this.instances.has(key)) {
      return this.instances.get(key) as TServices[Key];
    }

    if (this.resolving.has(key)) {
      throw new Error(
        `Circular dependency detected: ${[...this.resolving].join(' -> ')} -> ${String(key)}. Access the dependency after the constructor to avoid this error.`,
      );
    }

    try {
      this.resolving.add(key);

      const instance = this.inject(service) as TServices[Key];

      if (lifeCycle !== 'transient') {
        this.instances.set(key, instance);
      }

      if (isDisposable(instance)) {
        this.disposables.set(instance, key);
      }

      return instance;
    } catch (error) {
      if (error instanceof InjectionError) {
        throw error;
      }

      throw new InjectionError([...this.resolving], error);
    } finally {
      this.resolving.delete(key);
    }
  }

  async [Symbol.asyncDispose]() {
    const promises: Promise<void>[] = [];
    const errors: DisposeError['errors'] = [];

    for (const [disposable, key] of this.disposables) {
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

    this.instances.clear();
    this.disposables.clear();

    await Promise.all(promises);

    if (errors.length > 0) {
      throw new DisposeError(errors);
    }
  }
}

export function singleton<TDeps, TInstance>(service: Service<TDeps, TInstance>): ServiceEntry<TDeps, TInstance> {
  return {
    service,
    lifeCycle: 'singleton',
  };
}

export function transient<TDeps, TInstance>(service: Service<TDeps, TInstance>): ServiceEntry<TDeps, TInstance> {
  return {
    service,
    lifeCycle: 'transient',
  };
}

export function background<TDeps, TInstance extends BackgroundService>(
  service: Service<TDeps, TInstance>,
): ServiceEntry<TDeps, TInstance> {
  return {
    service,
    lifeCycle: 'background',
  };
}

function isDisposable(obj: unknown): obj is Disposable | AsyncDisposable {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    ((Symbol.dispose && Symbol.dispose in obj) || (Symbol.asyncDispose && Symbol.asyncDispose in obj))
  );
}
