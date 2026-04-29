import { di, lifeCycleValues } from './constants';
import type { Container } from './container';

export type GetContainerType<T> = T extends Container<infer U> ? U : never;

export interface StartableService<TStartResult = void> {
  start?(): TStartResult;
}

export type LifeCycle = (typeof lifeCycleValues)[number];

type Value<T> = { v: T };

export interface ServiceFactory<TDeps, TInstance> {
  (deps: TDeps, container: IContainer<TDeps>): TInstance;
}

export interface ServiceConstructor<TDeps, TInstance> {
  new (deps: TDeps, container: IContainer<TDeps>): TInstance;
}

export type Service<TDeps, TInstance> =
  | ServiceFactory<TDeps, TInstance>
  | ServiceConstructor<TDeps, TInstance>
  | TInstance;

export interface ServiceDescription<TDeps, TInstance> {
  implementations: readonly ServiceFactory<TDeps, TInstance>[];
  lifeCycle: LifeCycle;
}

export interface ServiceEntry<TDeps, TInstance> extends ServiceDescription<TDeps, TInstance> {
  instances?: Value<TInstance>[];
}

export type ServiceMap<TServices, TDeps = TServices> = {
  [K in keyof TServices]: Service<TDeps, TServices[K]> | { [di]: ServiceDescription<TDeps, TServices[K]> };
};

export type Merged<TServices, TOverrideServices> = {
  [K in keyof TServices | keyof TOverrideServices]: K extends keyof TOverrideServices
    ? TOverrideServices[K]
    : K extends keyof TServices
      ? TServices[K]
      : never;
} & {};

export type IContainer<TServices> = Pick<Container<TServices>, keyof Container<TServices>>;

export interface ContainerOptions<TServices> {
  defaultLifeCycle?: LifeCycle;
  parentScope?: Container<TServices>;
}
