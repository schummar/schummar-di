import { di } from '../constants';
import type { Service, ServiceDescription, ServiceFactory } from '../types';
import { normalizeService } from './normalizeService';

export function getImplementations<TServices, TInstance>(
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
