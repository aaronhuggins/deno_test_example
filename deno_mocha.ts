// deno-lint-ignore-file no-explicit-any
// Taken from https://gist.github.com/lucacasonato/54c03bb267074aaa9b32415dbfb25522

const groupCache = new Map<symbol, Group>()

interface TestSuite<T> {
  symbol: symbol
}

interface DescribeOpts<T> {
  name: string;
  fn?: () => void;
  suite?: TestSuite<T>;
  /** Run some shared setup before all of the tests in the suite. */
  beforeAll?:
    | ((this: T) => void | Promise<void>)
    | ((this: T) => void | Promise<void>)[];
  /** Run some shared teardown after all of the tests in the suite. */
  afterAll?:
    | ((this: T) => void | Promise<void>)
    | ((this: T) => void | Promise<void>)[];
  /** Run some shared setup before each test in the suite. */
  beforeEach?:
    | ((this: T) => void | Promise<void>)
    | ((this: T) => void | Promise<void>)[];
  /** Run some shared teardown after each test in the suite. */
  afterEach?:
    | ((this: T) => void | Promise<void>)
    | ((this: T) => void | Promise<void>)[];
}

// The group for the 'describe' callback we are currently in. If there is no
// current group, we are not in a 'describe' callback.
let currentGroup: Group | undefined;
console.log("currentGroup", typeof currentGroup)
interface Tester {
  step: (name: string, fn: (t: any) => (Promise<void>)) => Promise<void>
}

interface Group<T = unknown> {
  name: string;
  context: T;
  items: Array<[string, Group | Test]>;
  before: Array<Func | AsyncFunc>;
  beforeEach: Array<Func | AsyncFunc>;
  after: Array<Func | AsyncFunc>;
  afterEach: Array<Func | AsyncFunc>;
}

type Done = (err?: any) => void;

/** Callback function used for tests and hooks. */
type Func<T = unknown> = (this: T, done: Done) => void;

/** Async callback function used for tests and hooks. */
type AsyncFunc<T = unknown> = (this: T) => PromiseLike<any>;

interface Test<T = unknown> {
  fn: Func<T> | AsyncFunc<T>;
}

function describeOpts<T>(nameOrSuiteOrOpts: DescribeOpts<T> | TestSuite<T> | string, nameOrFn?: string | (() => void), func?: () => void) {
  const suite: TestSuite<T> | undefined =
    typeof nameOrSuiteOrOpts === "object"
      ? "symbol" in nameOrSuiteOrOpts
        ? nameOrSuiteOrOpts
        : nameOrSuiteOrOpts.suite
      : undefined
  const fn =
    typeof nameOrSuiteOrOpts === "object" && "fn" in nameOrSuiteOrOpts
      ? nameOrSuiteOrOpts.fn ?? (() => {})
      : typeof nameOrFn === "function"
        ? nameOrFn
        : typeof func === "function"
          ? func
          : (() => {})
  const name = 
    typeof nameOrSuiteOrOpts === "object" && "name" in nameOrSuiteOrOpts
      ? nameOrSuiteOrOpts.name
      : typeof nameOrSuiteOrOpts === "string"
        ? nameOrSuiteOrOpts
        : typeof nameOrFn === "string"
          ? nameOrFn
          : fn.name

  return {
    suite,
    fn,
    name,
    beforeFunc:
      typeof nameOrSuiteOrOpts === "object" && "name" in nameOrSuiteOrOpts
        ? nameOrSuiteOrOpts.beforeAll
        : undefined,
    afterFunc:
      typeof nameOrSuiteOrOpts === "object" && "name" in nameOrSuiteOrOpts
        ? nameOrSuiteOrOpts.afterAll
        : undefined,
    beforeEachFunc:
      typeof nameOrSuiteOrOpts === "object" && "name" in nameOrSuiteOrOpts
        ? nameOrSuiteOrOpts.beforeEach
        : undefined,
    afterEachFunc:
      typeof nameOrSuiteOrOpts === "object" && "name" in nameOrSuiteOrOpts
        ? nameOrSuiteOrOpts.afterEach
        : undefined,
  }
}

