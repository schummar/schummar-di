import { di } from './constants';
import { normalizeService } from './lib/normalizeService';
import type { LifeCycle, Service, ServiceDescription } from './types';

const helper =
  (lifeCycle: LifeCycle) =>
  <TDeps, TInstance>(...service: Service<TDeps, TInstance>[]): { [di]: ServiceDescription<TDeps, TInstance> } => {
    return {
      [di]: {
        implementations: service.map(normalizeService),
        lifeCycle,
      },
    };
  };

export const singleton = helper('singleton');
export const scoped = helper('scoped');
export const transient = helper('transient');
export const background = helper('background');
