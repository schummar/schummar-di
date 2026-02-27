import { DisposeError, InjectionError, StartError } from './errors';
import isPromise from './isPromise';

export type GetContainerType<T> = T extends Container<infer U> ? U : never;

export interface BackgroundService<TStartResult = void> {
  start?(): TStartResult;
}

export const di = Symbol('di');
export const lifeCycleValues = ['singleton', 'scoped', 'transient', 'background'] as const;
export type LifeCycle = (typeof lifeCycleValues)[number];

export interface ServiceFactory<TDeps, TInstance> {
  (deps: Resolver<TDeps>): TInstance;
}

export interface ServiceConstructor<TDeps, TInstance> {
  new (deps: Resolver<TDeps>): TInstance;
}

export type Service<TDeps, TInstance> =
  | ServiceFactory<TDeps, TInstance>
  | ServiceConstructor<TDeps, TInstance>
  | TInstance;

export interface ServiceDescription<TDeps, TInstance> {
  implementations: readonly ServiceFactory<TDeps, TInstance>[];
  lifeCycle: LifeCycle;
}

export type ServiceMap<TServices, TDeps = TServices> = {
  [K in keyof TServices]:
    | Service<TDeps, TServices[K]>
    | readonly Service<TDeps, TServices[K]>[]
    | { [di]: ServiceDescription<TDeps, TServices[K]> };
};

type Merged<TServices, TOverrideServices> = {
  [K in keyof TServices | keyof TOverrideServices]: K extends keyof TOverrideServices
    ? TOverrideServices[K]
    : K extends keyof TServices
      ? TServices[K]
      : never;
} & {};

export type Resolver<TDeps> = TDeps & {
  container: IContainer<TDeps>;
};

export type IContainer<TServices> = Pick<Container<TServices>, keyof Container<TServices>>;

export function createContainer<TServices>(services: ServiceMap<TServices>): IContainer<TServices> {
  return new Container(services);
}

export class Container<TServices> implements AsyncDisposable {
  private services: Map<keyof TServices, ServiceDescription<TServices, unknown>>;
  private instances = new Map<keyof TServices, TServices[keyof TServices]>();
  private instanceMeta = new Map<
    unknown,
    {
      key?: string | number | symbol;
      startResult?: unknown;
    }
  >();
  private resolving = new Set<keyof TServices>();

  constructor(
    private serviceMap: ServiceMap<TServices>,
    private parent?: Container<TServices>,
  ) {
    this.services = new Map<keyof TServices, ServiceDescription<TServices, unknown>>(
      Reflect.ownKeys(serviceMap).map((key) => {
        const value = serviceMap[key as keyof TServices];
        const implementations = getImplementations(value);
        const lifeCycle = getLifeCycle(value);

        return [
          key as keyof TServices,
          {
            implementations,
            lifeCycle,
          },
        ];
      }),
    );

    for (const [key, entry] of this.services) {
      if (entry.lifeCycle === 'background') {
        this.resolve(key);
      }
    }
  }

  inject<T>(service: Service<TServices, T>, key?: string | number | symbol): T {
    service = normalizeService(service);
    const resolvedServices = new Map<keyof TServices, TServices[keyof TServices]>();

    const resolver = new Proxy<Resolver<TServices>>(
      {
        container: this,
      } as Resolver<TServices>,
      {
        get: (target, p) => {
          if (p in target) {
            return (target as any)[p];
          }

          let resolvedService = resolvedServices.get(p as keyof TServices);
          if (!resolvedService) {
            resolvedService = this.resolve(p as keyof TServices, service);
            resolvedServices.set(p as keyof TServices, resolvedService);
          }

          return resolvedService;
        },
      },
    );

    const instance = service(resolver);
    this.instanceMeta.set(instance, { key });
    this.startService(instance);

    return instance;
  }

  waitUntilStarted<TService>(
    service: TService,
  ): TService extends BackgroundService<infer TStartResult> ? TStartResult : void {
    const result = this.startService(service);

    if (result instanceof StartError) {
      throw result;
    }

    if (isPromise(result)) {
      return result.then((res) => {
        if (res instanceof StartError) {
          throw res;
        }

        return res;
      }) as any;
    }

    return result;
  }

  private startService<TService>(
    service: TService,
  ): TService extends BackgroundService<infer TStartResult> ? TStartResult : void {
    let meta = this.instanceMeta.get(service);
    if (!meta) {
      meta = {};
      this.instanceMeta.set(service, meta);
    }

    if ('startResult' in meta) {
      return meta.startResult as any;
    }

    if (typeof service === 'object' && service !== null && 'start' in service && typeof service.start === 'function') {
      let startResult;
      try {
        startResult = service.start();
        if (isPromise(startResult)) {
          startResult = startResult.catch((error) => new StartError(meta?.key, service, error));
        }
      } catch (error) {
        startResult = new StartError(meta?.key, service, error);
      }

      meta.startResult = startResult;
      return startResult;
    }

    return undefined as any;
  }

