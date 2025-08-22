import { DisposeError, InjectionError } from './errors';

export interface BackgroundService {
  start(): void;
}

export type LifeCycle = 'singleton' | 'scoped' | 'transient' | 'background';

export type Service<TDeps, TInstance> = ((deps: TDeps) => TInstance) | (new (deps: TDeps) => TInstance) | TInstance;

export interface ServiceEntry<TDeps, TInstance> {
  service: Service<TDeps, TInstance> | readonly Service<TDeps, TInstance>[];
  lifeCycle: LifeCycle;
}

export type ServiceMap<TServices, TDeps = TServices> = {
  [K in keyof TServices]:
    | Service<TDeps, TServices[K]>
    | readonly Service<TDeps, TServices[K]>[]
    | ServiceEntry<TDeps, TServices[K]>;
};

export function createContainer<TServices extends Record<string | number | symbol, unknown>>(
  services: ServiceMap<TServices>,
): Container<TServices> {
  return new Container(services);
}

export class Container<TServices extends Record<string | number | symbol, unknown>> implements AsyncDisposable {
  private services: Map<keyof TServices, ServiceEntry<TServices, unknown>>;
  private instances = new Map<keyof TServices, TServices[keyof TServices]>();
  private resolving = new Set<keyof TServices>();
  private disposables = new Map<Disposable | AsyncDisposable, string | number | symbol>();

  constructor(
    private serviceMap: ServiceMap<TServices>,
    private parent?: Container<TServices>,
  ) {
    this.services = new Map<keyof TServices, ServiceEntry<TServices, unknown>>(
      Reflect.ownKeys(serviceMap).map((key) => {
        const value = serviceMap[key as keyof TServices];
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
          service = this.resolve(p as keyof TServices, implementation);
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

  resolve<Key extends keyof TServices>(key: Key, forService?: Service<TServices, unknown>): TServices[Key] {
    const entry = this.services.get(key) as ServiceEntry<TServices, TServices[Key]> | undefined;

    if (!entry) {
      throw new Error(`Service ${String(key)} not found`);
    }

    if (entry.lifeCycle === 'singleton' || entry.lifeCycle === 'background') {
      const fromParent = this.parent?.resolve(key, forService);
      if (fromParent) {
        return fromParent;
      }
    }

    if (entry.lifeCycle !== 'transient' && this.instances.has(key)) {
      return this.instances.get(key) as TServices[Key];
    }

    let service: Service<TServices, TServices[Key]> | undefined;
    let isResolvingNested = false;
    if (Array.isArray(entry?.service)) {
      const index = forService ? entry.service.findIndex((s) => s === forService) : -1;
      if (index !== -1) {
        service = entry.service[index - 1];
        isResolvingNested = true;
      } else {
        service = entry.service.at(-1);
      }
    } else {
      service = entry?.service as Service<TServices, TServices[Key]>;
    }

    if (!service) {
      throw new Error(`Service ${String(key)} not found`);
    }

    if (!isResolvingNested && this.resolving.has(key)) {
      throw new Error(
        `Circular dependency detected: ${[...this.resolving].join(' -> ')} -> ${String(key)}. Access the dependency after the constructor to avoid this error.`,
      );
    }

    try {
      this.resolving.add(key);

      const instance = this.inject(service);

      if (entry.lifeCycle !== 'transient') {
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

  createScope(): Container<TServices> {
    return new Container<TServices>(this.serviceMap, this);
  }

  with<TOverrideServices extends Record<string | number | symbol, unknown> = {}>(
    services: ServiceMap<TOverrideServices, Merged<TServices, TOverrideServices>> & Partial<ServiceMap<TServices>>,
  ): Container<Merged<TServices, TOverrideServices>> {
    return new Container({
      ...this.serviceMap,
      ...services,
    } as any);
  }
}

type Merged<TServices, TOverrideServices> = {
  [K in keyof TServices | keyof TOverrideServices]: K extends keyof TOverrideServices
    ? TOverrideServices[K]
    : K extends keyof TServices
      ? TServices[K]
      : never;
} & {};

export function singleton<TDeps, TInstance>(...service: Service<TDeps, TInstance>[]): ServiceEntry<TDeps, TInstance> {
  return {
    service,
    lifeCycle: 'singleton',
  };
}

export function scoped<TDeps, TInstance>(...service: Service<TDeps, TInstance>[]): ServiceEntry<TDeps, TInstance> {
  return {
    service,
    lifeCycle: 'scoped',
  };
}

export function transient<TDeps, TInstance>(...service: Service<TDeps, TInstance>[]): ServiceEntry<TDeps, TInstance> {
  return {
    service,
    lifeCycle: 'transient',
  };
}

export function background<TDeps, TInstance extends BackgroundService>(
  ...service: Service<TDeps, TInstance>[]
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
