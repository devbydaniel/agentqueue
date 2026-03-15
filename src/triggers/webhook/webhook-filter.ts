import { WebhookFilter } from '../../config/trigger-config.interface.js';

/**
 * Resolve a dot-separated path into a nested object.
 * e.g. getNestedValue({ a: { b: 'c' } }, 'a.b') → 'c'
 */
export function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Evaluate a single filter against a payload.
 * At least one condition (equals, contains, in, pattern) must match.
 * If no condition is specified, the filter passes (vacuously true).
 */
export function evaluateFilter(
  body: Record<string, unknown>,
  filter: WebhookFilter,
): boolean {
  const value = getNestedValue(body, filter.field);

  if (filter.equals !== undefined) {
    return String(value) === filter.equals;
  }
  if (filter.contains !== undefined) {
    return typeof value === 'string' && value.includes(filter.contains);
  }
  if (filter.in !== undefined) {
    return filter.in.includes(String(value));
  }
  if (filter.pattern !== undefined) {
    return new RegExp(filter.pattern).test(String(value));
  }

  return true;
}

/**
 * All filters must pass (AND logic).
 * Returns true if filters is empty or undefined.
 */
export function matchesFilters(
  body: Record<string, unknown>,
  filters?: WebhookFilter[],
): boolean {
  if (!filters || filters.length === 0) return true;
  return filters.every((f) => evaluateFilter(body, f));
}
