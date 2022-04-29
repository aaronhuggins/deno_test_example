// deno-lint-ignore-file no-explicit-any
export interface TestSuite<T> {
  symbol: symbol;
}

type Func<T = unknown> = (
  this: T,
  t: Deno.TestContext,
) => void | PromiseLike<void>;

type Hook<T> = HookFunc<T> | HookFunc<T>[];
type HookFunc<T> = (this: T) => void | Promise<void>;
type HookName = "beforeAll" | "afterAll" | "beforeEach" | "afterEach";

interface Test<T = unknown> {
  fn: Func<T>;
}

interface DescribeOpts<T> {
  name: string;
  fn?: () => void;
  suite?: TestSuite<T>;
  /** Run some shared setup before all of the tests in the suite. */
  beforeAll?: Hook<T>;
  /** Run some shared teardown after all of the tests in the suite. */
  afterAll?: Hook<T>;
  /** Run some shared setup before each test in the suite. */
  beforeEach?: Hook<T>;
  /** Run some shared teardown after each test in the suite. */
  afterEach?: Hook<T>;
}

class SuiteGroup<T extends Record<string | symbol | number, any>>
  implements TestSuite<T> {
  context: T = {} as T;
  items: [string, SuiteGroup<any> | Test<any>][] = [];
  beforeAll: HookFunc<T>[] = [];
  beforeEach: HookFunc<T>[] = [];
  afterAll: HookFunc<T>[] = [];
  afterEach: HookFunc<T>[] = [];
  symbol = Symbol();

  fn(): (t: Deno.TestContext) => Promise<void> {
    return async (t) => {
      const { context } = this;
      // Run the before callbacks.
      for (const fn of this.beforeAll) {
        await fn.call(context);
      }

      for (const [name, item] of this.items) {
        // If the item is a group, recurse into it, else use the test fn.
        const fn = "items" in item ? item.fn() : item.fn.bind(context);

        // Register this test with the tester.
        await t.step(name, async (t) => {
          // Run the beforeEach callbacks.
          for (const fn of this.beforeEach) {
            await fn.call(context);
          }
          // Run the test / group fn.
          await fn(t);

          // Run the afterEach callbacks.
          for (const fn of this.afterEach) {
            await fn.call(context);
          }
        });
      }

      // Run the after callbacks.
      for (const fn of this.afterAll) {
        await fn.call(context);
      }
    };
  }
}

class BDD {
  static suiteGroups = new Map<symbol, SuiteGroup<any>>();
  static currentSuiteGroup?: SuiteGroup<any>;

  static describe<T = unknown>(
    nameOrSuiteOrOpts: DescribeOpts<T> | TestSuite<T> | string,
    nameOrFn?: string | (() => void),
    func?: () => void,
  ) {
    const { suite, fn, name, beforeAll, afterAll, beforeEach, afterEach } = BDD
      .getDescribeOpts(nameOrSuiteOrOpts, nameOrFn, func);
    const symbol = Symbol();

    // Save the current group so we can restore it after the callback.
    const existingGroup = BDD.currentSuiteGroup;
    // Create a new group, and set it as the current group.
    const group: SuiteGroup<T> = BDD.currentSuiteGroup = new SuiteGroup<T>();
    fn?.();
    BDD.registerHook("beforeAll", beforeAll);
    BDD.registerHook("afterAll", afterAll);
    BDD.registerHook("beforeEach", beforeEach);
    BDD.registerHook("afterEach", afterEach);

    // Restore the previous group.
    BDD.currentSuiteGroup = existingGroup;
    // Add the new group to the existing group if there was one. If there was no
    // existing group, this is the top-level group, so we register the group with
    // `Deno.test`.
    if (suite !== undefined) {
      const parentGroup = BDD.suiteGroups.get(suite.symbol);
      if (parentGroup !== undefined) parentGroup.items.push([name, group]);
    } else if (existingGroup !== undefined) {
      existingGroup.items.push([name, group]);
    } else {
      Deno.test(name, group.fn() as any);
    }

    BDD.suiteGroups.set(symbol, group);

    return { symbol };
  }

  static it<T = unknown>(
    nameOrSuite: TestSuite<T> | string,
    nameOrFn: string | Func<T>,
    func?: Func<T>,
  ) {
    const group = typeof nameOrSuite === "object"
      ? BDD.suiteGroups.get(nameOrSuite.symbol)
      : BDD.currentSuiteGroup;
    const fn = typeof nameOrFn === "function" ? nameOrFn : func;
    const name = typeof nameOrSuite === "string"
      ? nameOrSuite
      : typeof nameOrFn === "string"
      ? nameOrFn
      : fn?.name ?? "";

    if (group === undefined) {
      throw new TypeError("Can not call it() outside of a describe().");
    }
    if (fn === undefined) {
      throw new TypeError("Can not call an undefined test function.");
    }

    group.items.push([name, { fn }]);
  }

