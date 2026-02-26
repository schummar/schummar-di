import { DisposeError, InjectionError } from './errors';
import isPromise from './isPromise';

export type GetContainerType<T> = T extends Container<infer U> ? U : never;

export interface BackgroundService<TStartResult = void> {
  start?(): TStartResult;
}

export const implementations = Symbol('implementations');
export const lifeCycle = Symbol('lifeCycle');
export const lifeCycleValues = ['singleton', 'scoped', 'transient', 'background'] as const;
export type LifeCycle = (typeof lifeCycleValues)[number];

export interface ServiceFactory<TDeps, TInstance> {
  (deps: TDeps): TInstance;
}

export interface ServiceConstructor<TDeps, TInstance> {
  new (deps: TDeps): TInstance;
}

export type Service<TDeps, TInstance> =
  | ServiceFactory<TDeps, TInstance>
  | ServiceConstructor<TDeps, TInstance>
  | TInstance;

export interface ServiceDescription<TDeps, TInstance> {
  [implementations]: readonly ServiceFactory<TDeps, TInstance>[];
  [lifeCycle]: LifeCycle;
}

export type ServiceMap<TServices, TDeps = TServices> = {
  [K in keyof TServices]:
    | Service<TDeps, TServices[K]>
    | readonly Service<TDeps, TServices[K]>[]
    | ServiceDescription<TDeps, TServices[K]>;
};

export function createContainer<TServices extends Record<string | number | symbol, unknown>>(
  services: ServiceMap<TServices>,
): Container<TServices> {
  return new Container(services);
}

type Resolver<TDeps> = TDeps & {
  waitUntilStarted<TInstance extends TDeps[keyof TDeps]>(
    service: TInstance,
  ): TInstance extends BackgroundService<infer TStartResult> ? TStartResult : never;
};

export class Container<TServices extends Record<string | number | symbol, unknown>> implements AsyncDisposable {
  private services: Map<keyof TServices, ServiceDescription<TServices, unknown>>;
  private instances = new Map<keyof TServices, TServices[keyof TServices]>();
  private startResults = new Map<unknown, unknown>();
  private resolving = new Set<keyof TServices>();
  private disposables = new Map<Disposable | AsyncDisposable, string | number | symbol>();

  constructor(
    private serviceMap: ServiceMap<TServices>,
    private parent?: Container<TServices>,
  ) {
    this.services = new Map<keyof TServices, ServiceDescription<TServices, unknown>>(
      Reflect.ownKeys(serviceMap).map((key) => {
        const value = serviceMap[key as keyof TServices];
        const _implementations = getImplementations(value);
        const _lifeCycle = getLifeCycle(value);

        return [
          key as keyof TServices,
          {
            [implementations]: _implementations,
            [lifeCycle]: _lifeCycle,
          },
        ];
      }),
    );

    for (const [key, entry] of this.services) {
      if (entry[lifeCycle] === 'background') {
        this.resolve(key);
      }
    }
  }

  inject<T>(service: Service<TServices, T>): T {
    const [instance, startResult] = this.injectWithStartResult(service);

    if (isPromise(startResult)) {
      startResult.catch((error) => {
        console.error(`Error starting service ${String(service)}:`, error);
      });
    }

    return instance;
  }

  injectWithStartResult<T>(
    service: Service<TServices, T>,
  ): [instance: T, started: T extends BackgroundService<infer TStartResult> ? TStartResult : void] {
    service = normalizeService(service);
    const resolvedServices = new Map<keyof TServices, TServices[keyof TServices]>();

    const resolver = new Proxy<Resolver<TServices>>(
      {
        waitUntilStarted: (service: unknown): unknown => {
          return this.startService(service);
        },
      } as Resolver<any>,
      {
        get: (target, p) => {
          if (p in target) {
            return (target as any)[p];
          }

          let service = resolvedServices.get(p as keyof TServices);
          if (!service) {
            service = this.resolve(p as keyof TServices, service);
            resolvedServices.set(p as keyof TServices, service);
          }

          return service;
        },
      },
    );

    const instance = service(resolver);
    const startResult = this.startService(instance);

    return [instance, startResult];
  }

