import { describe, expect, test, vi } from 'vitest';
import { background, createContainer, singleton, transient, type BackgroundService } from './index';

describe('resolve', () => {
  test('with classes', () => {
    class ServiceA {
      value = 'a';
    }

    class ServiceB {
      value;
      constructor({ serviceA }: { serviceA: ServiceA }) {
        this.value = serviceA.value + 'b';
      }
    }

    const container = createContainer({
      serviceA: ServiceA,
      serviceB: ServiceB,
    });

    const serviceB = container.resolve('serviceB');
    expect(serviceB.value).toBe('ab');
  });

  test('with functions', () => {
    function ServiceA() {
      return { value: 'a' };
    }

    function ServiceB({ serviceA }: { serviceA: ReturnType<typeof ServiceA> }) {
      return { value: serviceA.value + 'b' };
    }

    const container = createContainer({
      serviceA: ServiceA,
      serviceB: ServiceB,
    });

    const serviceB = container.resolve('serviceB');
    expect(serviceB.value).toBe('ab');
  });

  test('with constants', () => {
    const serviceA = { value: 'a' };

    function ServiceB(deps: { serviceA: typeof serviceA }) {
      return { value: deps.serviceA.value + 'b' };
    }

    const container = createContainer({
      serviceA,
      serviceB: ServiceB,
    });

    const serviceB = container.resolve('serviceB');
    expect(serviceB.value).toBe('ab');
  });

  test('with decorator pattern', () => {
    class ServiceA {
      value = 'a';
    }

    class ServiceASpecialized implements ServiceA {
      value;
      foo = 'var';
      constructor({ serviceA }: { serviceA: ServiceA }) {
        this.value = serviceA.value + 'b';
      }
    }

    const container = createContainer({
      serviceA: [ServiceA, ServiceASpecialized],
    });

    const serviceA = container.resolve('serviceA');
    expect(serviceA.value).toBe('ab');
  });
});

describe('life cycle', () => {
  test('singleton service is only created once', () => {
    const serviceA = vi.fn(() => ({ value: 'a' }));
    const serviceB = vi.fn((deps: { serviceA: ReturnType<typeof serviceA> }) => ({
      value: deps.serviceA.value + 'b',
    }));

    const container = createContainer({
      serviceA: singleton(serviceA),
      serviceB: singleton(serviceB),
    });

    const serviceB1 = container.resolve('serviceB');
    const serviceB2 = container.resolve('serviceB');
    const serviceA1 = container.resolve('serviceA');
    const serviceA2 = container.resolve('serviceA');

    expect(serviceB1).toBe(serviceB2);
    expect(serviceA1).toBe(serviceA2);
    expect(serviceA).toHaveBeenCalledTimes(1);
    expect(serviceB).toHaveBeenCalledTimes(1);
  });

  test('transient service is created on each resolve', () => {
    const serviceA = vi.fn(() => ({ value: 'a' }));
    const serviceB = vi.fn((deps: { serviceA: ReturnType<typeof serviceA> }) => ({
      value: deps.serviceA.value + 'b',
    }));

    const container = createContainer({
      serviceA: transient(serviceA),
      serviceB: transient(serviceB),
    });

    const serviceB1 = container.resolve('serviceB');
    const serviceB2 = container.resolve('serviceB');
    const serviceA1 = container.resolve('serviceA');
    const serviceA2 = container.resolve('serviceA');

    expect(serviceB1).not.toBe(serviceB2);
    expect(serviceA1).not.toBe(serviceA2);
    expect(serviceA).toHaveBeenCalledTimes(4);
    expect(serviceB).toHaveBeenCalledTimes(2);
  });

  test('transient service is only created once for one service', () => {
    const serviceA = vi.fn(() => ({ value: 'a' }));
    const serviceB = vi.fn((deps: { serviceA: ReturnType<typeof serviceA> }) => {
      deps.serviceA;
      deps.serviceA;
    });

    const container = createContainer({
      serviceA: transient(serviceA),
      serviceB: serviceB,
    });

    container.resolve('serviceB');

    expect(serviceA).toHaveBeenCalledOnce();
  });

  test('background service is only created once', () => {
    const start = vi.fn();

    class ServiceA implements BackgroundService {
      start = start;
    }

    const container = createContainer({
      serviceA: background(ServiceA),
    });

    const serviceA1 = container.resolve('serviceA');
    const serviceA2 = container.resolve('serviceA');
    expect(serviceA1).toBe(serviceA2);
  });

  test('background service starts automatically', () => {
    const start = vi.fn();

    class ServiceA implements BackgroundService {
      start = start;
    }

    createContainer({
      serviceA: background(ServiceA),
    });

    expect(start).toHaveBeenCalled();
  });
});