  resolve<Key extends keyof TServices>(key: Key, forService?: Service<TServices, unknown>): TServices[Key] {
    const entry = this.services.get(key) as ServiceDescription<TServices, TServices[Key]> | undefined;

    if (!entry) {
      // throw new Error(`Service ${String(key)} not found`);
      return undefined as any;
    }

    if (this.parent && (entry.lifeCycle === 'singleton' || entry.lifeCycle === 'background')) {
      const fromParent = this.parent.resolve(key, forService);
      if (fromParent) {
        return fromParent;
      }
    }

    if (entry.lifeCycle !== 'transient' && this.instances.has(key)) {
      return this.instances.get(key) as TServices[Key];
    }

    let service: Service<TServices, TServices[Key]> | undefined;
    let isResolvingNested = false;
    const index = forService ? entry.implementations.findIndex((s) => s === forService) : -1;
    if (index !== -1) {
      service = entry.implementations[index - 1];
      isResolvingNested = true;
    } else {
      service = entry.implementations.at(-1);
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

      const instance = this.inject(service, key);

      if (entry.lifeCycle !== 'transient') {
        this.instances.set(key, instance);
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

    for (const [instance, { key }] of this.instanceMeta) {
      if (isPromise(instance) || isDisposable(instance)) {
        promises.push(
          Promise.resolve(instance).then((instance) => {
            if (!isDisposable(instance)) {
              return;
            }

            if (Symbol.dispose in instance) {
              try {
                instance[Symbol.dispose]();
              } catch (error) {
                errors.push({ key, instance, cause: error });
              }
            }

            if (Symbol.asyncDispose in instance) {
              promises.push(
                (async () => {
                  try {
                    await instance[Symbol.asyncDispose]();
                  } catch (error) {
                    errors.push({ key, instance, cause: error });
                  }
                })(),
              );
            }
          }),
        );
      }
    }

    this.instances.clear();
    this.instanceMeta.clear();

    await Promise.all(promises);

    if (errors.length > 0) {
      throw new DisposeError(errors);
    }
  }

  createScope(): IContainer<TServices> {
    return new Container<TServices>(this.serviceMap, this);
  }

  with<TOverrideServices extends Record<string | number | symbol, unknown> = {}>(
    services: ServiceMap<TOverrideServices, Merged<TServices, TOverrideServices>> & Partial<ServiceMap<TServices>>,
  ): IContainer<Merged<TServices, TOverrideServices>> {
    return new Container<Merged<TServices, TOverrideServices>>({
      ...this.serviceMap,
      ...services,
    } as any);
  }
}

export function singleton<TDeps, TInstance>(
  ...service: Service<TDeps, TInstance>[]
): { [di]: ServiceDescription<TDeps, TInstance> } {
  return {
    [di]: {
      implementations: service.map(normalizeService),
      lifeCycle: 'singleton',
    },
  };
}

export function scoped<TDeps, TInstance>(
  ...service: Service<TDeps, TInstance>[]
): { [di]: ServiceDescription<TDeps, TInstance> } {
  return {
    [di]: {
      implementations: service.map(normalizeService),
      lifeCycle: 'scoped',
    },
  };
}

export function transient<TDeps, TInstance>(
  ...service: Service<TDeps, TInstance>[]
): { [di]: ServiceDescription<TDeps, TInstance> } {
  return {
    [di]: {
      implementations: service.map(normalizeService),
      lifeCycle: 'transient',
    },
  };
}

export function background<TDeps, TInstance>(
  ...service: Service<TDeps, TInstance>[]
): { [di]: ServiceDescription<TDeps, TInstance> } {
  return {
    [di]: {
      implementations: service.map(normalizeService),
      lifeCycle: 'background',
    },
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
    const descriptor = Object.getOwnPropertyDescriptor(service, 'prototype');

    if (descriptor?.writable === false) {
      return (deps: TServices) => new (service as new (deps: TServices) => TInstance)(deps);
    }

    return service as ServiceFactory<TServices, TInstance>;
  }

  return () => service;
}

function getImplementations<TServices, TInstance>(
  service:
    | Service<TServices, TInstance>
    | readonly Service<TServices, TInstance>[]
    | ServiceDescription<TServices, TInstance>,
): readonly ServiceFactory<TServices, TInstance>[] {
  if (
    typeof service === 'object' &&
    service !== null &&
    di in service &&
    typeof service[di] === 'object' &&
    service[di] !== null &&
    'implementations' in service[di] &&
    Array.isArray(service[di].implementations)
  ) {
    return service[di].implementations as readonly ServiceFactory<TServices, TInstance>[];
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
    di in service &&
    typeof service[di] === 'object' &&
    service[di] !== null &&
    'lifeCycle' in service[di] &&
    (lifeCycleValues as readonly unknown[]).includes(service[di].lifeCycle)
  ) {
    return service[di].lifeCycle as LifeCycle;
  }

  return 'singleton';
}