  private startService<TService>(
    service: TService,
  ): TService extends BackgroundService<infer TStartResult> ? TStartResult : void {
    if (this.startResults.has(service)) {
      return this.startResults.get(service) as any;
    }

    if (typeof service === 'object' && service !== null && 'start' in service && typeof service.start === 'function') {
      const startResult = service.start();
      this.startResults.set(service, startResult);
      return startResult as any;
    }

    return undefined as any;
  }

  resolve<Key extends keyof TServices>(key: Key, forService?: Service<TServices, unknown>): TServices[Key] {
    const entry = this.services.get(key) as ServiceDescription<TServices, TServices[Key]> | undefined;

    if (!entry) {
      throw new Error(`Service ${String(key)} not found`);
    }

    if (this.parent && (entry[lifeCycle] === 'singleton' || entry[lifeCycle] === 'background')) {
      const fromParent = this.parent.resolve(key, forService);
      if (fromParent) {
        return fromParent;
      }
    }

    if (entry[lifeCycle] !== 'transient' && this.instances.has(key)) {
      return this.instances.get(key) as TServices[Key];
    }

    let service: Service<TServices, TServices[Key]> | undefined;
    let isResolvingNested = false;
    const index = forService ? entry[implementations].findIndex((s) => s === forService) : -1;
    if (index !== -1) {
      service = entry[implementations][index - 1];
      isResolvingNested = true;
    } else {
      service = entry[implementations].at(-1);
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

      if (entry[lifeCycle] !== 'transient') {
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

export function singleton<TDeps, TInstance>(
  ...service: Service<TDeps, TInstance>[]
): ServiceDescription<TDeps, TInstance> {
  return {
    [implementations]: service.map(normalizeService),
    [lifeCycle]: 'singleton',
  };
}

export function scoped<TDeps, TInstance>(
  ...service: Service<TDeps, TInstance>[]
): ServiceDescription<TDeps, TInstance> {
  return {
    [implementations]: service.map(normalizeService),
    [lifeCycle]: 'scoped',
  };
}

export function transient<TDeps, TInstance>(
  ...service: Service<TDeps, TInstance>[]
): ServiceDescription<TDeps, TInstance> {
  return {
    [implementations]: service.map(normalizeService),
    [lifeCycle]: 'transient',
  };
}

export function background<TDeps, TInstance>(
  ...service: Service<TDeps, TInstance>[]
): ServiceDescription<TDeps, TInstance> {
  return {
    [implementations]: service.map(normalizeService),
    [lifeCycle]: 'background',
  };
}

function isDisposable(obj: unknown): obj is Disposable | AsyncDisposable {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    ((Symbol.dispose && Symbol.dispose in obj) || (Symbol.asyncDispose && Symbol.asyncDispose in obj))
  );
}

function normalizeService<TServices, TInstance>(
  service: Service<TServices, TInstance>,
): ServiceFactory<TServices, TInstance> {
  if (typeof service === 'function') {
    return (deps: TServices) => {
      try {
        return (service as (deps: TServices) => TInstance)(deps);
      } catch (error) {
        if (error instanceof TypeError && error.message.includes(`cannot be invoked without 'new'`)) {
          return new (service as new (deps: TServices) => TInstance)(deps);
        }

        throw error;
      }
    };
  }

  return () => service;
}

function getImplementations<TServices, TInstance>(
  service:
    | Service<TServices, TInstance>
    | readonly Service<TServices, TInstance>[]
    | ServiceDescription<TServices, TInstance>,
): readonly ServiceFactory<TServices, TInstance>[] {
  if (typeof service === 'object' && service !== null && implementations in service) {
    return service[implementations] as readonly ServiceFactory<TServices, TInstance>[];
  }

  if (Array.isArray(service)) {
    return service.map(normalizeService);
  }

  return [normalizeService(service as Service<TServices, TInstance>)];
}

function getLifeCycle<TServices>(service: Service<TServices, unknown>): LifeCycle {
  if (
    typeof service === 'object' &&
    service !== null &&
    lifeCycle in service &&
    (lifeCycleValues as readonly unknown[]).includes(service[lifeCycle])
  ) {
    return service[lifeCycle] as LifeCycle;
  }

  return 'singleton';
}
