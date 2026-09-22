# @schummar/di

A simple, type-safe dependency injection container for TypeScript. No decorators, no
`reflect-metadata`, no build step — services are plain classes, functions or values, and
dependencies are resolved by property name with full inference.

## Install

```sh
npm install @schummar/di
```

## Usage

Register services in a container and resolve them by key. Dependencies are the first
constructor/factory parameter, destructured by name:

```ts
import { createContainer } from '@schummar/di';

class Database {
  query(sql: string) {
    /* ... */
  }
}

class UserRepository {
  constructor(private deps: { database: Database }) {}

  findAll() {
    return this.deps.database.query('select * from users');
  }
}

const container = createContainer({
  database: Database,
  userRepository: UserRepository,
});

container.resolve('userRepository').findAll();
```

A service can be a class, a factory function or a constant value:

```ts
const container = createContainer({
  config: { url: 'https://example.com' }, // constant
  client: ({ config }: { config: Config }) => new Client(config.url), // factory
  service: MyService, // class
});
```

Factories and constructors receive the container as a second parameter:

```ts
function sum(_: {}, container: IContainer<{ numbers: number }>) {
  return container.resolveAll('numbers').reduce((a, b) => a + b, 0);
}
```

### Injectable base classes

`Injectable` and `InjectableWithContainer` save the constructor boilerplate:

```ts
import { Injectable } from '@schummar/di';

class UserRepository extends Injectable<{ database: Database }> {
  findAll() {
    return this.resolve.database.query('select * from users');
  }
}
```

`InjectableWithContainer` additionally exposes `this.container`.

## Life cycles

| Life cycle   | Instances                                                            |
| ------------ | -------------------------------------------------------------------- |
| `singleton`  | One per container tree (default)                                     |
| `scoped`     | One per scope created with `createScope()`                           |
| `transient`  | A new one for every resolve                                          |
| `background` | Singleton, created and started eagerly when the container is created |

```ts
import { createContainer, scoped, singleton, transient } from '@schummar/di';

const container = createContainer({
  config: singleton(Config),
  request: scoped(Request),
  id: transient(() => crypto.randomUUID()),
});

const requestScope = container.createScope();
```

The default can be changed per container:

```ts
createContainer(services, { defaultLifeCycle: 'transient' });
```

## Multiple implementations

Register an array to provide several implementations for one key. `resolve` returns the last
one, `resolveAll` returns all of them:

```ts
const container = createContainer({
  handler: [EmailHandler, SmsHandler, PushHandler],
});

container.resolveAll('handler'); // all three
```

This also enables decoration — a later implementation can depend on the key it overrides:

```ts
class CachedUserRepository {
  constructor(private deps: { userRepository: UserRepository }) {}
}

const container = createContainer({
  userRepository: [UserRepository, CachedUserRepository],
});

container.resolve('userRepository'); // CachedUserRepository wrapping UserRepository
```

## Overriding services

`with()` returns a new container with services replaced or added — useful for tests:

```ts
const testContainer = container.with({
  database: new InMemoryDatabase(),
});
```

Overrides are type-checked against the original service type. New keys are added to the
container's type.

## Startup and shutdown

A service with a `start()` method is started when it is created. `waitUntilStarted()` awaits
the result, so services can wait for each other:

```ts
class Server {
  constructor(
    private resolve: { database: Database },
    private container: IContainer<{ database: Database }>,
  ) {}

  async start() {
    await this.container.waitUntilStarted(this.resolve.database);
    // ...
  }
}
```

Services implementing `Disposable` or `AsyncDisposable` are disposed with the container:

```ts
{
  await using container = createContainer(services);
  // ...
} // all resolved services are disposed here
```

Background services start as soon as the container is created. Either use `background(...)` or
extend `BackgroundService` / `BackgroundServiceWithContainer`:

```ts
import { BackgroundService } from '@schummar/di';

class Cleanup extends BackgroundService<{ database: Database }> {
  async start() {
    setInterval(() => this.resolve.database.query('vacuum'), 60_000);
  }
}
```

## Errors

| Error                     | Thrown when                                                   |
| ------------------------- | ------------------------------------------------------------- |
| `InjectionError`          | A constructor or factory throws; includes the resolution path |
| `CircularDependencyError` | Two services depend on each other during construction         |
| `ServiceNotFoundError`    | A resolved key is not registered                              |
| `StartError`              | `start()` throws or rejects                                   |
| `DisposeError`            | One or more services throw while being disposed               |

Circular dependencies are only a problem in the constructor. Accessing the dependency lazily
(in a getter or method) works:

```ts
class ServiceA {
  constructor(private deps: { serviceB: ServiceB }) {}

  get serviceB() {
    return this.deps.serviceB; // resolved on access, not in the constructor
  }
}
```

## License

ISC