export function describe<T = unknown>(name: string): TestSuite<T>
export function describe<T = unknown>(options: DescribeOpts<T>): TestSuite<T>
export function describe<T = unknown>(name: string, fn: () => void): TestSuite<T>
export function describe<T = unknown>(suite: TestSuite<T>, name: string, fn: () => void): TestSuite<T>
export function describe<T = unknown>(nameOrSuiteOrOpts: DescribeOpts<T> | TestSuite<T> | string, nameOrFn?: string | (() => void), func?: () => void) {
  const { suite, fn, name, beforeFunc, afterFunc, beforeEachFunc, afterEachFunc } = describeOpts(nameOrSuiteOrOpts, nameOrFn, func)
  const symbol = Symbol()

  // Save the current group so we can restore it after the callback.
  const existingGroup = currentGroup;
  // Create a new group, and set it as the current group.
  const group: Group<T> = currentGroup = {
    name,
    context: {} as T,
    items: [],
    before: [],
    beforeEach: [],
    after: [],
    afterEach: [],
  };
  fn();
  if (beforeFunc) {
    if (Array.isArray(beforeFunc)) {
      for (const func of beforeFunc) before(func)
    } else {
      before(beforeFunc)
    }
  }
  if (afterFunc) {
    if (Array.isArray(afterFunc)) {
      for (const func of afterFunc) before(func)
    } else {
      before(afterFunc)
    }
  }
  if (beforeEachFunc) {
    if (Array.isArray(beforeEachFunc)) {
      for (const func of beforeEachFunc) before(func)
    } else {
      before(beforeEachFunc)
    }
  }
  if (afterEachFunc) {
    if (Array.isArray(afterEachFunc)) {
      for (const func of afterEachFunc) before(func)
    } else {
      before(afterEachFunc)
    }
  }
  // Restore the previous group.
  currentGroup = existingGroup;
  // Add the new group to the existing group if there was one. If there was no
  // existing group, this is the top-level group, so we register the group with
  // `Deno.test`.
  if (suite !== undefined) {
    const parentGroup = groupCache.get(suite.symbol)
    if (parentGroup !== undefined) parentGroup.items.push([name, group])
  } else if (existingGroup !== undefined) {
    existingGroup.items.push([name, group]);
  } else {
    Deno.test(name, groupFn(group) as any);
  }

  groupCache.set(symbol, group)

  return { symbol }
}

// This function returns a function that will run the tests in the given group.
// This is used to register the tests with `Deno.test`.
function groupFn(group: Group): (t: Tester) => Promise<void> {
  return async (t) => {
    const { context } = group
    // Run the before callbacks.
    for (const fn of group.before) {
      await func(fn.bind(context));
    }

    for (const [name, item] of group.items) {
      // If the item is a group, recurse into it, else use the test fn.
      const fn = "fn" in item ? () => func(item.fn.bind(context)) : groupFn(item);

      // Register this test with the tester.
      await t.step(name, async (t) => {
        // Run the beforeEach callbacks.
        for (const fn of group.beforeEach) {
          await func(fn.bind(context));
        }
        // Run the test / group fn.
        await fn(t);

        // Run the afterEach callbacks.
        for (const fn of group.afterEach) {
          await func(fn.bind(context));
        }
      });
    }

    // Run the after callbacks.
    for (const fn of group.after) {
      await func(fn.bind(context));
    }
  };
}

function func(fn: Func | AsyncFunc): Promise<void> {
  if (fn.length === 1) {
    return new Promise((resolve, reject) => {
      fn((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
  return Promise.resolve((fn as AsyncFunc)());
}

// Register a before callback for the current group. If there is no current
// group, we are not in a 'describe' callback, so we throw an error.
export function before<T = unknown>(fn: Func<T> | AsyncFunc<T>) {
  if (currentGroup === undefined) {
    throw new TypeError("Can not call before() outside of a describe().");
  }
  currentGroup.before.push(fn as any);
}

// Register a beforeEach callback for the current group. If there is no current
// group, we are not in a 'describe' callback, so we throw an error.
export function beforeEach<T = unknown>(fn: Func<T> | AsyncFunc<T>) {
  if (currentGroup === undefined) {
    throw new TypeError("Can not call beforeEach() outside of a describe().");
  }
  currentGroup.beforeEach.push(fn as any);
}

// Register an after callback for the current group. If there is no current
// group, we are not in a 'describe' callback, so we throw an error.
export function after<T = unknown>(fn: Func<T> | AsyncFunc<T>) {
  if (currentGroup === undefined) {
    throw new TypeError("Can not call after() outside of a describe().");
  }
  currentGroup.after.push(fn as any);
}

// Register an afterEach callback for the current group. If there is no current
// group, we are not in a 'describe' callback, so we throw an error.
export function afterEach<T = unknown>(fn: Func<T> | AsyncFunc<T>) {
  if (currentGroup === undefined) {
    throw new TypeError("Can not call afterEach() outside of a describe().");
  }
  currentGroup.afterEach.push(fn as any);
}

export function it<T = unknown>(name: string, fn: (this: T, done: Done) => void | PromiseLike<any>): void
export function it<T = unknown>(suite: TestSuite<T>, name: string, fn: (this: T, done: Done) => void | PromiseLike<any>): void
export function it<T = unknown>(nameOrSuite: TestSuite<T> | string, nameOrFn: string | Func<T> | AsyncFunc<T>, func?: Func<T> | AsyncFunc<T>) {
  const group = typeof nameOrSuite === "object" ? groupCache.get(nameOrSuite.symbol) : currentGroup
  const fn = typeof nameOrFn === "function" ? nameOrFn : func ?? (() => {})
  const name = typeof nameOrSuite === "string" ? nameOrSuite : typeof nameOrFn === "string" ? nameOrFn : fn.name

  if (group === undefined) {
    throw new TypeError("Can not call it() outside of a describe().");
  }

  group.items.push([name, { fn } as Test<any>]);
}
