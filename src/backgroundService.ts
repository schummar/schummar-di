import { Injectable, InjectableWithContainer } from './injectable';
import type { StartableService } from './types';

export abstract class BackgroundService<TDeps = object, TStartResult = void>
  extends Injectable<TDeps>
  implements StartableService<TStartResult>
{
  start?(): TStartResult;
}

export abstract class BackgroundServiceWithContainer<TDeps = object, TStartResult = void>
  extends InjectableWithContainer<TDeps>
  implements StartableService<TStartResult>
{
  start?(): TStartResult;
}

export function isBackgroundService(value: unknown): value is typeof BackgroundService {
  return (
    typeof value === 'function' &&
    (BackgroundService.prototype.isPrototypeOf(value.prototype) ||
      BackgroundServiceWithContainer.prototype.isPrototypeOf(value.prototype))
  );
}
