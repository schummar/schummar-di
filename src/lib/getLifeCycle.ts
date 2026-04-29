import { di, lifeCycleValues } from '../constants';
import type { LifeCycle, Service } from '../types';

export function getLifeCycle<TServices>(service: Service<TServices, unknown>): LifeCycle {
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
