import type { IContainer } from './types';

export abstract class Injectable<TDeps> {
  constructor(
    protected readonly resolve: TDeps,
    protected readonly container?: IContainer<TDeps>,
  ) {}
}