  static registerHook(hookName: HookName, hook?: Hook<any>) {
    if (BDD.currentSuiteGroup === undefined) {
      throw new TypeError(
        `Can not call ${hookName}() outside of a describe().`,
      );
    }

    if (Array.isArray(hook)) {
      BDD.currentSuiteGroup[hookName]?.push(...hook);
    } else if (hook) {
      BDD.currentSuiteGroup[hookName]?.push(hook);
    }
  }

  static getDescribeOpts<T>(
    nameOrSuiteOrOpts: DescribeOpts<T> | TestSuite<T> | string,
    nameOrFn?: string | (() => void),
    func?: () => void,
  ): DescribeOpts<T> {
    const suite: TestSuite<T> | undefined =
      typeof nameOrSuiteOrOpts === "object"
        ? "symbol" in nameOrSuiteOrOpts
          ? nameOrSuiteOrOpts
          : nameOrSuiteOrOpts.suite
        : undefined;
    const fn =
      typeof nameOrSuiteOrOpts === "object" && "fn" in nameOrSuiteOrOpts
        ? nameOrSuiteOrOpts.fn ?? (() => {})
        : typeof nameOrFn === "function"
        ? nameOrFn
        : typeof func === "function"
        ? func
        : (() => {});
    const name =
      typeof nameOrSuiteOrOpts === "object" && "name" in nameOrSuiteOrOpts
        ? nameOrSuiteOrOpts.name
        : typeof nameOrSuiteOrOpts === "string"
        ? nameOrSuiteOrOpts
        : typeof nameOrFn === "string"
        ? nameOrFn
        : fn.name;

    return {
      suite,
      fn,
      name,
      beforeAll:
        typeof nameOrSuiteOrOpts === "object" && "name" in nameOrSuiteOrOpts
          ? nameOrSuiteOrOpts.beforeAll
          : undefined,
      afterAll:
        typeof nameOrSuiteOrOpts === "object" && "name" in nameOrSuiteOrOpts
          ? nameOrSuiteOrOpts.afterAll
          : undefined,
      beforeEach:
        typeof nameOrSuiteOrOpts === "object" && "name" in nameOrSuiteOrOpts
          ? nameOrSuiteOrOpts.beforeEach
          : undefined,
      afterEach:
        typeof nameOrSuiteOrOpts === "object" && "name" in nameOrSuiteOrOpts
          ? nameOrSuiteOrOpts.afterEach
          : undefined,
    };
  }
}

export function describe<T = unknown>(name: string): TestSuite<T>;
export function describe<T = unknown>(options: DescribeOpts<T>): TestSuite<T>;
export function describe<T = unknown>(
  name: string,
  fn: () => void,
): TestSuite<T>;
export function describe<T = unknown>(
  suite: TestSuite<T>,
  name: string,
  fn: () => void,
): TestSuite<T>;
export function describe<T = unknown>(
  nameOrSuiteOrOpts: DescribeOpts<T> | TestSuite<T> | string,
  nameOrFn?: string | (() => void),
  func?: () => void,
) {
  return BDD.describe(nameOrSuiteOrOpts, nameOrFn, func);
}

export function it<T = unknown>(name: string, fn: Func<T>): void;
export function it<T = unknown>(
  suite: TestSuite<T>,
  name: string,
  fn: Func<T>,
): void;
export function it<T = unknown>(
  nameOrSuite: TestSuite<T> | string,
  nameOrFn: string | Func<T>,
  func?: Func<T>,
) {
  BDD.it(nameOrSuite, nameOrFn, func);
}

export function before<T = unknown>(fn: Hook<T>) {
  BDD.registerHook("beforeAll", fn);
}

export function beforeAll<T = unknown>(fn: Hook<T>) {
  BDD.registerHook("beforeAll", fn);
}

export function after<T = unknown>(fn: Hook<T>) {
  BDD.registerHook("afterAll", fn);
}

export function afterAll<T = unknown>(fn: Hook<T>) {
  BDD.registerHook("afterAll", fn);
}

export function beforeEach<T = unknown>(fn: Hook<T>) {
  BDD.registerHook("beforeEach", fn);
}

export function afterEach<T = unknown>(fn: Hook<T>) {
  BDD.registerHook("afterEach", fn);
}
