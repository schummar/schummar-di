import { Injectable } from './injectable';
import type { StartableService } from './types';

export abstract class BackgroundService<TDeps = object, TStartResult = void>
  extends Injectable<TDeps>
  implements StartableService<TStartResult>
{
  start?(): TStartResult;
}

export function isBackgroundService(value: unknown): value is typeof BackgroundService {
  return typeof value === 'function' && BackgroundService.prototype.isPrototypeOf(value.prototype);
}