describe('circular dependencies', () => {
  test('throws on circular dependency', () => {
    class ServiceA {
      constructor(private deps: { serviceB: ServiceB }) {
        deps.serviceB;
      }
    }

    class ServiceB {
      constructor(private deps: { serviceA: ServiceA }) {
        deps.serviceA;
      }
    }

    const container = createContainer({
      serviceA: ServiceA,
      serviceB: ServiceB,
    });

    expect(() => container.resolve('serviceA')).toThrowError(
      /Circular dependency detected: serviceA -> serviceB -> serviceA/,
    );
  });

  test("doesn't throw on circular dependency if resolved lazily", () => {
    class ServiceA {
      constructor(private deps: { serviceB: ServiceB }) {}

      get serviceB() {
        return this.deps.serviceB;
      }
    }

    class ServiceB {
      serviceA: ServiceA;

      constructor(private deps: { serviceA: ServiceA }) {
        this.serviceA = deps.serviceA;
      }
    }

    const container = createContainer({
      serviceA: ServiceA,
      serviceB: ServiceB,
    });

    const serviceA = container.resolve('serviceA');
    const serviceB = container.resolve('serviceB');

    expect(serviceA.serviceB).toBe(serviceB);
    expect(serviceB.serviceA).toBe(serviceA);
  });
});

describe('disposable', () => {
  test('call dispose on instance', async () => {
    const disposeA = vi.fn();
    const disposeB = vi.fn();
    const disposeC = vi.fn();

    class ServiceA implements Disposable {
      [Symbol.dispose] = disposeA;
    }

    function ServiceB(): Disposable {
      return {
        [Symbol.dispose]: disposeB,
      };
    }

    const serviceC: Disposable = {
      [Symbol.dispose]: disposeC,
    };

    {
      await using container = createContainer({
        serviceA: ServiceA,
        serviceB: ServiceB,
        serviceC,
      });

      container.resolve('serviceA');
      container.resolve('serviceB');
      container.resolve('serviceC');
    }

    expect(disposeA).toHaveBeenCalledOnce();
    expect(disposeB).toHaveBeenCalledOnce();
    expect(disposeC).toHaveBeenCalledOnce();
  });

  test('call async dispose on instance', async () => {
    const asyncDisposeA = vi.fn();
    const asyncDisposeB = vi.fn();
    const asyncDisposeC = vi.fn();

    class ServiceA implements AsyncDisposable {
      [Symbol.asyncDispose] = asyncDisposeA;
    }

    function ServiceB(): AsyncDisposable {
      return {
        [Symbol.asyncDispose]: asyncDisposeB,
      };
    }

    const serviceC: AsyncDisposable = {
      [Symbol.asyncDispose]: asyncDisposeC,
    };

    {
      await using container = createContainer({
        serviceA: ServiceA,
        serviceB: ServiceB,
        serviceC,
      });

      container.resolve('serviceA');
      container.resolve('serviceB');
      container.resolve('serviceC');
    }

    expect(asyncDisposeA).toHaveBeenCalledOnce();
    expect(asyncDisposeB).toHaveBeenCalledOnce();
    expect(asyncDisposeC).toHaveBeenCalledOnce();
  });
});

describe('error handling', () => {
  test('reports constructor errors', () => {
    class ServiceA {
      constructor() {
        throw new Error('ServiceA error');
      }
    }
    class ServiceB {
      constructor(private deps: { serviceA: ServiceA }) {
        deps.serviceA;
      }
    }

    const container = createContainer({
      serviceA: ServiceA,
      serviceB: ServiceB,
    });

    expect(() => container.resolve('serviceB')).toThrowErrorMatchingInlineSnapshot(
      `[InjectionError: Injection error for serviceB -> serviceA: ServiceA error]`,
    );
  });

  test('reports factory errors', () => {
    function ServiceA() {
      throw new Error('ServiceA error');
    }

    const container = createContainer({
      serviceA: ServiceA,
    });

    expect(() => container.resolve('serviceA')).toThrowError(/ServiceA error/);
  });

  test('reports dipose errors', async () => {
    const disposeA = vi.fn(() => {
      throw new Error('ServiceA error');
    });

    class ServiceA implements Disposable {
      [Symbol.dispose] = disposeA;
    }

    const container = createContainer({
      serviceA: ServiceA,
    });

    container.resolve('serviceA');
    await expect(() => container[Symbol.asyncDispose]()).rejects.toThrowErrorMatchingInlineSnapshot(
      `[DisposeError: 1 error(s) during dispose: Injection error for serviceA: ServiceA error]`,
    );
  });
});
