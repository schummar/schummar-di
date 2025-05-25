import { describe, expect, test, vi } from 'vitest';
import { createContext, background, singleton, transient, type BackgroundService } from './index';

describe('resolve', () => {
  test('with classes', () => {
    class ServiceA {
      value = 'a';
    }

    class ServiceB {
      value;
      constructor(public context: { serviceA: ServiceA }) {
        this.value = context.serviceA.value + 'b';
      }
    }

    const context = createContext({
      serviceA: ServiceA,
      serviceB: ServiceB,
    });

    const serviceB = context.resolve('serviceB');
    expect(serviceB.value).toBe('ab');
  });

  test('with functions', () => {
    function ServiceA() {
      return { value: 'a' };
    }

    function ServiceB(context: { serviceA: ReturnType<typeof ServiceA> }) {
      return { value: context.serviceA.value + 'b' };
    }

    const context = createContext({
      serviceA: ServiceA,
      serviceB: ServiceB,
    });

    const serviceB = context.resolve('serviceB');
    expect(serviceB.value).toBe('ab');
  });

  test('with constants', () => {
    const serviceA = { value: 'a' };

    function ServiceB(context: { serviceA: typeof serviceA }) {
      return { value: context.serviceA.value + 'b' };
    }

    const context = createContext({
      serviceA,
      serviceB: ServiceB,
    });

    const serviceB = context.resolve('serviceB');
    expect(serviceB.value).toBe('ab');
  });
});

describe('life cycle', () => {
  test('singleton', () => {
    const serviceA = vi.fn(() => ({ value: 'a' }));
    const serviceB = vi.fn((context: { serviceA: ReturnType<typeof serviceA> }) => ({
      value: context.serviceA.value + 'b',
    }));

    const context = createContext({
      serviceA: singleton(serviceA),
      serviceB: singleton(serviceB),
    });

    const serviceB1 = context.resolve('serviceB');
    const serviceB2 = context.resolve('serviceB');
    const serviceA1 = context.resolve('serviceA');
    const serviceA2 = context.resolve('serviceA');

    expect(serviceB1).toBe(serviceB2);
    expect(serviceA1).toBe(serviceA2);
    expect(serviceA).toHaveBeenCalledTimes(1);
    expect(serviceB).toHaveBeenCalledTimes(1);
  });

  test('transient', () => {
    const serviceA = vi.fn(() => ({ value: 'a' }));
    const serviceB = vi.fn((context: { serviceA: ReturnType<typeof serviceA> }) => ({
      value: context.serviceA.value + 'b',
    }));

    const context = createContext({
      serviceA: transient(serviceA),
      serviceB: transient(serviceB),
    });

    const serviceB1 = context.resolve('serviceB');
    const serviceB2 = context.resolve('serviceB');
    const serviceA1 = context.resolve('serviceA');
    const serviceA2 = context.resolve('serviceA');

    expect(serviceB1).not.toBe(serviceB2);
    expect(serviceA1).not.toBe(serviceA2);
    expect(serviceA).toHaveBeenCalledTimes(4);
    expect(serviceB).toHaveBeenCalledTimes(2);
  });

  test('background', () => {
    const start = vi.fn();

    class ServiceA implements BackgroundService {
      start = start;
    }

    createContext({
      serviceA: background(ServiceA),
    });

    expect(start).toHaveBeenCalled();
  });
});

describe('circular dependencies', () => {
  test('throws on circular dependency', () => {
    class ServiceA {
      constructor(public context: { serviceB: ServiceB }) {
        context.serviceB;
      }
    }

    class ServiceB {
      constructor(public context: { serviceA: ServiceA }) {
        context.serviceA;
      }
    }

    const context = createContext({
      serviceA: ServiceA,
      serviceB: ServiceB,
    });

    expect(() => context.resolve('serviceA')).toThrowError(
      /Circular dependency detected: serviceA -> serviceB -> serviceA/,
    );
  });

  test("doesn't throw on circular dependency if resolved lazily", () => {
    class ServiceA {
      constructor(public context: { serviceB: ServiceB }) {}

      get serviceB() {
        return this.context.serviceB;
      }
    }

    class ServiceB {
      serviceA: ServiceA;

      constructor(public context: { serviceA: ServiceA }) {
        this.serviceA = context.serviceA;
      }
    }

    const context = createContext({
      serviceA: ServiceA,
      serviceB: ServiceB,
    });

    const serviceA = context.resolve('serviceA');
    const serviceB = context.resolve('serviceB');

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

    const context = createContext({
      serviceA: ServiceA,
      serviceB: ServiceB,
      serviceC,
    });

    context.resolve('serviceA');
    context.resolve('serviceB');
    context.resolve('serviceC');
    await context.dispose();

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

    const context = createContext({
      serviceA: ServiceA,
      serviceB: ServiceB,
      serviceC,
    });

    context.resolve('serviceA');
    context.resolve('serviceB');
    context.resolve('serviceC');
    await context.dispose();

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
      constructor(public context: { serviceA: ServiceA }) {
        context.serviceA;
      }
    }

    const context = createContext({
      serviceA: ServiceA,
      serviceB: ServiceB,
    });

    expect(() => context.resolve('serviceB')).toThrowErrorMatchingInlineSnapshot(
      `[InjectionError: Injection error for serviceB -> serviceA: ServiceA error]`,
    );
  });

  test('reports factory errors', () => {
    function ServiceA() {
      throw new Error('ServiceA error');
    }

    const context = createContext({
      serviceA: ServiceA,
    });

    expect(() => context.resolve('serviceA')).toThrowError(/ServiceA error/);
  });

  test('reports dipose errors', async () => {
    const disposeA = vi.fn(() => {
      throw new Error('ServiceA error');
    });

    class ServiceA implements Disposable {
      [Symbol.dispose] = disposeA;
    }

    const context = createContext({
      serviceA: ServiceA,
    });

    context.resolve('serviceA');
    await expect(() => context.dispose()).rejects.toThrowErrorMatchingInlineSnapshot(
      `[DisposeError: 1 error(s) during dispose: Injection error for serviceA: ServiceA error]`,
    );
  });
});
