import type { IContainer, Service, ServiceConstructor, ServiceFactory } from '../types';

export function normalizeService<TServices, TInstance>(
  service: Service<TServices, TInstance>,
): ServiceFactory<TServices, TInstance> {
  if (typeof service === 'function') {
    const descriptor = Object.getOwnPropertyDescriptor(service, 'prototype');

    if (descriptor?.writable === false) {
      return (deps: TServices, container: IContainer<TServices>) =>
        new (service as ServiceConstructor<TServices, TInstance>)(deps, container);
    }

    return service as ServiceFactory<TServices, TInstance>;
  }

  return () => service;
}
