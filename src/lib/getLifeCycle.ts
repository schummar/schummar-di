import { isBackgroundService } from '../backgroundService';
import { di, lifeCycleValues } from '../constants';
import type { ContainerOptions, LifeCycle, Service } from '../types';

export function getLifeCycle<TServices>(
  service: Service<TServices, unknown>,
  options: ContainerOptions<TServices>,
): LifeCycle {
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

  if (isBackgroundService(service)) {
    return 'background';
  }

  return options.defaultLifeCycle ?? 'singleton';
}
