type Implementation<Context, T> = ((context: Context) => T) | (new (context: Context) => T) | T;

type Implementations<Context> = {
    [K in keyof Context]: Implementation<Context, Context[K]>;
};

export default function createContext<Context extends object>(
    implementations: Implementations<Context> & Record<string, Implementation<Context, unknown>>,
) {
    const instances: Partial<Context> = {};
    const resolving = new Set<keyof Context>();

    const context = new Proxy<Context>(instances as any, {
        get(_target, p) {
            return resolve(p as keyof Context);
        },
    });

    function build<T>(implementation: Implementation<Context, T>): T {
        if (typeof implementation === 'function') {
            try {
                return new (implementation as new (context: Context) => T)(context);
            } catch {
                return (implementation as (context: Context) => T)(context);
            }
        } else {
            return implementation;
        }
    }

    function resolve<Key extends keyof Context>(key: Key): Context[Key] {
        if (!(key in instances)) {
            if (resolving.has(key)) {
                throw new Error(`Circular dependency detected: ${[...resolving].join(' -> ')} -> ${String(key)}`);
            }

            try {
                resolving.add(key);
                instances[key] = build(implementations[key]) as Context[Key];
            } finally {
                resolving.delete(key);
            }
        }

        return instances[key] as Context[Key];
    }

    for (const key in implementations) {
        resolve(key as keyof Context);
    }

    return {
        resolve<Key extends keyof Context>(key: Key): Context[Key] {
            return resolve(key);
        },

        inject<T>(implementation: Implementation<Context, T>) {
            return build(implementation);
        },
    };
}
