import { di } from './constants';
import { CircularDependencyError, DisposeError, InjectionError, ServiceNotFoundError, StartError } from './lib/errors';
import { getImplementations } from './lib/getImplementations';
import { getLifeCycle } from './lib/getLifeCycle';
import { isDisposable } from './lib/isDisposable';
import isPromise from './lib/isPromise';
import { normalizeService } from './lib/normalizeService';
import type { BackgroundService, IContainer, Merged, Service, ServiceEntry, ServiceMap } from './types';

export function createContainer<TServices>(services: ServiceMap<TServices>): IContainer<TServices> {
  return new Container(services);
}

export class Container<TServices> implements AsyncDisposable {
  private services: Map<keyof TServices, ServiceEntry<TServices, unknown>>;

  private instanceMeta = new Map<
    unknown,
    {
      key?: string | number | symbol;
      startResult?: unknown;
    }
  >();

  private resolving = new Set<string>();

  constructor(
    private serviceMap: ServiceMap<TServices>,
    private parentScope?: Container<TServices>,
  ) {
    this.services = new Map(
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

  inject<T>(
    service: Service<TServices, T>,
    { key, index }: { key?: string | number | symbol; index?: number } = {},
  ): T {
    service = normalizeService(service);
    const resolvedServices = new Map<string | symbol, unknown>();

    const resolver = new Proxy<TServices & object>({} as TServices & object, {
      get: (_target, p) => {
        let resolvedService = resolvedServices.get(p);

        if (!resolvedService) {
          if (this.services.has(p as keyof TServices)) {
            const nextIndex = p !== key || index === undefined ? undefined : index - 1;
            resolvedService = this.resolve(p as keyof TServices, nextIndex);
          } else {
            resolvedService = undefined;
          }

          resolvedServices.set(p, resolvedService);
        }

        return resolvedService;
      },
    });

    const instance = service(resolver, this);
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

  resolveAll<Key extends keyof TServices>(key: Key): TServices[Key][] {
    const instances: TServices[Key][] = [];
    const count = this.services.get(key)?.implementations.length ?? 0;

    for (let i = 0; i < count; i++) {
      instances.push(this.resolve(key, i));
    }

    return instances;
  }

  resolve<Key extends keyof TServices>(key: Key, index?: number): TServices[Key] {
    const entry = this.services.get(key) as ServiceEntry<TServices, TServices[Key]> | undefined;

    if (!entry) {
      throw new ServiceNotFoundError([...this.resolving], key, index);
    }

    if (index === undefined) {
      index = entry.implementations.length - 1;
    }

    if (this.parentScope && (entry.lifeCycle === 'singleton' || entry.lifeCycle === 'background')) {
      return this.parentScope.resolve(key, index);
    }

    if (entry.lifeCycle !== 'transient' && entry.instances?.[index]) {
      return entry.instances[index].v as TServices[Key];
    }

    const service = entry.implementations[index];
    const resolverKey = JSON.stringify([key, index]);

    if (!service) {
      throw new ServiceNotFoundError([...this.resolving], key, index);
    }

    if (this.resolving.has(resolverKey)) {
      throw new CircularDependencyError([...this.resolving, resolverKey]);
    }

    try {
      this.resolving.add(resolverKey);

      const instance = this.inject(service, { key, index });

      if (entry.lifeCycle !== 'transient') {
        entry.instances ??= [];
        entry.instances[index] = { v: instance };
      }

      return instance;
    } catch (error) {
      if (error instanceof InjectionError) {
        throw error;
      }

      throw new InjectionError([...this.resolving], error);
    } finally {
      this.resolving.delete(resolverKey);
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

    for (const entry of this.services.values()) {
      delete entry.instances;
    }

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
    const serviceMap: Record<any, { [di]: ServiceEntry<any, any> }> = {};

    for (const [key, value] of this.services) {
      serviceMap[key] = {
        [di]: {
          implementations: [...value.implementations],
          lifeCycle: value.lifeCycle,
        },
      };
    }

    for (const [key, value] of Object.entries(services)) {
      const existingImplementations = serviceMap[key as keyof TServices]?.[di]?.implementations ?? [];
      const implementations = getImplementations(value);
      const lifeCycle = getLifeCycle(value);

      serviceMap[key] = {
        [di]: {
          implementations: [...existingImplementations, ...implementations],
          lifeCycle,
        },
      };
    }

    return new Container<Merged<TServices, TOverrideServices>>(serviceMap as any);
  }
}
