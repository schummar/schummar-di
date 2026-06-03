import type { IContainer } from './types';

export abstract class Injectable<TDeps> {
  constructor(protected readonly resolve: TDeps) {}
}

export abstract class InjectableWithContainer<TDeps> extends Injectable<TDeps> {
  constructor(
    resolve: TDeps,
    protected readonly container: IContainer<TDeps>,
  ) {
    super(resolve);
  }
}
